'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  MIGRATIONS,
  addMissingColumns,
  applyBaseSchema,
  applyMigrations,
  backfillLegacyEvents,
  getColumnNames,
} = require('../lib/db/schema');

class FakeDb {
  constructor() {
    this.tables = new Map();
    this.rows = new Map();
  }

  ensureTable(tableName) {
    if (!this.tables.has(tableName)) this.tables.set(tableName, new Set());
    if (!this.rows.has(tableName)) this.rows.set(tableName, []);
  }

  pragma(query) {
    const match = query.match(/^table_info\((\w+)\)$/);
    if (!match) throw new Error(`Unsupported pragma: ${query}`);

    const tableName = match[1];
    this.ensureTable(tableName);
    return [...this.tables.get(tableName)].map((name) => ({ name }));
  }

  exec(sql) {
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      this.executeStatement(statement);
    }
  }

  executeStatement(statement) {
    const createTableMatch = statement.match(/^CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]+)\)$/);
    if (createTableMatch) {
      const [, tableName, body] = createTableMatch;
      this.ensureTable(tableName);

      for (const rawLine of body.split(',')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('FOREIGN KEY') || line.startsWith('PRIMARY KEY')) continue;
        const columnName = line.split(/\s+/)[0];
        this.tables.get(tableName).add(columnName);
      }
      return;
    }

    const alterTableMatch = statement.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) (.+)$/);
    if (alterTableMatch) {
      const [, tableName, columnName] = alterTableMatch;
      this.ensureTable(tableName);
      this.tables.get(tableName).add(columnName);
      return;
    }

    if (/^CREATE (UNIQUE )?INDEX IF NOT EXISTS /.test(statement)) return;

    if (statement === "UPDATE jobs SET first_seen_at = created_at WHERE first_seen_at IS NULL") {
      for (const row of this.rows.get('jobs') || []) {
        if (row.first_seen_at == null) row.first_seen_at = row.created_at;
      }
      return;
    }

    throw new Error(`Unsupported SQL statement: ${statement}`);
  }

  prepare(sql) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized === "SELECT value FROM metadata WHERE key = 'schema_version'") {
      return {
        get: () => (this.rows.get('metadata') || []).find((row) => row.key === 'schema_version'),
      };
    }

    if (normalized === "INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES ('schema_version', ?, datetime('now'))") {
      return {
        run: (value) => {
          this.ensureTable('metadata');
          const rows = this.rows.get('metadata');
          const existingIndex = rows.findIndex((row) => row.key === 'schema_version');
          const nextRow = { key: 'schema_version', value, updated_at: 'now' };
          if (existingIndex >= 0) rows[existingIndex] = nextRow;
          else rows.push(nextRow);
        },
      };
    }

    if (normalized === 'SELECT id, applied_at FROM jobs WHERE applied_at IS NOT NULL') {
      return {
        all: () => (this.rows.get('jobs') || [])
          .filter((row) => row.applied_at != null)
          .map((row) => ({ id: row.id, applied_at: row.applied_at })),
      };
    }

    if (normalized === 'SELECT id, rejected_from_stage, rejected_at FROM jobs WHERE rejected_at IS NOT NULL') {
      return {
        all: () => (this.rows.get('jobs') || [])
          .filter((row) => row.rejected_at != null)
          .map((row) => ({
            id: row.id,
            rejected_from_stage: row.rejected_from_stage,
            rejected_at: row.rejected_at,
          })),
      };
    }

    if (normalized === 'SELECT id, reached_out_at FROM jobs WHERE reached_out_at IS NOT NULL') {
      return {
        all: () => (this.rows.get('jobs') || [])
          .filter((row) => row.reached_out_at != null)
          .map((row) => ({ id: row.id, reached_out_at: row.reached_out_at })),
      };
    }

    if (normalized.startsWith('INSERT INTO events (job_id, event_type, from_value, to_value, created_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS')) {
      return {
        run: (jobId, eventType, fromValue, toValue, createdAt) => {
          this.ensureTable('events');
          const existing = (this.rows.get('events') || []).some((row) =>
            row.job_id === jobId
            && row.event_type === eventType
            && (row.from_value || null) === (fromValue || null)
            && (row.to_value || null) === (toValue || null)
            && row.created_at === createdAt
          );

          if (!existing) {
            this.rows.get('events').push({
              job_id: jobId,
              event_type: eventType,
              from_value: fromValue || null,
              to_value: toValue || null,
              created_at: createdAt,
            });
          }
        },
      };
    }

    throw new Error(`Unsupported prepared SQL: ${normalized}`);
  }

  insert(tableName, row) {
    this.ensureTable(tableName);
    this.rows.get(tableName).push({ ...row });
  }

  selectAll(tableName) {
    this.ensureTable(tableName);
    return this.rows.get(tableName).map((row) => ({ ...row }));
  }
}

