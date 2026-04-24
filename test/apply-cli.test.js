'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const { buildShowPayload, listJobs } = require('../scripts/apply-cli');
const { generateTailoredResume } = require('../lib/tailored-resume');

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

function insertJob(db, row) {
  db.prepare(`
    INSERT INTO jobs (id, title, company, url, platform, description, score, status, created_at)
    VALUES (@id, @title, @company, @url, @platform, @description, @score, @status, @created_at)
  `).run(row);
}

function createProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-cli-profile-'));
  const resume = `# Test Candidate
test@example.com

## Summary
Platform engineer.

## Experience
### Senior Platform Engineer — Acme
**2020 - Present**
- Built Kubernetes automation.

## Skills
**Languages:** JavaScript
`;
  fs.writeFileSync(path.join(dir, 'resume.md'), resume);
  fs.writeFileSync(path.join(dir, 'context.md'), 'Context');
  fs.writeFileSync(path.join(dir, 'career-detail.md'), 'Career detail');
  return { dir, resume };
}

describe('apply-cli helpers', () => {
  it('lists jobs by status, company, title, and score filters', () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      title: 'Platform Engineer',
      company: 'Acme',
      url: 'https://example.com/1',
      platform: 'Greenhouse',
      description: '',
      score: 9,
      status: 'pending',
      created_at: '2026-04-01T00:00:00Z',
    });
    insertJob(db, {
      id: 'job-2',
      title: 'Frontend Engineer',
      company: 'Other',
      url: 'https://example.com/2',
      platform: 'Lever',
      description: '',
      score: 6,
      status: 'pending',
      created_at: '2026-04-02T00:00:00Z',
    });

    const rows = listJobs(db, {
      status: 'pending',
      company: 'acme',
      title: 'platform',
      'min-score': '8',
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'job-1');
  });

  it('show payload includes URL, prep status, and tailored resume path', async () => {
    const db = createDb();
    const { dir, resume } = createProfile();
    const job = {
      id: 'job-1',
      title: 'Platform Engineer',
      company: 'Acme',
      url: 'https://example.com/1',
      platform: 'Greenhouse',
      description: 'Kubernetes automation',
      score: 9,
      status: 'pending',
      created_at: '2026-04-01T00:00:00Z',
    };
    insertJob(db, job);
    db.prepare(`
      INSERT INTO application_preps (job_id, status, workflow, apply_url, generated_at)
      VALUES ('job-1', 'ready', 'manual', 'https://example.com/apply', '2026-04-01T00:00:00Z')
    `).run();

    await generateTailoredResume(db, job, {
      profileDir: dir,
      renderPdf: false,
      gemini: async () => JSON.stringify({
        resume_markdown: resume,
        summary: 'Focused on platform work.',
        keywords: ['Kubernetes'],
      }),
    });

    const payload = buildShowPayload(db, job, dir);
    assert.equal(payload.job_url, 'https://example.com/1');
    assert.equal(payload.prep_status, 'ready');
    assert.match(payload.tailored_resume, /resume\.html$/);
    assert.equal(payload.base_resume, path.join(dir, 'resume.md'));
  });
});
