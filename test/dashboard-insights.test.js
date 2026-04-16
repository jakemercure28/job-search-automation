'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  getRelevantScrapeCount,
  getScraperHealth,
  getTodayActivityCounts,
  getLatestDailyActivity,
  buildDailyDigest,
  getDailyManualApplyCounts,
} = require('../lib/dashboard-insights');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      platform TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      event_type TEXT,
      to_value TEXT,
      created_at TEXT
    );
    CREATE TABLE auto_apply_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      attempted_at TEXT,
      status TEXT,
      dry_run INTEGER DEFAULT 0
    );
  `);
  return db;
}

describe('dashboard insights', () => {
  it('filters archived jobs out of today scrape counts and platform chips', () => {
    const db = createDb();
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j1', 'Lever', 'pending', '2026-04-15T12:00:00Z');
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j2', 'Lever', 'archived', '2026-04-15T12:30:00Z');
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j3', 'Greenhouse', 'applied', '2026-04-15T13:00:00Z');

    assert.equal(getRelevantScrapeCount(db, '2026-04-15'), 2);
    assert.deepEqual(getScraperHealth(db, '2026-04-15'), [
      { platform: 'Greenhouse', count: 1 },
      { platform: 'Lever', count: 1 },
    ]);
  });

  it('reports today activity counts without double-counting auto-applies as manual applies', () => {
    const db = createDb();
    for (const id of ['manual', 'auto', 'rejected', 'closed']) {
      db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run(id, 'Lever', 'pending', '2026-04-15T12:00:00Z');
    }

    db.prepare('INSERT INTO events (job_id, event_type, to_value, created_at) VALUES (?, ?, ?, ?)').run('manual', 'stage_change', 'applied', '2026-04-15T14:00:00Z');
    db.prepare('INSERT INTO events (job_id, event_type, to_value, created_at) VALUES (?, ?, ?, ?)').run('rejected', 'stage_change', 'rejected', '2026-04-15T15:00:00Z');
    db.prepare('INSERT INTO events (job_id, event_type, to_value, created_at) VALUES (?, ?, ?, ?)').run('closed', 'stage_change', 'closed', '2026-04-15T16:00:00Z');
    db.prepare('INSERT INTO auto_apply_log (job_id, attempted_at, status, dry_run) VALUES (?, ?, ?, ?)').run('auto', '2026-04-15T17:00:00Z', 'success', 0);
    db.prepare('INSERT INTO auto_apply_log (job_id, attempted_at, status, dry_run) VALUES (?, ?, ?, ?)').run('auto', '2026-04-15T18:00:00Z', 'success', 1);
    db.prepare('INSERT INTO auto_apply_log (job_id, attempted_at, status, dry_run) VALUES (?, ?, ?, ?)').run('auto', '2026-04-15T19:00:00Z', 'failed', 0);

    assert.deepEqual(getTodayActivityCounts(db, '2026-04-15'), {
      todayApplied: 1,
      todayAutoApplied: 1,
      todayRejected: 1,
      todayClosed: 1,
    });
  });

  it('builds the manual apply chart from stage-change events', () => {
    const db = createDb();
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j1', 'Lever', 'pending', '2026-04-13T12:00:00Z');
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j2', 'Lever', 'pending', '2026-04-14T12:00:00Z');
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j3', 'Lever', 'pending', '2026-04-15T12:00:00Z');

    db.prepare('INSERT INTO events (job_id, event_type, to_value, created_at) VALUES (?, ?, ?, ?)').run('j1', 'stage_change', 'applied', '2026-04-13T15:00:00Z');
    db.prepare('INSERT INTO events (job_id, event_type, to_value, created_at) VALUES (?, ?, ?, ?)').run('j3', 'stage_change', 'applied', '2026-04-15T15:00:00Z');
    db.prepare('INSERT INTO auto_apply_log (job_id, attempted_at, status, dry_run) VALUES (?, ?, ?, ?)').run('j2', '2026-04-14T15:00:00Z', 'success', 0);

    const counts = getDailyManualApplyCounts(db, 3, new Date('2026-04-15T16:00:00Z'));
    assert.deepEqual(counts.map(row => row.count), [1, 0, 1]);
  });

  it('uses the latest meaningful activity for the daily digest and keeps queue-add context', () => {
    const db = createDb();
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j1', 'Lever', 'pending', '2026-04-15T12:00:00Z');
    db.prepare('INSERT INTO jobs (id, platform, status, created_at) VALUES (?, ?, ?, ?)').run('j2', 'Greenhouse', 'pending', '2026-04-15T13:00:00Z');
    db.prepare('INSERT INTO events (job_id, event_type, to_value, created_at) VALUES (?, ?, ?, ?)').run('j1', 'stage_change', 'rejected', '2026-04-15T19:00:00Z');

    assert.deepEqual(getLatestDailyActivity(db, '2026-04-15'), {
      type: 'rejected',
      count: 1,
      ts: '2026-04-15T19:00:00Z',
    });
    assert.equal(
      buildDailyDigest(db, '2026-04-15'),
      'Latest update: 1 rejection recorded today. 2 jobs were added to your queue earlier today.'
    );
  });

  it('falls back cleanly when there is no queue activity yet today', () => {
    const db = createDb();
    assert.equal(buildDailyDigest(db, '2026-04-15'), 'No queue activity yet today.');
  });
});
