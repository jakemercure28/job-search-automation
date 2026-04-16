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
 *   Greenhouse  — GET /v1/boards/{slug}/jobs/{id} → 404 = closed
 *   Ashby       — fetch board listing once per slug, check if job ID still present
 *   Lever       — GET /v0/postings/{slug}/{uuid} → 404 = closed
 *   others      — GET the job URL, look for 404 or known "closed" markers in HTML
 */

const path = require('path');

const Database = require('better-sqlite3');
const { sleep } = require('./lib/utils');
const { logEvent } = require('./lib/db');
const log = require('./lib/logger')('check-closed');

const DB_PATH = process.env.JOB_DB_PATH || path.join(__dirname, 'profiles/example/jobs.db');
const db = new Database(DB_PATH);

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
      // https://{company}.com/... with ?gh_jid={id} — fall back to extracting from path
      const parts = u.pathname.split('/').filter(Boolean);
      if (u.hostname.includes('greenhouse.io') && parts[0]) return parts[0];
      // Custom domain like coinbase.com — use gh_jid param, slug from GREENHOUSE_COMPANIES
      return null;
    }
    if (platform === 'Ashby') {
      // https://jobs.ashbyhq.com/{slug}/{uuid}
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0]) return parts[0];
    }
    if (platform === 'Lever') {
      // https://jobs.lever.co/{slug}/{uuid}
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0]) return parts[0];
    }
  } catch (_) {}
  return null;
}

function extractJobUUID(id, platform) {
  if (platform === 'Greenhouse') return id.replace(/^greenhouse-/, '');
  if (platform === 'Ashby') return id.replace(/^ashby-/, '');
  if (platform === 'Lever') return id.replace(/^lever-/, '');
  return null;
}

// ── Greenhouse ────────────────────────────────────────────────────────────────

async function checkGreenhouse(job) {
  const slug = extractSlugFromUrl(job.url, 'Greenhouse');
  if (!slug) return null; // can't determine slug, skip

  // Prefer the job ID from the URL path — stored IDs may use a different format
  // (e.g. "builtin-12345" for Built In jobs) and won't match GH's API.
  // URL path: /{slug}/jobs/{ghJobId} or custom domain with ?gh_jid=
  let jobId = null;
  try {
    const u = new URL(job.url);
    if (u.hostname.includes('greenhouse.io')) {
      const parts = u.pathname.split('/').filter(Boolean);
      const jobsIdx = parts.indexOf('jobs');
      if (jobsIdx !== -1 && parts[jobsIdx + 1]) jobId = parts[jobsIdx + 1];
    }
    if (!jobId) jobId = u.searchParams.get('gh_jid');
  } catch (_) {}
  if (!jobId) jobId = extractJobUUID(job.id, 'Greenhouse'); // fallback

  const apiUrl = `https://api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`;
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

async function checkAshby(job) {
  const slug = extractSlugFromUrl(job.url, 'Ashby');
  if (!slug) return null;

  // Extract UUID from URL path — more reliable than the job ID, which may use a
  // different prefix for cross-platform jobs (e.g. "builtin-4460810" for Built In).
  let uuid;
  try {
    const u = new URL(job.url);
    const parts = u.pathname.split('/').filter(Boolean);
    uuid = parts[1]; // jobs.ashbyhq.com/{slug}/{uuid}
  } catch (_) {}
  if (!uuid) uuid = extractJobUUID(job.id, 'Ashby'); // fallback

  if (!ashbyBoardCache[slug]) {
    const res = await httpGet(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    if (!res || !res.ok) return null;
    try {
      const d = await res.json();
      ashbyBoardCache[slug] = new Set((d.jobs || []).map(j => j.id));
    } catch (_) {
      return null;
    }
  }

  return ashbyBoardCache[slug].has(uuid) ? 'open' : 'closed';
}

// ── Lever ────────────────────────────────────────────────────────────────────

async function checkLever(job) {
  const slug = extractSlugFromUrl(job.url, 'Lever');
  if (!slug) return null;
  const uuid = extractJobUUID(job.id, 'Lever');
  const res = await httpGet(`https://api.lever.co/v0/postings/${slug}/${uuid}`);
  if (!res) return null;
  if (res.status === 404) return 'closed';
  if (res.ok) return 'open';
  return null;
}

// ── Rippling ─────────────────────────────────────────────────────────────────

const ripplingBoardCache = {};

async function checkRippling(job) {
  let slug, uuid;
  try {
    const u = new URL(job.url);
    // https://ats.rippling.com/{slug}/jobs/{uuid}
    const parts = u.pathname.split('/').filter(Boolean);
    slug = parts[0];
    uuid = parts[2]; // parts: [slug, 'jobs', uuid]
  } catch (_) {}
  if (!slug || !uuid) return null;

  if (!ripplingBoardCache[slug]) {
    const uuids = new Set();
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const url = page === 0
        ? `https://ats.rippling.com/${slug}/jobs`
        : `https://ats.rippling.com/${slug}/jobs?page=${page}`;
      const res = await httpGet(url);
      if (!res || !res.ok) break;
      try {
        const html = await res.text();
        const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!match) break;
        const data = JSON.parse(match[1]);
        const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
        const jobsQuery = queries.find(q => Array.isArray(q.queryKey) && q.queryKey[2] === 'job-posts');
        const pageData = jobsQuery?.state?.data;
        if (!pageData) break;
        for (const item of pageData.items || []) uuids.add(item.id);
        totalPages = pageData.totalPages || 1;
      } catch (_) { break; }
      page++;
      await sleep(DELAY_MS);
    }

    ripplingBoardCache[slug] = uuids;
  }

  return ripplingBoardCache[slug].has(uuid) ? 'open' : 'closed';
}

