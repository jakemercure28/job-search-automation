'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { countSuccessfulApplicationsToday, isBlockedPlatform } = require('../lib/auto-applier');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
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
});
