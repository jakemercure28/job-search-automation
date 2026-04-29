'use strict';

/**
 * check-closed.js
 *
 * Checks whether active pipeline/pending jobs are still open on their source ATS.
 * Marks any that have closed as stage='closed'.
 *
 * Runs as part of the daily pipeline (run-daily.sh).
 *
 * Platform strategies:
 *   Greenhouse  — native canonical ATS URLs only
 *   Ashby       — native canonical ATS URLs only
 */

const path = require('path');

const Database = require('better-sqlite3');
const { sleep } = require('../lib/utils');
const { logEvent } = require('../lib/db');
const logPaths = require('../lib/log-paths');
const log = require('../lib/logger')('check-closed', { logFile: logPaths.daily('check-closed') });

const DB_PATH = process.env.JOB_DB_PATH || path.join(__dirname, '../profiles/example/jobs.db');

const DELAY_MS = 300; // between API calls

// ── helpers ──────────────────────────────────────────────────────────────────

async function httpGet(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-search-bot/1.0)' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    return res;
  } catch (_) {
    return null;
  }
}

function extractSlugFromUrl(url, platform) {
  try {
    const u = new URL(url);
    if (platform === 'Greenhouse') {
      // https://job-boards.greenhouse.io/{slug}/jobs/{id}
      const parts = u.pathname.split('/').filter(Boolean);
      if (u.hostname.includes('greenhouse.io') && parts[0]) return parts[0];
    }
    if (platform === 'Ashby') {
      // https://jobs.ashbyhq.com/{slug}/{uuid}
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0]) return parts[0];
    }
  } catch (_) {}
  return null;
}

function extractJobUUID(id, platform) {
  if (platform === 'Greenhouse') return id.replace(/^greenhouse-/, '');
  if (platform === 'Ashby') return id.replace(/^ashby-/, '');
  return null;
}

function getAutoCloseEligibility(job) {
  if (!job || !job.url || !job.id) return null;

  try {
    const u = new URL(job.url);
    const platform = String(job.platform || '').toLowerCase();

    if (platform === 'greenhouse') {
      if (!job.id.startsWith('greenhouse-')) return null;
      if (u.protocol !== 'https:') return null;
      if (u.hostname !== 'boards.greenhouse.io' && u.hostname !== 'job-boards.greenhouse.io') return null;

      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length !== 3 || parts[1] !== 'jobs') return null;

      const [, , jobId] = parts;
      if (jobId !== extractJobUUID(job.id, 'Greenhouse')) return null;

      return { platform: 'Greenhouse', slug: parts[0], jobId };
    }

    if (platform === 'ashby') {
      if (!job.id.startsWith('ashby-')) return null;
      if (u.protocol !== 'https:') return null;
      if (u.hostname !== 'jobs.ashbyhq.com') return null;

      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length !== 2) return null;

      const [slug, uuid] = parts;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) return null;
      if (uuid !== extractJobUUID(job.id, 'Ashby')) return null;

      return { platform: 'Ashby', slug, jobId: uuid };
    }
  } catch (_) {
    return null;
  }

  return null;
}

// ── Greenhouse ────────────────────────────────────────────────────────────────

async function checkGreenhouse(job, eligibility = getAutoCloseEligibility(job)) {
  if (!eligibility || eligibility.platform !== 'Greenhouse') return null;

  const apiUrl = `https://api.greenhouse.io/v1/boards/${eligibility.slug}/jobs/${eligibility.jobId}`;
  const res = await httpGet(apiUrl);
  if (!res) return null; // network error, don't mark closed
  if (res.status === 404) return 'closed';
  // Only treat other 4xx as closed if body explicitly says the job is gone.
  // Avoid marking closed on rate-limit (429), server errors (5xx), or generic error bodies.
  if (res.status === 410) return 'closed';
  if (res.status >= 400 && res.status < 500 && res.status !== 429) {
    try {
      const text = await res.text();
      if (/no longer (accepting|open|available)|job (has been|is) (closed|removed|filled)/i.test(text)) return 'closed';
    } catch (_) {}
  }
  return 'open';
}

// ── Ashby ────────────────────────────────────────────────────────────────────

const ashbyBoardCache = {};

async function checkAshby(job, eligibility = getAutoCloseEligibility(job)) {
  if (!eligibility || eligibility.platform !== 'Ashby') return null;

  if (!ashbyBoardCache[eligibility.slug]) {
    const res = await httpGet(`https://api.ashbyhq.com/posting-api/job-board/${eligibility.slug}`);
    if (!res || !res.ok) return null;
    try {
      const d = await res.json();
      ashbyBoardCache[eligibility.slug] = new Set((d.jobs || []).map(j => j.id));
    } catch (_) {
      return null;
    }
  }

  return ashbyBoardCache[eligibility.slug].has(eligibility.jobId) ? 'open' : 'closed';
}

// ── main ────────────────────────────────────────────────────────────────────

const CHECK_CONCURRENCY = 10;

async function checkJob(job) {
  const eligibility = getAutoCloseEligibility(job);
  if (!eligibility) return null;
  if (eligibility.platform === 'Greenhouse') return checkGreenhouse(job, eligibility);
  if (eligibility.platform === 'Ashby') return checkAshby(job, eligibility);
  return null;
}

async function main({ dbPath = DB_PATH, database = null } = {}) {
  const db = database || new Database(dbPath);
  try {
    const jobs = db.prepare(`
      SELECT id, company, title, platform, url, stage
      FROM jobs
      WHERE status != 'archived'
        AND (stage IS NULL OR stage NOT IN ('closed', 'rejected', 'offer'))
      ORDER BY platform, company
    `).all();

    log.info('Checking jobs for closure', { count: jobs.length });

    let closed = 0;
    let checked = 0;
    let skipped = 0;

    for (let i = 0; i < jobs.length; i += CHECK_CONCURRENCY) {
      const batch = jobs.slice(i, i + CHECK_CONCURRENCY);
      const results = await Promise.allSettled(batch.map(job => checkJob(job)));

      for (let j = 0; j < batch.length; j++) {
        const job = batch[j];
        const r = results[j];
        const result = r.status === 'fulfilled' ? r.value : null;

        if (result === null) {
          skipped++;
        } else if (result === 'closed') {
          db.prepare(`
            UPDATE jobs SET stage='closed', status='closed', updated_at=datetime('now') WHERE id=?
          `).run(job.id);
          logEvent(db, job.id, 'stage_change', job.stage || null, 'closed');
          log.info('Job closed', { company: job.company, title: job.title, platform: job.platform });
          closed++;
          checked++;
        } else {
          checked++;
        }
      }

      if (i + CHECK_CONCURRENCY < jobs.length) await sleep(DELAY_MS);
    }

    log.info('Done', { checked, closed, skipped });

    return { checked, closed, skipped };
  } finally {
    if (!database) db.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    log.error('check-closed error', { error: err.message });
    process.exit(1);
  });
}

module.exports = {
  checkAshby,
  checkGreenhouse,
  checkJob,
  extractJobUUID,
  extractSlugFromUrl,
  getAutoCloseEligibility,
  httpGet,
  main,
};