// ── Generic URL check ────────────────────────────────────────────────────────

const CLOSED_PATTERNS = [
  /no longer (accepting|open|available)/i,
  /job (is|has been) (closed|removed|expired|filled)/i,
  /position (has been|is) (filled|closed)/i,
  /this (position|job|role) is no longer/i,
  /posting.*(expired|removed|closed)/i,
];

async function checkGenericUrl(job) {
  if (!job.url || job.url.includes('linkedin.com')) return null; // LinkedIn blocks bots
  const res = await httpGet(job.url);
  if (!res) return null;
  if (res.status === 404 || res.status === 410) return 'closed';
  if (res.status === 200) {
    try {
      const text = await res.text();
      if (CLOSED_PATTERNS.some(p => p.test(text))) return 'closed';
    } catch (_) {}
  }
  return 'open';
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  // Check all non-archived, non-terminal jobs
  const jobs = db.prepare(`
    SELECT id, company, title, platform, url, stage
    FROM jobs
    WHERE status != 'archived'
      AND stage NOT IN ('closed', 'rejected', 'offer')
    ORDER BY platform, company
  `).all();

  console.log(`Checking ${jobs.length} jobs for closure...`);

  let closed = 0;
  let checked = 0;
  let skipped = 0;

  for (const job of jobs) {
    let result = null;

    // Route by platform — but also check URL for cross-platform cases
    // (e.g. Built In jobs that link directly to Greenhouse/Ashby/Lever)
    const urlStr = job.url || '';
    const isGHUrl = urlStr.includes('greenhouse.io') || urlStr.includes('careerpuck.com');
    const isAshbyUrl = urlStr.includes('ashbyhq.com');
    const isLeverUrl = urlStr.includes('lever.co');
    const isRipplingUrl = urlStr.includes('ats.rippling.com');

    if (job.platform === 'Greenhouse' || (isGHUrl && job.platform !== 'Greenhouse')) {
      result = await checkGreenhouse({ ...job, platform: 'Greenhouse' });
    } else if (job.platform === 'Ashby' || job.platform === 'ashby' || isAshbyUrl) {
      result = await checkAshby({ ...job, platform: 'Ashby' });
    } else if (job.platform === 'Lever' || isLeverUrl) {
      result = await checkLever({ ...job, platform: 'Lever' });
    } else if (job.platform === 'Rippling' || isRipplingUrl) {
      result = await checkRippling(job);
    } else {
      result = await checkGenericUrl(job);
    }

    if (result === null) {
      skipped++;
    } else if (result === 'closed') {
      db.prepare(`
        UPDATE jobs SET stage='closed', updated_at=datetime('now') WHERE id=?
      `).run(job.id);
      logEvent(db, job.id, 'stage_change', job.stage || null, 'closed');
      console.log(`  [closed] ${job.company} / ${job.title} (${job.platform})`);
      closed++;
      checked++;
    } else {
      checked++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`Done. checked=${checked} closed=${closed} skipped=${skipped}`);
}

main().catch(err => {
  console.error('check-closed error:', err.message);
  process.exit(1);
});
