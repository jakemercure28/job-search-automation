'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const { canonicalizeAlternateJob } = require('../lib/db');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

describe('ATS alias DB merge', () => {
  it('moves applied alternate state and dependent rows to the canonical job', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (
        id, title, company, url, platform, location, posted_at, description,
        status, score, reasoning, applied_at, stage, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'builtin-1',
      'Senior Site Reliability Engineer',
      'UJET',
      'https://remoteok.com/job',
      'RemoteOK',
      'Remote',
      '2026-04-18',
      'Aggregator description',
      'applied',
      8,
      'Strong fit',
      '2026-04-20T12:00:00Z',
      'applied',
      'Submitted manually'
    );
    db.prepare("INSERT INTO events (job_id, event_type, from_value, to_value) VALUES (?, ?, ?, ?)")
      .run('builtin-1', 'stage_change', null, 'applied');
    db.prepare(`
      INSERT INTO application_preps (job_id, status, workflow, apply_url)
      VALUES (?, ?, ?, ?)
    `).run('builtin-1', 'ready', 'autofill', 'https://remoteok.com/job');

    const result = canonicalizeAlternateJob(db, db.prepare('SELECT * FROM jobs WHERE id = ?').get('builtin-1'), {
      status: 'primary',
      platform: 'Greenhouse',
      url: 'https://job-boards.greenhouse.io/ujet/jobs/4677625005',
      confidence: 0.95,
      evidence: { method: 'test' },
      job: {
        id: 'greenhouse-4677625005',
        platform: 'Greenhouse',
        title: 'Senior Site Reliability Engineer',
        company: 'ujet',
        url: 'https://job-boards.greenhouse.io/ujet/jobs/4677625005',
        postedAt: '2026-04-18T00:01:00Z',
        description: 'Primary ATS description',
        location: 'Remote',
      },
    });

    assert.equal(result.action, 'canonicalized');

    const canonical = db.prepare('SELECT * FROM jobs WHERE id = ?').get('greenhouse-4677625005');
    assert.equal(canonical.status, 'applied');
    assert.equal(canonical.stage, 'applied');
    assert.equal(canonical.score, 8);
    assert.equal(canonical.notes, 'Submitted manually');
    assert.equal(canonical.platform, 'Greenhouse');

    const alternate = db.prepare('SELECT status FROM jobs WHERE id = ?').get('builtin-1');
    assert.equal(alternate.status, 'archived');

    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM events WHERE job_id = ?').get('greenhouse-4677625005').n,
      2
    );
    assert.equal(
      db.prepare('SELECT job_id FROM application_preps WHERE apply_url = ?').get('https://remoteok.com/job').job_id,
      'greenhouse-4677625005'
    );

    const alias = db.prepare('SELECT * FROM job_aliases WHERE alternate_job_id = ?').get('builtin-1');
    assert.equal(alias.canonical_job_id, 'greenhouse-4677625005');
    assert.equal(alias.status, 'primary');
  });

  it('does not let an archived alternate downgrade an existing active canonical job', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status, score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'greenhouse-1',
      'Platform Engineer',
      'Acme',
      'https://job-boards.greenhouse.io/acme/jobs/1',
      'Greenhouse',
      'pending',
      9
    );
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status, score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'builtin-1',
      'Platform Engineer',
      'Acme',
      'https://builtin.com/job/platform-engineer/1',
      'Built In',
      'archived',
      4
    );

    canonicalizeAlternateJob(db, db.prepare('SELECT * FROM jobs WHERE id = ?').get('builtin-1'), {
      status: 'primary',
      platform: 'Greenhouse',
      url: 'https://job-boards.greenhouse.io/acme/jobs/1',
      confidence: 0.95,
      evidence: { method: 'test' },
      job: {
        id: 'greenhouse-1',
        platform: 'Greenhouse',
        title: 'Platform Engineer',
        company: 'Acme',
        url: 'https://job-boards.greenhouse.io/acme/jobs/1',
        description: 'Primary description',
      },
    });

    const canonical = db.prepare('SELECT status, score FROM jobs WHERE id = ?').get('greenhouse-1');
    assert.equal(canonical.status, 'pending');
    assert.equal(canonical.score, 9);
  });

  it('sets needs-manual-review instead of archived for scored unsupported rows', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status, score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('builtin-1', 'Senior SRE', 'Acme', 'https://builtin.com/job/1', 'Built In', 'pending', 8);

    canonicalizeAlternateJob(db, db.prepare('SELECT * FROM jobs WHERE id = ?').get('builtin-1'), {
      status: 'unsupported',
      evidence: { unsupportedPlatform: 'iCIMS' },
      confidence: 0.75,
    });

    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('builtin-1').status, 'needs-manual-review');
  });

  it('archives unscored unsupported rows', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('builtin-2', 'Junior SRE', 'Acme', 'https://builtin.com/job/2', 'Built In', 'pending');

    canonicalizeAlternateJob(db, db.prepare('SELECT * FROM jobs WHERE id = ?').get('builtin-2'), {
      status: 'unsupported',
      evidence: { unsupportedPlatform: 'iCIMS' },
      confidence: 0.75,
    });

    assert.equal(db.prepare('SELECT status FROM jobs WHERE id = ?').get('builtin-2').status, 'archived');
  });
});
