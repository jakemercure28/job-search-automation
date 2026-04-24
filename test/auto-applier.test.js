'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

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
      applied_at TEXT,
      auto_applied_at TEXT,
      auto_apply_status TEXT,
      auto_apply_error TEXT,
      apply_complexity TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE auto_apply_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      attempted_at TEXT,
      status TEXT,
      error TEXT,
      resume_filename TEXT,
      security_code TEXT,
      dry_run INTEGER DEFAULT 0,
      run_id TEXT,
      mode TEXT,
      platform TEXT,
      failure_class TEXT,
      pre_image_path TEXT,
      post_image_path TEXT,
      resume_path TEXT,
      prep_generated_at TEXT,
      actor TEXT,
      display_error TEXT,
      details_json TEXT
    );
    CREATE TABLE application_preps (
      job_id TEXT PRIMARY KEY,
      status TEXT,
      workflow TEXT,
      apply_url TEXT,
      page_issue TEXT,
      questions_json TEXT,
      answers_json TEXT,
      voice_checks_json TEXT,
      summary TEXT,
      error TEXT,
      generated_at TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      event_type TEXT,
      from_value TEXT,
      to_value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

async function withStubbedApplier(testFn, prepFactory) {
  const autoApplierPath = require.resolve('../lib/auto-applier');
  const applicationPrepPath = require.resolve('../lib/application-prep');
  const greenhousePath = require.resolve('../lib/ats-appliers/greenhouse');

  const originalAutoApplier = require.cache[autoApplierPath];
  const originalPrep = require.cache[applicationPrepPath];
  const originalGreenhouse = require.cache[greenhousePath];

  delete require.cache[autoApplierPath];
  require.cache[applicationPrepPath] = {
    exports: {
      prepareApplication: async () => prepFactory(),
      getApplicationPrep: () => prepFactory(),
    },
  };

  const calls = [];
  require.cache[greenhousePath] = {
    exports: {
      applyGreenhouse: async (_job, _applicant, options) => {
        calls.push(options);
        return {
          success: true,
          preImagePath: '/tmp/pre.png',
          postImagePath: '/tmp/post.png',
          details: {
            filledFields: ['Email', 'Phone'],
          },
        };
      },
    },
  };

  try {
    const autoApplier = require('../lib/auto-applier');
    return await testFn(autoApplier, calls);
  } finally {
    delete require.cache[autoApplierPath];
    if (originalAutoApplier) require.cache[autoApplierPath] = originalAutoApplier;
    else delete require.cache[autoApplierPath];

    if (originalPrep) require.cache[applicationPrepPath] = originalPrep;
    else delete require.cache[applicationPrepPath];

    if (originalGreenhouse) require.cache[greenhousePath] = originalGreenhouse;
    else delete require.cache[greenhousePath];
  }
}

describe('cli reviewed apply flow', () => {
  it('prepareOne returns review data without changing the job state', async () => {
    await withStubbedApplier(async ({ prepareOne }) => {
      const db = createDb();
      db.prepare(`
        INSERT INTO jobs (id, company, title, url, platform, score, status, apply_complexity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'greenhouse-1',
        'Acme',
        'Platform Engineer',
        'https://boards.greenhouse.io/acme/jobs/1',
        'greenhouse',
        9,
        'pending',
        'complex',
        '2026-04-22T12:00:00Z'
      );

      const result = await prepareOne(db, { applicant: {}, blocklist: [], platformBlocklist: [] }, 'greenhouse-1', { actor: 'test' });
      assert.equal(result.success, true);
      assert.equal(result.status, 'prepared');
      assert.equal(result.review.submitEligible, true);
      assert.equal(result.review.resolvedAnswers[0].label, 'Work authorization');

      const job = db.prepare('SELECT status, stage FROM jobs WHERE id = ?').get('greenhouse-1');
      assert.equal(job.status, 'pending');
      assert.equal(job.stage, null);
    }, () => ({
      status: 'ready',
      workflow: 'cli-review',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/1',
      questions: [
        { label: 'Work authorization', name: 'work_auth', type: 'select', required: true },
      ],
      answers: {
        work_auth: 'Yes',
      },
      voiceChecks: {
        lowConfidenceFields: [],
      },
      summary: 'Ready to submit',
      generated_at: '2026-04-22T12:00:00Z',
    }));
  });

  it('submitOne blocks unresolved required fields instead of guessing', async () => {
    await withStubbedApplier(async ({ submitOne }, calls) => {
      const db = createDb();
      db.prepare(`
        INSERT INTO jobs (id, company, title, url, platform, score, status, apply_complexity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'greenhouse-2',
        'Acme',
        'Site Reliability Engineer',
        'https://boards.greenhouse.io/acme/jobs/2',
        'greenhouse',
        8,
        'pending',
        'complex',
        '2026-04-22T12:00:00Z'
      );

      const result = await submitOne(db, { applicant: {}, blocklist: [], platformBlocklist: [] }, 'greenhouse-2', { actor: 'test' });
      assert.equal(result.success, false);
      assert.match(result.error, /Manual review required before submit/);
      assert.equal(calls.length, 0);

      const receipt = db.prepare('SELECT mode, status, details_json FROM auto_apply_log').get();
      assert.equal(receipt.mode, 'submit');
      assert.equal(receipt.status, 'failed');
      const details = JSON.parse(receipt.details_json);
      assert.deepEqual(details.unresolvedFields.map((field) => field.label), ['Portfolio URL']);
    }, () => ({
      status: 'ready',
      workflow: 'cli-review',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/2',
      questions: [
        { label: 'Work authorization', name: 'work_auth', type: 'select', required: true },
        { label: 'Portfolio URL', name: 'portfolio', type: 'text', required: true },
      ],
      answers: {
        work_auth: 'Yes',
      },
      voiceChecks: {
        lowConfidenceFields: [],
      },
      generated_at: '2026-04-22T12:00:00Z',
    }));
  });

  it('submitOne updates the job to applied and records screenshot/email verification details', async () => {
    await withStubbedApplier(async ({ submitOne }, calls) => {
      const db = createDb();
      db.prepare(`
        INSERT INTO jobs (id, company, title, url, platform, score, status, stage, apply_complexity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'greenhouse-3',
        'Acme',
        'Infrastructure Engineer',
        'https://boards.greenhouse.io/acme/jobs/3',
        'greenhouse',
        8,
        'pending',
        null,
        'complex',
        '2026-04-22T12:00:00Z'
      );

      const result = await submitOne(db, { applicant: {}, blocklist: [], platformBlocklist: [] }, 'greenhouse-3', { actor: 'test' });
      assert.equal(result.success, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].mode, 'submit');

      const job = db.prepare('SELECT status, stage, auto_apply_status FROM jobs WHERE id = ?').get('greenhouse-3');
      assert.equal(job.status, 'applied');
      assert.equal(job.stage, 'applied');
      assert.equal(job.auto_apply_status, 'success');

      const event = db.prepare('SELECT event_type, to_value FROM events').get();
      assert.equal(event.event_type, 'stage_change');
      assert.equal(event.to_value, 'applied');

      const receipt = db.prepare('SELECT status, details_json, pre_image_path, post_image_path FROM auto_apply_log').get();
      assert.equal(receipt.status, 'success');
      assert.equal(receipt.pre_image_path, '/tmp/pre.png');
      assert.equal(receipt.post_image_path, '/tmp/post.png');
      const details = JSON.parse(receipt.details_json);
      assert.equal(details.verification.confirmationEmail, true);
      assert.equal(details.verification.preSubmitScreenshot, '/tmp/pre.png');
      assert.equal(details.verification.postSubmitScreenshot, '/tmp/post.png');
    }, () => ({
      status: 'ready',
      workflow: 'cli-review',
      apply_url: 'https://boards.greenhouse.io/acme/jobs/3',
      questions: [
        { label: 'Work authorization', name: 'work_auth', type: 'select', required: true },
      ],
      answers: {
        work_auth: 'Yes',
      },
      voiceChecks: {
        lowConfidenceFields: [],
      },
      generated_at: '2026-04-22T12:00:00Z',
    }));
  });
});
