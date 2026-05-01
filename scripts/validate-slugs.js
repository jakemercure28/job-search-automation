'use strict';

/**
 * validate-slugs.js
 * Hits each ATS API for every slug in companies.js and reports:
 *   ok        - 200 + at least one job posting
 *   empty     - 200 but zero jobs (valid slug, nothing posted right now)
 *   broken    - confirmed hard slug failure (404/422)
 *   blocked   - rate-limit / Cloudflare / anti-bot response
 *   transient - temporary fetch failure, DNS, timeout, or 5xx
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
const { fetchWorkableAccountJobs } = require('../lib/workable');

const log = createLogger('slug-health', { logFile: logPaths.daily('slug-health') });

const TIMEOUT_MS = 20000;
const DELAY_MS   = 120;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 750;
const RETRY_MAX_MS = 2500;

function parseArgs(argv) {
  return {
    filterAts: argv.includes('--ats') ? argv[argv.indexOf('--ats') + 1]?.toLowerCase() : null,
    brokenOnly: argv.includes('--broken-only'),
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res;
  } catch (e) {
    return { ok: false, status: 0, _error: e.message, _errorName: e.name, url };
  }
}

function header(res, name) {
  return typeof res.headers?.get === 'function' ? res.headers.get(name) || '' : '';
}

function isBlockedResponse(status, text = '', headers = {}) {
  const haystack = [
    text,
    headers.server,
    headers.via,
    headers.cfRay,
    headers.retryAfter,
  ].filter(Boolean).join(' ').toLowerCase();

  return status === 429
    || /cloudflare|cf-ray|rate.?limit|too many requests|captcha|bot.?detect|access denied|akamai|perimeterx|datadome/.test(haystack);
}

function classifyFailure({ status = 0, error = '', errorName = '', text = '', headers = {} }) {
  const normalizedError = `${errorName} ${error}`.toLowerCase();
  if (status === 404 || status === 422) return 'broken';
  if (isBlockedResponse(status, text, headers)) return 'blocked';
  if (status >= 500) return 'transient';
  if (
    status === 0
    || /timeout|abort|dns|enotfound|eai_again|etimedout|econnreset|fetch failed|network/.test(normalizedError)
  ) {
    return 'transient';
  }
  return 'broken';
}

function failureNote({ status = 0, error = '', category }) {
  if (status) return `HTTP ${status}`;
  if (error) return error;
  return category;
}

async function failureFromResponse(res, url) {
  const status = res.status || 0;
  const error = res._error || '';
  const errorName = res._errorName || '';
  let text = '';
  if (status && typeof res.clone === 'function') {
    text = await res.clone().text().catch(() => '');
    if (text.length > 4096) text = text.slice(0, 4096);
  }
  const headers = {
    server: header(res, 'server'),
    via: header(res, 'via'),
    cfRay: header(res, 'cf-ray'),
    retryAfter: header(res, 'retry-after'),
  };
  const result = classifyFailure({ status, error, errorName, text, headers });
  return {
    result,
    note: failureNote({ status, error, category: result }),
    status,
    error,
    url,
  };
}

function retryDelayMs(attempt, status) {
  if (status === 429) return RETRY_MAX_MS;
  return Math.min(RETRY_BASE_MS * Math.pow(2, attempt - 1), RETRY_MAX_MS);
}

function isRetryableResult(result) {
  return result === 'blocked' || result === 'transient';
}

// ---------------------------------------------------------------------------
// Per-ATS checkers
// ---------------------------------------------------------------------------

async function checkGreenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  const res = await safeFetch(url);
  if (!res.ok) return failureFromResponse(res, url);
  const data = await res.json().catch(() => null);
  const count = data?.jobs?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count, status: res.status, url };
}

async function checkLever(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await safeFetch(url);
  if (!res.ok) return failureFromResponse(res, url);
  const data = await res.json().catch(() => null);
  const count = Array.isArray(data) ? data.length : 0;
  return { result: count > 0 ? 'ok' : 'empty', count, status: res.status, url };
}

async function checkAshby(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const res = await safeFetch(url);
  if (!res.ok) return failureFromResponse(res, url);
  const data = await res.json().catch(() => null);
  const count = data?.jobs?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count, status: res.status, url };
}

async function checkWorkday({ sub, wd, board }) {
  const url = `https://${sub}.wd${wd}.myworkdayjobs.com/wday/cxs/${sub}/${board}/jobs`;
  const res = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: 1, offset: 0, searchText: '' }),
  });
  if (!res.ok) return failureFromResponse(res, url);
  const data = await res.json().catch(() => null);
  const count = data?.total ?? data?.jobPostings?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count, status: res.status, url };
}

async function checkWorkable(slug) {
  const result = await fetchWorkableAccountJobs(slug);
  let category = result.result;
  let selectedAttempt = (result.attempts || [])[result.attempts.length - 1] || {};
  if (result.result === 'broken') {
    const retryableAttempt = (result.attempts || []).find(a => classifyFailure({
      status: a.status,
      error: a.error || '',
    }) !== 'broken');
    selectedAttempt = retryableAttempt || selectedAttempt;
    category = classifyFailure({ status: selectedAttempt.status, error: selectedAttempt.error || '' });
  }
  const lastAttempt = selectedAttempt;
  return {
    result: category,
    count: result.count,
    note: failureNote({ status: lastAttempt.status, error: lastAttempt.error || '', category }),
    status: lastAttempt.status,
    error: lastAttempt.error || '',
    url: lastAttempt.url,
    endpointAttempts: result.attempts,
  };
}

async function checkRippling(slug) {
  const url = `https://ats.rippling.com/${slug}/jobs`;
  const res = await safeFetch(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) return failureFromResponse(res, url);
  const html = await res.text().catch(() => '');
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return { result: 'broken', note: 'Missing Rippling job data', status: res.status, url };

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (e) {
    return { result: 'broken', note: `Invalid Rippling job data: ${e.message}`, status: res.status, url };
  }

  const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
  const jobsQuery = queries.find(q => Array.isArray(q.queryKey) && q.queryKey[2] === 'job-posts');
  const jobsData = jobsQuery?.state?.data;
  const count = jobsData?.totalItems ?? jobsData?.total ?? jobsData?.items?.length ?? 0;
  return { result: count > 0 ? 'ok' : 'empty', count, status: res.status, url };
}

// ---------------------------------------------------------------------------
// Replacement discovery
// ---------------------------------------------------------------------------

const CHECKERS_BY_ATS = {
  greenhouse: checkGreenhouse,
  lever: checkLever,
  ashby: checkAshby,
  workable: checkWorkable,
  rippling: checkRippling,
};

function atsKey(name) {
  return String(name || '').toLowerCase();
}

function cleanSlugBase(slug) {
  return decodeURIComponent(String(slug || ''))
    .trim()
    .replace(/^www\./i, '')
    .replace(/\.(com|io|ai|net|org)$/i, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function candidateSlugVariants(slug) {
  const base = cleanSlugBase(slug);
  const variants = new Set([
    base,
    base.replace(/-/g, ''),
    base.replace(/-/g, '_'),
    `${base}-careers`,
    `${base}-jobs`,
    `${base}-inc`,
    `${base}-labs`,
    base.replace(/-(careers|jobs|inc|labs|hq)$/i, ''),
    base.replace(/(inc|labs|hq)$/i, ''),
  ]);
  variants.delete('');
  variants.delete(String(slug));
  return [...variants].filter(Boolean).slice(0, 12);
}

function likelyCompanyDomains(slug) {
  const base = cleanSlugBase(slug).replace(/-(careers|jobs|inc|labs|hq)$/i, '');
  if (!base) return [];
  return [
    `https://${base}.com/careers`,
    `https://www.${base}.com/careers`,
  ];
}

function candidateUrl(ats, slug) {
  switch (atsKey(ats)) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case 'lever': return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
    case 'workable': return `https://apply.workable.com/${slug}`;
    case 'rippling': return `https://ats.rippling.com/${slug}/jobs`;
    default: return '';
  }
}

function extractAtsCandidatesFromHtml(html) {
  const candidates = [];
  const push = (ats, slug, url) => {
    if (!slug) return;
    candidates.push({ ats, slug: decodeURIComponent(slug), url, note: 'Found on careers page' });
  };

  for (const match of html.matchAll(/https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/)?job_board\?for=([A-Za-z0-9._%+-]+)/gi)) {
    push('Greenhouse', match[1], match[0]);
  }
  for (const match of html.matchAll(/https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([A-Za-z0-9._%+-]+)/gi)) {
    push('Greenhouse', match[1], match[0]);
  }
  for (const match of html.matchAll(/https?:\/\/jobs\.ashbyhq\.com\/([A-Za-z0-9._%+-]+)/gi)) {
    push('Ashby', match[1], match[0]);
  }
  for (const match of html.matchAll(/https?:\/\/jobs\.lever\.co\/([A-Za-z0-9._%+-]+)/gi)) {
    push('Lever', match[1], match[0]);
  }
  for (const match of html.matchAll(/https?:\/\/apply\.workable\.com\/([A-Za-z0-9._%+-]+)/gi)) {
    push('Workable', match[1], match[0]);
  }
  for (const match of html.matchAll(/https?:\/\/ats\.rippling\.com\/([A-Za-z0-9._%+-]+)\/jobs/gi)) {
    push('Rippling', match[1], match[0]);
  }

  return candidates;
}

async function fetchShortText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return '';
    const text = await res.text();
    return text.slice(0, 250000);
  } catch {
    return '';
  }
}

async function verifyReplacementCandidate(candidate) {
  const checkFn = CHECKERS_BY_ATS[atsKey(candidate.ats)];
  if (!checkFn) return null;
  const result = await runCheckWithRetries(candidate.ats, candidate.slug, candidate.slug, checkFn, {
    maxAttempts: 1,
    logAttempts: false,
  });
  if (result.result !== 'ok' && result.result !== 'empty') return null;
  return {
    ats: candidate.ats,
    slug: candidate.slug,
    url: candidate.url || candidateUrl(candidate.ats, candidate.slug),
    status: result.result,
    count: result.count || 0,
    note: candidate.note || 'Verified candidate',
  };
}

async function verifyCandidateList(candidates, original) {
  const seen = new Set();
  const verified = [];
  for (const candidate of candidates) {
    const key = `${atsKey(candidate.ats)}:${candidate.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (atsKey(candidate.ats) === atsKey(original.ats) && candidate.slug === original.slug) continue;
    const verifiedCandidate = await verifyReplacementCandidate(candidate);
    if (verifiedCandidate) verified.push(verifiedCandidate);
    if (verified.length >= 5) break;
  }
  return verified;
}

async function discoverDeterministicReplacementCandidates(ats, slug) {
  if (atsKey(ats) === 'workday') return [];

  const variantCandidates = candidateSlugVariants(slug).map(candidate => ({
    ats,
    slug: candidate,
    url: candidateUrl(ats, candidate),
    note: 'Verified common slug variant',
  }));
  const verifiedVariants = await verifyCandidateList(variantCandidates, { ats, slug });
  if (verifiedVariants.length) return verifiedVariants;

  const pageCandidates = [];
  for (const url of likelyCompanyDomains(slug)) {
    const html = await fetchShortText(url);
    if (!html) continue;
    pageCandidates.push(...extractAtsCandidatesFromHtml(html));
  }
  return verifyCandidateList(pageCandidates, { ats, slug });
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  return JSON.parse(trimmed);
}

async function discoverGeminiReplacementCandidates(ats, slug) {
  if (!process.env.GEMINI_API_KEY) {
    log.info('Gemini slug replacement discovery skipped', { ats, slug, reason: 'GEMINI_API_KEY is not set' });
    return [];
  }

  const { callGemini } = require('../lib/gemini');
  const prompt = `Find replacement ATS job board slugs for this broken company slug.
Return strict JSON only, with this shape:
{"candidates":[{"ats":"Greenhouse|Lever|Ashby|Workable|Rippling","slug":"candidate-slug","url":"optional public board URL","note":"short reason"}]}

Current ATS: ${ats}
Broken slug: ${slug}
Only include public ATS boards likely to belong to the same company.`;

  try {
    const text = await callGemini(prompt, 1, 1200);
    const parsed = parseJsonObject(text);
    const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
    return verifyCandidateList(candidates.map(c => ({
      ats: c.ats,
      slug: c.slug,
      url: c.url,
      note: c.note || 'Verified Gemini candidate',
    })), { ats, slug });
  } catch (e) {
    log.warn('Gemini slug replacement discovery failed', { ats, slug, error: e.message });
    return [];
  }
}

async function discoverReplacementCandidates(ats, slug) {
  const deterministic = await discoverDeterministicReplacementCandidates(ats, slug);
  if (deterministic.length) return deterministic;
  return discoverGeminiReplacementCandidates(ats, slug);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runCheckWithRetries(ats, label, item, checkFn, {
  maxAttempts = MAX_ATTEMPTS,
  logAttempts = true,
  retryBaseMs = RETRY_BASE_MS,
  retryMaxMs = RETRY_MAX_MS,
} = {}) {
  let latest;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      latest = await checkFn(item);
    } catch (e) {
      latest = {
        result: 'transient',
        note: e.message,
        status: 0,
        error: e.message,
      };
    }

    const shouldRetry = isRetryableResult(latest.result) && attempt < maxAttempts;
    const delayMs = shouldRetry
      ? Math.min(
        latest.status === 429 ? retryMaxMs : retryBaseMs * Math.pow(2, attempt - 1),
        retryMaxMs
      )
      : 0;

    if (logAttempts) {
      log.info('ATS slug validation attempt', {
        ats,
        slug: label,
        url: latest.url || null,
        attempt,
        status: latest.status || 0,
        error: latest.error || null,
        delayMs,
        finalCategory: shouldRetry ? null : latest.result,
        endpointAttempts: latest.endpointAttempts || null,
      });
    }

    if (!shouldRetry) {
      return { ...latest, attempts: attempt };
    }
    await sleep(delayMs);
  }

  return { ...latest, attempts: maxAttempts };
}

function issueEntry(ats, slug, result, replacementCandidates = []) {
  const entry = {
    ats,
    slug,
    note: result.note || result.result,
    status: result.status || 0,
    attempts: result.attempts || 1,
  };
  if (replacementCandidates.length) entry.replacementCandidates = replacementCandidates;
  return entry;
}

async function runBatch(name, items, checkFn, labelFn, options, issueBuckets, delayMs = DELAY_MS) {
  if (options.filterAts && options.filterAts !== name.toLowerCase()) return null;

  const ok = [], empty = [], broken = [], blocked = [], transient = [];
  log.info('ATS slug validation started', { ats: name, entries: items.length });
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${name} (${items.length} entries)`);
  console.log('─'.repeat(50));

  for (const item of items) {
    const label = labelFn(item);
    const checkResult = await runCheckWithRetries(name, label, item, checkFn);
    const { result, count, note } = checkResult;

    if (result === 'ok') {
      ok.push(label);
      if (!options.brokenOnly) console.log(`  ✓ ${label}  (${count} jobs)`);
    } else if (result === 'empty') {
      empty.push(label);
      if (!options.brokenOnly) console.log(`  ○ ${label}  (no current postings)`);
    } else if (result === 'broken') {
      const replacementCandidates = await discoverReplacementCandidates(name, label);
      const issue = issueEntry(name, label, checkResult, replacementCandidates);
      broken.push(issue);
      issueBuckets.broken.push(issue);
      log.warn('Broken ATS slug detected', {
        ats: name,
        slug: label,
        note,
        status: checkResult.status || 0,
        attempts: checkResult.attempts,
        replacementCandidates,
      });
      const replacements = replacementCandidates.length
        ? `; replacements: ${replacementCandidates.map(c => `${c.ats}/${c.slug}`).join(', ')}`
        : '';
      console.log(`  ✗ ${label}  — ${note}${replacements}`);
    } else if (result === 'blocked') {
      const issue = issueEntry(name, label, checkResult);
      blocked.push(issue);
      issueBuckets.blocked.push(issue);
      console.log(`  ◌ ${label}  — ${note || 'blocked'}`);
    } else if (result === 'transient') {
      const issue = issueEntry(name, label, checkResult);
      transient.push(issue);
      issueBuckets.transient.push(issue);
      console.log(`  ! ${label}  — ${note || 'transient'}`);
    }

    await sleep(delayMs);
  }

  console.log(`\n  ok: ${ok.length}  empty: ${empty.length}  broken: ${broken.length}  blocked: ${blocked.length}  transient: ${transient.length}`);
  const summary = { ok: ok.length, empty: empty.length, broken: broken.length, blocked: blocked.length, transient: transient.length };
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
  const issueBuckets = { broken: [], blocked: [], transient: [] };
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

  const totals = { ok: 0, empty: 0, broken: 0, blocked: 0, transient: 0 };

  for (const [name, items, fn, labelFn, delayMs] of atsBatches()) {
    const r = await runBatch(name, items, fn, labelFn, options, issueBuckets, delayMs);
    if (r) {
      byAts[name] = r;
      totals.ok += r.ok;
      totals.empty += r.empty;
      totals.broken += r.broken;
      totals.blocked += r.blocked;
      totals.transient += r.transient;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`TOTAL  ok: ${totals.ok}  empty: ${totals.empty}  broken: ${totals.broken}  blocked: ${totals.blocked}  transient: ${totals.transient}`);
  console.log('='.repeat(50));

  // Write JSON summary for dashboard consumption
  const summary = {
    timestamp: new Date().toISOString(),
    profileDir,
    total: totals,
    byAts,
    broken: issueBuckets.broken,
    blocked: issueBuckets.blocked,
    transient: issueBuckets.transient,
  };
  const jsonPath = path.join(__dirname, '../slug-health.json');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${jsonPath}`);
  log.info('ATS slug validation run complete', {
    profileDir,
    ok: totals.ok,
    empty: totals.empty,
    broken: totals.broken,
    blocked: totals.blocked,
    transient: totals.transient,
    output: jsonPath,
  });

  if (totals.broken + totals.blocked + totals.transient > 0) process.exit(1);
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
  classifyFailure,
  checkGreenhouse,
  checkLever,
  checkAshby,
  checkWorkday,
  checkWorkable,
  checkRippling,
  runCheckWithRetries,
};
