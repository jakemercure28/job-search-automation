'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const { hasPrimaryDuplicate } = require('../pipeline');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

describe('pipeline manual apply boundary', () => {
  it('does not import or invoke unattended apply modules', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
    assert.doesNotMatch(source, /auto-applier/);
    assert.doesNotMatch(source, /run-auto-apply/);
    assert.doesNotMatch(source, /submitOne|applyOne|runBatch/);
  });

  it('does not treat an archived alternate row as a primary duplicate', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'builtin-1',
      'Senior Site Reliability Engineer',
      'UJET',
      'https://remoteok.com/job',
      'RemoteOK',
      'archived'
    );

    assert.equal(hasPrimaryDuplicate(db, {
      title: 'Senior Site Reliability Engineer',
      company: 'UJET',
      platform: 'Greenhouse',
    }), false);

    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'greenhouse-1',
      'Senior Site Reliability Engineer',
      'UJET',
      'https://job-boards.greenhouse.io/ujet/jobs/1',
      'Greenhouse',
      'pending'
    );

    assert.equal(hasPrimaryDuplicate(db, {
      title: 'Senior Site Reliability Engineer',
      company: 'UJET',
      platform: 'Greenhouse',
    }), true);
  });
});
