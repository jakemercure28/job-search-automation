'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { countSuccessfulApplicationsToday, isBlockedPlatform, planAutoApply } = require('../lib/auto-applier');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      company TEXT,
      title TEXT,
      url TEXT,
      platform TEXT,
      score INTEGER,
      status TEXT,
      stage TEXT,
      auto_applied_at TEXT,
      auto_apply_status TEXT,
      apply_complexity TEXT,
      created_at TEXT
    );
    CREATE TABLE auto_apply_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      attempted_at TEXT,
      status TEXT,
      dry_run INTEGER DEFAULT 0,
      failure_class TEXT
    );
  `);
  return db;
}

describe('auto-applier quota counting', () => {
  it('counts only successful non-dry-run auto-applies for the target local day', () => {
    const db = createDb();
    const insert = db.prepare(`
      INSERT INTO auto_apply_log (job_id, attempted_at, status, dry_run)
      VALUES (?, ?, ?, ?)
    `);

    insert.run('success-1', '2026-04-15T14:00:00Z', 'success', 0);
    insert.run('success-2', '2026-04-15T15:00:00Z', 'success', 0);
    insert.run('failed', '2026-04-15T16:00:00Z', 'failed', 0);
    insert.run('dry-run', '2026-04-15T17:00:00Z', 'success', 1);
    insert.run('previous-day', '2026-04-14T18:00:00Z', 'success', 0);

    assert.equal(countSuccessfulApplicationsToday(db, '2026-04-15'), 2);
  });

  it('blocks configured platforms case-insensitively', () => {
    assert.equal(isBlockedPlatform('ashby', ['ashby']), true);
    assert.equal(isBlockedPlatform('GreenHouse', ['ashby']), false);
  });

  it('excludes manual-review and closed-page failures from retry planning', async () => {
    const db = createDb();
    const insertJob = db.prepare(`
      INSERT INTO jobs (id, company, title, url, platform, score, status, auto_apply_status, apply_complexity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAttempt = db.prepare(`
      INSERT INTO auto_apply_log (job_id, attempted_at, status, dry_run, failure_class)
      VALUES (?, ?, ?, ?, ?)
    `);

    insertJob.run('job-validation', 'Acme', 'Platform Engineer', 'https://boards.greenhouse.io/acme/jobs/1', 'greenhouse', 4, 'pending', 'failed', 'simple', '2026-04-21T10:00:00Z');
    insertJob.run('job-manual', 'Bravo', 'Site Reliability Engineer', 'https://boards.greenhouse.io/bravo/jobs/2', 'greenhouse', 5, 'pending', 'failed', 'simple', '2026-04-21T11:00:00Z');
    insertJob.run('job-closed', 'Charlie', 'DevOps Engineer', 'https://boards.greenhouse.io/charlie/jobs/3', 'greenhouse', 6, 'pending', 'failed', 'simple', '2026-04-21T12:00:00Z');
    insertAttempt.run('job-validation', '2026-04-21T12:30:00Z', 'failed', 0, 'validation');
    insertAttempt.run('job-manual', '2026-04-21T12:31:00Z', 'failed', 0, 'manual-review-needed');
    insertAttempt.run('job-closed', '2026-04-21T12:32:00Z', 'failed', 0, 'closed-page');

    const rows = await planAutoApply(db, {
      applicant: {},
      blocklist: [],
      platformBlocklist: ['ashby'],
    }, {
      retryFailed: true,
      scoreOrder: 'asc',
    });

    assert.deepEqual(rows.map((row) => row.jobId), ['job-validation']);
  });
});
