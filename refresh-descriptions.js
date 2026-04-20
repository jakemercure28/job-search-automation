'use strict';

/**
 * refresh-descriptions.js
 * Re-fetches full descriptions for pipeline jobs from source APIs.
 * Covers Greenhouse, Ashby, Lever, Built In.
 * LinkedIn Easy Apply jobs are skipped (no API).
 *
 * Usage: node refresh-descriptions.js
 */

const DB_PATH = process.env.JOB_DB_PATH || 'profiles/example/jobs.db';
const db = require('better-sqlite3')(DB_PATH);
const { stripHtml } = require('./lib/utils');
const { ASHBY_COMPANIES, GREENHOUSE_COMPANIES, LEVER_COMPANIES } = require('./config/companies');
const { sleep } = require('./lib/utils');

const DELAY_MS = 350;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Slug lookup helpers
// ---------------------------------------------------------------------------

function buildSlugMap(slugs) {
  const map = {};
  for (const slug of slugs) {
    const key = slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    map[key] = slug;
  }
  return map;
}

const ashbyMap   = buildSlugMap(ASHBY_COMPANIES);
const ghMap      = buildSlugMap(GREENHOUSE_COMPANIES);
const leverMap   = buildSlugMap(LEVER_COMPANIES);

function findSlug(map, company) {
  const key = company.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  return map[key] || null;
}

// ---------------------------------------------------------------------------
// Per-platform refresh functions
// ---------------------------------------------------------------------------

async function refreshGreenhouse(job) {
  const slug = findSlug(ghMap, job.company);
  if (!slug) return { ok: false, reason: `no slug for "${job.company}"` };

  const jobId = job.id.replace('greenhouse-', '');
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}?content=true`).catch(() => null);
  if (!res?.ok) return { ok: false, reason: `HTTP ${res?.status}` };

  const data = await res.json().catch(() => null);
  if (!data?.content) return { ok: false, reason: 'no content' };

  return { ok: true, desc: stripHtml(data.content) };
}

// Ashby fetches the whole board at once; cache boards to avoid re-fetching per job
const _ashbyCache = {};
async function fetchAshbyBoard(slug) {
  if (_ashbyCache[slug]) return _ashbyCache[slug];
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  _ashbyCache[slug] = data?.jobs || [];
  return _ashbyCache[slug];
}

async function refreshAshby(job) {
  const slug = findSlug(ashbyMap, job.company);
  if (!slug) return { ok: false, reason: `no slug for "${job.company}"` };

  const jobs = await fetchAshbyBoard(slug);
  if (!jobs) return { ok: false, reason: 'board fetch failed' };

  const jobId = job.id.replace('ashby-', '');
  const found = jobs.find(j => j.id === jobId);
  if (!found) return { ok: false, reason: 'not on board (closed?)' };

  const { MAX_DESCRIPTION_LENGTH } = require('./config/constants');
  const baseDesc = found.descriptionPlain || stripHtml(found.descriptionHtml || '');
  const salarySummary = found.compensation?.scrapeableCompensationSalarySummary
    || found.compensation?.compensationTierSummary
    || '';
  const desc = (salarySummary ? `Compensation: ${salarySummary}\n\n${baseDesc}` : baseDesc)
    .slice(0, MAX_DESCRIPTION_LENGTH);
  const loc  = found.location || found.address?.postalAddress?.addressLocality || (found.isRemote ? 'Remote' : job.location);
  return { ok: true, desc, loc };
}

// Lever fetches the whole board at once; cache too
const _leverCache = {};
async function fetchLeverBoard(slug) {
  if (_leverCache[slug]) return _leverCache[slug];
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  _leverCache[slug] = Array.isArray(data) ? data : [];
  return _leverCache[slug];
}

async function refreshLever(job) {
  const slug = findSlug(leverMap, job.company);
  if (!slug) return { ok: false, reason: `no slug for "${job.company}"` };

  const jobs = await fetchLeverBoard(slug);
  if (!jobs) return { ok: false, reason: 'board fetch failed' };

  const jobId = job.id.replace('lever-', '');
  const found = jobs.find(j => j.id === jobId);
  if (!found) return { ok: false, reason: 'not on board (closed?)' };

  const parts = [found.descriptionPlain || stripHtml(found.description || '')];
  for (const s of (found.lists || [])) {
    if (s.text) parts.push(s.text + ':');
    if (s.content) parts.push(stripHtml(s.content));
  }
  if (found.closing) parts.push(stripHtml(found.closing));
  return { ok: true, desc: parts.filter(Boolean).join('\n\n') };
}

async function refreshBuiltIn(job) {
  const res = await fetch(job.url, { headers: { 'User-Agent': UA } }).catch(() => null);
  if (!res?.ok) return { ok: false, reason: `HTTP ${res?.status}` };

  const html = await res.text().catch(() => null);
  if (!html) return { ok: false, reason: 'no html' };

  const ldMatch = html.match(/<script[^>]+ld[^>]+>([\s\S]*?)<\/script>/);
  if (!ldMatch) return { ok: false, reason: 'no LD+JSON' };

  let posting;
  try {
    const raw = ldMatch[1]
      .replace(/&#x2B;/g, '+').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const data = JSON.parse(raw);
    const graph = data['@graph'] || [data];
    posting = graph.find(i => i['@type'] === 'JobPosting');
  } catch { return { ok: false, reason: 'JSON parse failed' }; }

  if (!posting) return { ok: false, reason: 'no JobPosting in LD+JSON' };

  const salary = posting.baseSalary?.value || {};
  const salaryStr = salary.minValue && salary.maxValue
    ? `$${Math.round(salary.minValue / 1000)}K–$${Math.round(salary.maxValue / 1000)}K`
    : '';
  const desc = (salaryStr ? salaryStr + ' | ' : '') + stripHtml(posting.description || '');
  return { ok: true, desc };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const jobs = db.prepare(`
    SELECT id, company, title, platform, url, score, location
    FROM jobs
    WHERE status != 'archived'
    ORDER BY platform, company
  `).all();

  console.log(`Total jobs: ${jobs.length}`);

  let ok = 0, skipped = 0, failed = 0;

  for (const job of jobs) {
    const p = job.platform?.toLowerCase() || '';

    let result;
    if      (p === 'greenhouse')       result = await refreshGreenhouse(job);
    else if (p === 'ashby')            result = await refreshAshby(job);
    else if (p === 'lever')            result = await refreshLever(job);
    else if (p === 'built in')         result = await refreshBuiltIn(job);
    else { skipped++; continue; } // LinkedIn Easy Apply, Workday, etc.

    if (!result.ok) {
      console.log(`  [skip] ${job.company} - ${job.title}: ${result.reason}`);
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    const desc = result.desc || '';
    const loc  = result.loc  || job.location;
    db.prepare('UPDATE jobs SET description=?, location=? WHERE id=?')
      .run(desc, loc, job.id);

    console.log(`  [ok] ${job.company} - ${job.title} | ${desc.length} chars`);
    ok++;

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch(console.error);
