'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const {
  artifactPaths,
  generateTailoredResume,
  getTailoredResume,
  selectSourceResumeVariant,
} = require('../lib/tailored-resume');

function createProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailored-resume-profile-'));
  const resume = `# Test Candidate
test@example.com

## Summary
Platform engineer with Kubernetes and AI tooling experience.

## Experience
### Senior Platform Engineer — Acme
**2020 - Present**
- Built Kubernetes deployment automation.
- Built LLM evaluation tooling from existing platform signals.

## Skills
**Languages:** JavaScript, Go

## Education
University
`;
  fs.writeFileSync(path.join(dir, 'resume.md'), resume);
  fs.writeFileSync(path.join(dir, 'resume-devops.md'), resume.replace('AI tooling', 'infrastructure'));
  fs.writeFileSync(path.join(dir, 'resume-ai.md'), resume.replace('Kubernetes', 'LLM'));
  fs.writeFileSync(path.join(dir, 'context.md'), 'Use direct, factual language.');
  fs.writeFileSync(path.join(dir, 'career-detail.md'), 'Acme work included Kubernetes and LLM evaluation.');
  return { dir, resume };
}

function createDb() {
  const db = new Database(':memory:');
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

describe('tailored resume generation', () => {
  it('builds stable artifact paths under the profile tailored-resumes directory', () => {
    const paths = artifactPaths('greenhouse/123', '/tmp/profile');
    assert.equal(paths.dir, '/tmp/profile/tailored-resumes/greenhouse_123');
    assert.equal(paths.markdown, '/tmp/profile/tailored-resumes/greenhouse_123/resume.md');
    assert.equal(paths.html, '/tmp/profile/tailored-resumes/greenhouse_123/resume.html');
    assert.equal(paths.pdf, '/tmp/profile/tailored-resumes/greenhouse_123/resume.pdf');
    assert.equal(paths.metadata, '/tmp/profile/tailored-resumes/greenhouse_123/metadata.json');
  });

  it('selects a matching source resume variant when one exists', () => {
    const { dir } = createProfile();
    assert.equal(selectSourceResumeVariant({ title: 'AI Platform Engineer' }, dir).variant, 'ai');
    assert.equal(selectSourceResumeVariant({ title: 'Site Reliability Engineer Kubernetes' }, dir).variant, 'devops');
    assert.equal(selectSourceResumeVariant({ title: 'Backend Engineer' }, dir).variant, 'base');
  });

  it('writes markdown/html/metadata rows without rendering PDF when disabled', async () => {
    const { dir, resume } = createProfile();
    const db = createDb();
    const job = {
      id: 'job-1',
      title: 'AI Platform Engineer',
      company: 'Example',
      url: 'https://example.com/job',
      platform: 'Greenhouse',
      description: 'Work on LLM evaluation and platform automation.',
    };
    db.prepare(`
      INSERT INTO jobs (id, title, company, url, platform, description, status)
      VALUES (@id, @title, @company, @url, @platform, @description, 'pending')
    `).run(job);

    const result = await generateTailoredResume(db, job, {
      profileDir: dir,
      renderPdf: false,
      gemini: async () => JSON.stringify({
        resume_markdown: resume,
        summary: 'Focused on LLM evaluation and platform automation.',
        keywords: ['LLM evaluation', 'platform automation'],
      }),
    });

    assert.equal(result.status, 'ready');
    assert.equal(result.source_variant, 'ai');
    assert.equal(result.resume_pdf_path, null);
    assert.ok(fs.existsSync(result.resume_md_path));
    assert.ok(fs.existsSync(result.resume_html_path));
    assert.ok(fs.existsSync(result.metadata_path));
    assert.deepEqual(getTailoredResume(db, 'job-1').keywords, ['LLM evaluation', 'platform automation']);
  });
});
