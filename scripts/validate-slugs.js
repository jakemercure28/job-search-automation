'use strict';

/**
 * validate-slugs.js
 * Hits each ATS API for every slug in companies.js and reports:
 *   ok     — 200 + at least one job posting
 *   empty  — 200 but zero jobs (valid slug, nothing posted right now)
 *   broken — non-200 / network error (slug is wrong or company left the ATS)
 *
 * Usage:
 *   node validate-slugs.js                          # all ATS
 *   node validate-slugs.js --ats greenhouse         # one ATS only
 *   node validate-slugs.js --broken-only            # suppress ok/empty lines
 */

const {
  GREENHOUSE_COMPANIES,
  LEVER_COMPANIES,
  WORKABLE_COMPANIES,
  ASHBY_COMPANIES,
  WORKDAY_COMPANIES,
  RIPPLING_COMPANIES,
} = require('../config/companies');

const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger');
const logPaths = require('../lib/log-paths');

const log = createLogger('slug-health', { logFile: logPaths.daily('slug-health') });

const TIMEOUT_MS = 20000;
const DELAY_MS   = 120;

function parseArgs(argv) {
  return {
    filterAts: argv.includes('--ats') ? argv[argv.indexOf('--ats') + 1]?.toLowerCase() : null,
    brokenOnly: argv.includes('--broken-only'),
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeFetch(url, opts = {}, retries = 2) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429 && retries > 0) {
      await sleep(3000);
      return safeFetch(url, opts, retries - 1);
    }
    return res;
  } catch (e) {
    return { ok: false, status: 0, _error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Per-ATS checkers
// ---------------------------------------------------------------------------

async function checkGreenhouse(slug) {
  const res = await safeFetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  if (!res.ok) return { result: 'broken', note: `HTTP ${res.status || res._error}` };
  const data = await res.json().catch(() => null);
  const count = data?.jobs?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count };
}

async function checkLever(slug) {
  const res = await safeFetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!res.ok) return { result: 'broken', note: `HTTP ${res.status || res._error}` };
  const data = await res.json().catch(() => null);
  const count = Array.isArray(data) ? data.length : 0;
  return { result: count > 0 ? 'ok' : 'empty', count };
}

async function checkAshby(slug) {
  const res = await safeFetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  if (!res.ok) return { result: 'broken', note: `HTTP ${res.status || res._error}` };
  const data = await res.json().catch(() => null);
  const count = data?.jobs?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count };
}

async function checkWorkday({ sub, wd, board }) {
  const url = `https://${sub}.wd${wd}.myworkdayjobs.com/wday/cxs/${sub}/${board}/jobs`;
  const res = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1, offset: 0, searchText: '' }),
  });
  if (!res.ok) return { result: 'broken', note: `HTTP ${res.status || res._error}` };
  const data = await res.json().catch(() => null);
  const count = data?.total ?? data?.jobPostings?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count };
}

async function checkWorkable(slug) {
  const res = await safeFetch(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
  });
  if (!res.ok) return { result: 'broken', note: `HTTP ${res.status || res._error}` };
  const data = await res.json().catch(() => null);
  const count = data?.results?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count };
}

async function checkRippling(slug) {
  const res = await safeFetch(`https://ats.rippling.com/${slug}/jobs`, {
    headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return { result: 'broken', note: `HTTP ${res.status || res._error}` };
  const html = await res.text().catch(() => '');
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return { result: 'broken', note: 'Missing Rippling job data' };

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    return { result: 'broken', note: `Invalid Rippling job data: ${e.message}` };
  }

  const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
  const jobsQuery = queries.find(q => Array.isArray(q.queryKey) && q.queryKey[2] === 'job-posts');
  const jobsData = jobsQuery?.state?.data;
  const count = jobsData?.totalItems ?? jobsData?.total ?? jobsData?.items?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runBatch(name, items, checkFn, labelFn, options, allBroken, delayMs = DELAY_MS) {
  if (options.filterAts && options.filterAts !== name.toLowerCase()) return null;

  const ok = [], empty = [], broken = [];
  log.info('ATS slug validation started', { ats: name, entries: items.length });
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${name} (${items.length} entries)`);
  console.log('─'.repeat(50));

  for (const item of items) {
    const label = labelFn(item);
    const { result, count, note } = await checkFn(item);

    if (result === 'ok') {
      ok.push(label);
      if (!options.brokenOnly) console.log(`  ✓ ${label}  (${count} jobs)`);
    } else if (result === 'empty') {
      empty.push(label);
      if (!options.brokenOnly) console.log(`  ○ ${label}  (no current postings)`);
    } else {
      broken.push({ label, note });
      allBroken.push({ ats: name, slug: label, note });
      log.warn('Broken ATS slug detected', { ats: name, slug: label, note });
      console.log(`  ✗ ${label}  — ${note}`);
    }

    await sleep(delayMs);
  }

  console.log(`\n  ok: ${ok.length}  empty: ${empty.length}  broken: ${broken.length}`);
  const summary = { ok: ok.length, empty: empty.length, broken: broken.length };
  log.info('ATS slug validation complete', { ats: name, entries: items.length, ...summary });
  return summary;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function activeProfileDir() {
  return process.env.JOB_PROFILE_DIR
    ? path.resolve(process.env.JOB_PROFILE_DIR)
    : path.join(__dirname, '..', 'profiles', 'example');
}

function atsBatches() {
  return [
    ['Greenhouse', GREENHOUSE_COMPANIES || [], checkGreenhouse, s => s],
    ['Lever',      LEVER_COMPANIES || [],      checkLever,      s => s],
    ['Ashby',      ASHBY_COMPANIES || [],      checkAshby,      s => s],
    ['Workable',   WORKABLE_COMPANIES || [],   checkWorkable,   s => s,       800],
    ['Workday',    WORKDAY_COMPANIES || [],    checkWorkday,    c => c.label || c.sub],
    ['Rippling',   RIPPLING_COMPANIES || [],   checkRippling,   s => s,       300],
  ];
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const allBroken = [];
  const byAts = {};
  const profileDir = activeProfileDir();

  console.log('Validating ATS slugs in companies.js...');
  if (options.filterAts)  console.log(`ATS filter: ${options.filterAts}`);
  if (options.brokenOnly) console.log('Mode: broken only');
  log.info('ATS slug validation run started', {
    profileDir,
    atsFilter: options.filterAts || 'all',
    brokenOnly: options.brokenOnly ? 1 : 0,
  });

  const totals = { ok: 0, empty: 0, broken: 0 };

  for (const [name, items, fn, labelFn, delayMs] of atsBatches()) {
    const r = await runBatch(name, items, fn, labelFn, options, allBroken, delayMs);
    if (r) {
      byAts[name] = r;
      totals.ok += r.ok;
      totals.empty += r.empty;
      totals.broken += r.broken;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`TOTAL  ok: ${totals.ok}  empty: ${totals.empty}  broken: ${totals.broken}`);
  console.log('='.repeat(50));

  // Write JSON summary for dashboard consumption
  const summary = {
    timestamp: new Date().toISOString(),
    profileDir,
    total: totals,
    byAts,
    broken: allBroken,
  };
  const jsonPath = path.join(__dirname, '../slug-health.json');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${jsonPath}`);
  log.info('ATS slug validation run complete', {
    profileDir,
    ok: totals.ok,
    empty: totals.empty,
    broken: totals.broken,
    output: jsonPath,
  });

  if (totals.broken > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    log.error('ATS slug validation failed', { error: err.message });
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  atsBatches,
  activeProfileDir,
};