function createTestDb() {
  const db = new FakeDb();
  applyBaseSchema(db);
  return db;
}

describe('db schema helpers', () => {
  it('addMissingColumns is idempotent', () => {
    const db = createTestDb();

    addMissingColumns(db, 'jobs', {
      test_flag: 'TEXT',
      test_count: 'INTEGER DEFAULT 0',
    });
    addMissingColumns(db, 'jobs', {
      test_flag: 'TEXT',
      test_count: 'INTEGER DEFAULT 0',
    });

    const columns = getColumnNames(db, 'jobs');
    assert.ok(columns.has('test_flag'));
    assert.ok(columns.has('test_count'));
    assert.equal([...columns].filter((name) => name === 'test_flag').length, 1);
    assert.equal([...columns].filter((name) => name === 'test_count').length, 1);
  });

  it('applyMigrations upgrades schema to the latest version', () => {
    const db = createTestDb();

    applyMigrations(db);

    const schemaVersion = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
    const jobColumns = getColumnNames(db, 'jobs');
    const autoApplyColumns = getColumnNames(db, 'auto_apply_log');
    const applicationPrepColumns = getColumnNames(db, 'application_preps');
    const rejectionEmailColumns = getColumnNames(db, 'rejection_email_log');

    assert.equal(Number(schemaVersion.value), MIGRATIONS.length);
    assert.ok(jobColumns.has('rejection_reasoning'));
    assert.ok(jobColumns.has('auto_apply_status'));
    assert.ok(jobColumns.has('score_attempts'));
    assert.ok(jobColumns.has('last_score_attempt_at'));
    assert.ok(jobColumns.has('score_error'));
    assert.ok(autoApplyColumns.has('resume_filename'));
    assert.ok(autoApplyColumns.has('dry_run'));
    assert.ok(applicationPrepColumns.has('workflow'));
    assert.ok(applicationPrepColumns.has('answers_json'));
    assert.ok(applicationPrepColumns.has('voice_checks_json'));
    assert.ok(rejectionEmailColumns.has('uid_validity'));
    assert.ok(rejectionEmailColumns.has('matched_job_id'));
    assert.ok(rejectionEmailColumns.has('match_status'));
  });

  it('backfillLegacyEvents does not duplicate rows when rerun', () => {
    const db = createTestDb();
    applyMigrations(db);

    db.insert('jobs', {
      id: 'job-1',
      title: 'DevOps Engineer',
      company: 'acme',
      url: 'https://example.com/job-1',
      platform: 'Ashby',
      location: 'Remote',
      posted_at: '2026-04-01T00:00:00Z',
      description: 'Build infrastructure',
      applied_at: '2026-04-02T00:00:00Z',
      reached_out_at: '2026-04-03T00:00:00Z',
      rejected_from_stage: 'phone_screen',
      rejected_at: '2026-04-04T00:00:00Z',
    });

    backfillLegacyEvents(db);
    backfillLegacyEvents(db);

    const events = db.selectAll('events')
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .map(({ event_type, from_value, to_value, created_at }) => ({
        event_type,
        from_value,
        to_value,
        created_at,
      }));

    assert.equal(events.length, 3);
    assert.deepEqual(events, [
      {
        event_type: 'stage_change',
        from_value: null,
        to_value: 'applied',
        created_at: '2026-04-02T00:00:00Z',
      },
      {
        event_type: 'outreach',
        from_value: null,
        to_value: 'reached_out',
        created_at: '2026-04-03T00:00:00Z',
      },
      {
        event_type: 'stage_change',
        from_value: 'phone_screen',
        to_value: 'rejected',
        created_at: '2026-04-04T00:00:00Z',
      },
    ]);
  });
});
