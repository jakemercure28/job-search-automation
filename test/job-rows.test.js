'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const { fetchFilteredJobs } = require('../lib/dashboard-routes');
const { renderJobTable } = require('../lib/html/job-rows');

function createDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-job-rows-'));
  const db = new Database(path.join(dir, 'jobs.db'));
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

function insertRejectedJob(db, job) {
  db.prepare(`
    INSERT INTO jobs (
      id, title, company, url, platform, location, posted_at, description,
      score, status, applied_at, stage, rejected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, 'rejected', ?, ?)
  `).run(
    job.id,
    job.title || 'Platform Engineer',
    job.company || 'Acme',
    job.url || `https://example.com/jobs/${job.id}`,
    'Greenhouse',
    'Remote',
    job.posted_at || '2026-03-01',
    'Build infrastructure',
    job.score,
    job.applied_at || '2026-04-01T00:00:00Z',
    job.rejected_at,
    job.updated_at || job.rejected_at
  );
}

describe('renderJobTable', () => {
  it('renders company badges with stable ordering and an applied-date badge', () => {
    const html = renderJobTable([
      {
        id: 'job-1',
        title: 'Platform Engineer',
        company: 'Acme',
        url: 'https://example.com/jobs/1',
        location: 'Remote',
        description: 'Salary range: $150k - $180k',
        status: 'applied',
        stage: 'applied',
        applied_at: '2026-04-14T12:00:00Z',
        score: 9,
        apply_complexity: 'complex',
      },
    ], {}, { acme: ['zeta', 'agency', 'alpha'] }, 'applied', 'score', '', null);

    assert.match(html, /class="job-badges"/);
    assert.match(html, /Applied 2026-04-14/);

    const agencyIndex = html.indexOf('>agency<');
    const alphaIndex = html.indexOf('>alpha<');
    const zetaIndex = html.indexOf('>zeta<');
    const appliedDateIndex = html.indexOf('>Applied 2026-04-14<');

    assert.ok(agencyIndex >= 0);
    assert.ok(alphaIndex > agencyIndex);
    assert.ok(zetaIndex > alphaIndex);
    assert.ok(appliedDateIndex > zetaIndex);
    assert.doesNotMatch(html, />simple</);
    assert.doesNotMatch(html, />complex</);
  });

  it('preserves search state in pagination and sort links', () => {
    const html = renderJobTable([
      {
        id: 'job-2',
        title: 'Platform Engineer',
        company: 'Acme',
        url: 'https://example.com/jobs/2',
        location: 'Remote',
        description: 'AWS and Kubernetes',
        status: 'pending',
        stage: '',
        posted_at: '2026-04-14',
        score: 8,
      },
    ], {}, {}, 'all', 'score', '1', {
      page: 2,
      totalPages: 3,
      startItem: 26,
      endItem: 50,
      totalItems: 61,
    }, {
      q: 'platform aws',
      minScore: 8,
    });

    assert.match(html, /href="\/\?filter=all&sort=score&level=1&q=platform\+aws&minScore=8"/);
    assert.match(html, /href="\/\?filter=all&sort=score&level=1&q=platform\+aws&minScore=8&page=3"/);
    assert.match(html, /onclick="location='\/\?filter=all&sort=date&level=1&q=platform\+aws&minScore=8'"/);
  });

  it('uses rejected date as the rejected view date column', () => {
    const html = renderJobTable([
      {
        id: 'job-rejected',
        title: 'SRE',
        company: 'Acme',
        url: 'https://example.com/jobs/rejected',
        location: 'Remote',
        description: '',
        status: 'rejected',
        stage: 'rejected',
        applied_at: '2026-04-01T12:00:00Z',
        rejected_at: '2026-04-28T12:00:00Z',
        posted_at: '2026-03-01',
        score: 7,
      },
    ], {}, {}, 'rejected', 'date', '', null);

    assert.match(html, /Date Rejected/);
    assert.match(html, /<div class="job-col-date">Apr 28<\/div>/);
    assert.doesNotMatch(html, /<div class="job-col-date">Mar 1<\/div>/);
    assert.match(html, /class="job-list filter-rejected"/);
  });

  it('does not show auto-apply badges and exposes manual prep/resume actions only', () => {
    const html = renderJobTable([
      {
        id: 'job-3',
        title: 'Infrastructure Engineer',
        company: 'Ashby Co',
        url: 'https://jobs.ashbyhq.com/blocked/12345678-1234-1234-1234-123456789012',
        location: 'Remote',
        description: '',
        status: 'pending',
        stage: null,
        score: 8,
        apply_complexity: 'complex',
        auto_apply_status: 'failed',
        auto_apply_error: 'Required fields still empty before submit',
        tailored_resume_status: 'ready',
      },
      {
        id: 'job-4',
        title: 'DevOps Engineer',
        company: 'Lever Co',
        url: 'https://jobs.lever.co/leverco/12345678-1234-1234-1234-123456789012',
        location: 'Remote',
        description: '',
        status: 'pending',
        stage: null,
        score: 8,
        apply_complexity: null,
      },
    ], {}, {}, 'not-applied', 'score', '', null);

    assert.doesNotMatch(html, /Auto-apply failed/);
    assert.doesNotMatch(html, /autox/);
    assert.match(html, /Manual Apply Prep/);
    assert.equal((html.match(/Tailor Resume/g) || []).length, 2);
    assert.equal((html.match(/View Tailored Resume/g) || []).length, 1);
    assert.doesNotMatch(html, /Apply Now/);
    assert.doesNotMatch(html, />simple</);
    assert.doesNotMatch(html, />complex</);
  });
});

describe('fetchFilteredJobs', () => {
  it('sorts rejected jobs by rejection date by default sort and by score when requested', () => {
    const db = createDb();
    insertRejectedJob(db, {
      id: 'low-newest',
      score: 5,
      rejected_at: '2026-04-28T12:00:00Z',
    });
    insertRejectedJob(db, {
      id: 'high-oldest',
      score: 9,
      rejected_at: '2026-04-01T12:00:00Z',
    });
    insertRejectedJob(db, {
      id: 'high-middle',
      score: 9,
      rejected_at: '2026-04-20T12:00:00Z',
    });

    assert.deepEqual(
      fetchFilteredJobs(db, 'rejected', 'date').map((job) => job.id),
      ['low-newest', 'high-middle', 'high-oldest']
    );
    assert.deepEqual(
      fetchFilteredJobs(db, 'rejected', 'score').map((job) => job.id),
      ['high-middle', 'high-oldest', 'low-newest']
    );
  });
});
