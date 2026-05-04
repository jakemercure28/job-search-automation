#!/usr/bin/env node
'use strict';

const path = require('path');

const { loadDashboardEnv } = require('../lib/env');

loadDashboardEnv(path.join(__dirname, '..'));

const {
  canonicalizeAlternateJob,
  getDb,
} = require('../lib/db');
const {
  isPrimaryPlatform,
  resolveAlternateJob,
} = require('../lib/ats-resolver');

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    onlyPending: argv.includes('--only-pending'),
    json: argv.includes('--json'),
  };
}

function formatEvidence(evidence = {}) {
  if (evidence.method) return evidence.method;
  if (evidence.unsupportedPlatform) return evidence.unsupportedPlatform;
  return evidence.reason || '';
}

function printReport(rows, { json }) {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.action] = (acc[row.action] || 0) + 1;
    return acc;
  }, {});
  console.log('ATS alias resolution report');
  console.table(counts);
  console.table(rows.map((row) => ({
    action: row.action,
    id: row.id,
    title: row.title,
    company: row.company,
    from: row.platform,
    to: row.resolvedPlatform || '',
    evidence: row.evidence,
  })));
}

function selectAlternateJobs(db, { onlyPending }) {
  const where = onlyPending
    ? "WHERE status = 'pending'"
    : 'WHERE 1 = 1';
  return db.prepare(`
    SELECT *
    FROM jobs
    ${where}
      AND LOWER(COALESCE(platform, '')) NOT IN ('ashby', 'greenhouse', 'lever', 'workday')
    ORDER BY
      CASE status WHEN 'pending' THEN 0 WHEN 'applied' THEN 1 ELSE 2 END,
      platform,
      company,
      title
  `).all();
}

function normalizedJobKey(job) {
  return `${String(job.company || '').trim().toLowerCase()}|||${String(job.title || '').trim().toLowerCase()}`;
}

function preferJob(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftPrimary = isPrimaryPlatform(left.platform);
  const rightPrimary = isPrimaryPlatform(right.platform);
  if (leftPrimary !== rightPrimary) return leftPrimary ? left : right;
  const leftHasDescription = String(left.description || '').length;
  const rightHasDescription = String(right.description || '').length;
  return rightHasDescription > leftHasDescription ? right : left;
}

function dedupeNormalizedJobs(jobs, report) {
  const byId = new Map();
  for (const job of jobs) {
    if (!job.id) continue;
    const winner = preferJob(byId.get(job.id), job);
    if (winner !== byId.get(job.id)) byId.set(job.id, winner);
  }

  const byKey = new Map();
  for (const job of byId.values()) {
    const key = normalizedJobKey(job);
    if (!key || key === '|||') continue;
    const existing = byKey.get(key);
    const winner = preferJob(existing, job);
    if (existing && winner !== existing) {
      report.push({
        id: existing.id,
        action: 'skipped-duplicate',
        platform: existing.platform,
        resolvedPlatform: winner.platform,
        title: existing.title,
        company: existing.company,
        evidence: 'preferred-primary-or-richer-row',
      });
    } else if (existing) {
      report.push({
        id: job.id,
        action: 'skipped-duplicate',
        platform: job.platform,
        resolvedPlatform: existing.platform,
        title: job.title,
        company: job.company,
        evidence: 'preferred-primary-or-richer-row',
      });
    }
    byKey.set(key, winner);
  }

  return [...byKey.values()];
}

const ATS_RESOLVE_CONCURRENCY = 6;

async function normalizeScrapedJobs(jobs, options = {}) {
  const resolutions = new Array(jobs.length);

  // Resolve alternate-platform jobs in parallel (bounded concurrency).
  // Primary-platform jobs are passed through without network work.
  // Gemini's own rate limiter serializes Gemini calls globally, so parallel
  // outer workers don't break the 12-req/min free-tier limit.
  await new Promise((resolve) => {
    let active = 0;
    let idx = 0;

    function next() {
      while (active < ATS_RESOLVE_CONCURRENCY && idx < jobs.length) {
        const i = idx++;
        const job = jobs[i];
        active++;
        const work = isPrimaryPlatform(job.platform)
          ? Promise.resolve({ status: 'primary', job, platform: job.platform, evidence: {} })
          : resolveAlternateJob(job, options);
        work.then((resolution) => {
          resolutions[i] = resolution;
          active--;
          if (idx >= jobs.length && active === 0) resolve();
          else next();
        });
      }
    }

    next();
    if (jobs.length === 0) resolve();
  });

  const normalized = [];
  const report = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const resolution = resolutions[i];

    if (isPrimaryPlatform(job.platform)) {
      normalized.push(job);
      continue;
    }

    if (resolution.status === 'primary' && resolution.job) {
      normalized.push(resolution.job);
      report.push({
        id: job.id,
        action: 'canonicalized',
        platform: job.platform,
        resolvedPlatform: resolution.platform,
        title: job.title,
        company: job.company,
        evidence: formatEvidence(resolution.evidence),
      });
    } else if (resolution.status === 'unsupported') {
      report.push({
        id: job.id,
        action: 'skipped-unsupported',
        platform: job.platform,
        resolvedPlatform: '',
        title: job.title,
        company: job.company,
        evidence: formatEvidence(resolution.evidence),
      });
    } else {
      normalized.push(job);
      report.push({
        id: job.id,
        action: 'unresolved',
        platform: job.platform,
        resolvedPlatform: '',
        title: job.title,
        company: job.company,
        evidence: formatEvidence(resolution.evidence),
      });
    }
  }

  const deduped = dedupeNormalizedJobs(normalized, report);
  if (options.log && report.length) options.log.info('Resolved alternate ATS jobs', { report });
  return { jobs: deduped, report };
}

async function resolveExistingJobs({ apply, onlyPending, json }) {
  const db = getDb();
  const rows = selectAlternateJobs(db, { onlyPending });
  const report = [];

  for (const row of rows) {
    const resolution = await resolveAlternateJob(row, { useGemini: true });
    let action = resolution.status;

    if (apply) {
      const result = canonicalizeAlternateJob(db, row, resolution);
      action = result.action;
    } else if (resolution.status === 'primary' && resolution.job) {
      action = 'would-canonicalize';
    } else if (resolution.status === 'unsupported') {
      action = 'would-archive-unsupported';
    }

    report.push({
      id: row.id,
      title: row.title,
      company: row.company,
      platform: row.platform,
      status: row.status,
      score: row.score,
      url: row.url,
      action,
      resolvedPlatform: resolution.platform || '',
      resolvedUrl: resolution.url || '',
      canonicalId: resolution.job?.id || '',
      confidence: resolution.confidence || 0,
      evidence: formatEvidence(resolution.evidence),
    });
  }

  printReport(report, { json });
  return report;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  resolveExistingJobs(options).catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  normalizeScrapedJobs,
  resolveExistingJobs,
  selectAlternateJobs,
};
