'use strict';

const { URL } = require('url');

const { detectAts } = require('./atsDetector');
const { safeFetch, stripHtml } = require('./utils');
const log = require('./logger')('ats-resolver');

const PRIMARY_PLATFORMS = new Set(['ashby', 'greenhouse', 'lever', 'workday']);
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json',
};

function normalizePlatform(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower) return '';
  if (lower.includes('ashby')) return 'ashby';
  if (lower.includes('greenhouse')) return 'greenhouse';
  if (lower.includes('lever')) return 'lever';
  if (lower.includes('workday') || lower.includes('myworkdayjobs')) return 'workday';
  return lower;
}

function displayPlatform(value) {
  const platform = normalizePlatform(value);
  if (platform === 'ashby') return 'Ashby';
  if (platform === 'greenhouse') return 'Greenhouse';
  if (platform === 'lever') return 'Lever';
  if (platform === 'workday') return 'Workday';
  return value || '';
}

function isPrimaryPlatform(value) {
  return PRIMARY_PLATFORMS.has(normalizePlatform(value));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absoluteUrl(href, baseUrl) {
  if (!href) return '';
  const decoded = decodeHtmlEntities(href).trim();
  if (/^mailto:/i.test(decoded)) return decoded.replace(/^mailto:/i, '');
  try {
    return new URL(decoded, baseUrl || undefined).toString();
  } catch {
    return decoded;
  }
}

function parseJsonObject(raw) {
  try {
    return JSON.parse(decodeHtmlEntities(raw));
  } catch {
    return null;
  }
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld(?:\+|&#x2B;)json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const data = parseJsonObject(match[1]);
    if (!data) continue;
    const graph = data['@graph'] || (Array.isArray(data) ? data : [data]);
    blocks.push(...graph);
  }
  return blocks;
}

function findValuesDeep(value, keyNames, results = []) {
  if (!value || typeof value !== 'object') return results;
  if (Array.isArray(value)) {
    for (const item of value) findValuesDeep(item, keyNames, results);
    return results;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (keyNames.has(key) && typeof nested === 'string') results.push(nested);
    findValuesDeep(nested, keyNames, results);
  }
  return results;
}

function extractBuiltInApplyUrl(html) {
  const initMatch = html.match(/Builtin\.jobPostInit\((\{[\s\S]*?\})\);\s*<\/script>/);
  if (initMatch) {
    const data = parseJsonObject(initMatch[1]);
    const howToApply = data?.job?.howToApply;
    if (typeof howToApply === 'string' && howToApply.trim()) return decodeHtmlEntities(howToApply);
  }

  const legacyMatch = html.match(/Builtin\.jobPostInit\(\{"job":\{"id":\d+[^}]*"howToApply":"([^"\\]*(?:\\.[^"\\]*)*)"/);
  if (legacyMatch) return decodeHtmlEntities(legacyMatch[1]);

  return '';
}

function extractRemoteOkApplyUrls(html, sourceUrl) {
  const urls = [];
  const idMatch = sourceUrl.match(/-(\d+)(?:[/?#]|$)/) || html.match(/currentJobId=['"](\d+)['"]/);
  if (idMatch) urls.push(absoluteUrl(`/l/${idMatch[1]}`, sourceUrl));

  for (const match of html.matchAll(/href=["']([^"']*\/l\/\d+[^"']*)["']/gi)) {
    urls.push(absoluteUrl(match[1], sourceUrl));
  }
  return urls;
}

function extractCandidateUrls(html, sourceUrl) {
  const urls = [];
  const builtIn = extractBuiltInApplyUrl(html);
  if (builtIn) urls.push(absoluteUrl(builtIn, sourceUrl));

  const metaRefresh = html.match(/http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
  if (metaRefresh) urls.push(absoluteUrl(metaRefresh[1], sourceUrl));

  for (const item of extractJsonLd(html)) {
    urls.push(...findValuesDeep(item, new Set(['url', 'sameAs', 'applyUrl', 'applicationUrl'])));
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    urls.push(match[1]);
  }

  if (/remoteok\.com/i.test(sourceUrl)) urls.push(...extractRemoteOkApplyUrls(html, sourceUrl));

  const seen = new Set();
  return urls
    .map((url) => absoluteUrl(url, sourceUrl))
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

function classifyUnsupportedUrl(url) {
  if (!url) return null;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = String(url).toLowerCase();
  }

  const full = String(url).toLowerCase();
  if (host.includes('ats.rippling.com')) return 'Rippling';
  if (host.includes('apply.workable.com')) return 'Workable';
  if (host.includes('icims.com')) return 'iCIMS';
  if (host.includes('oraclecloud.com')) return 'Oracle Cloud';
  if (host.includes('ultipro.com') || host.includes('ukg.com')) return 'UKG';
  if (host.includes('bamboohr.com')) return 'BambooHR';
  if (host.includes('applytojob.com')) return 'JazzHR';
  if (host.includes('linkedin.com')) return 'LinkedIn';
  if (host.includes('servicenow.com')) return 'ServiceNow Careers';
  if (host === 'search-careers.gm.com' || host === 'careers.draftkings.com') return 'Company Careers';
  if (host.includes('remoteok.com')) return 'RemoteOK';
  if (host.includes('builtin.com') || host.includes('builtinseattle.com')) return 'Built In';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(full)) return 'Email';
  return null;
}

function normalizeSlugPart(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(inc|incorporated|llc|ltd|co|corp|corporation|company|ai|technologies|technology)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function titleTokens(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !['senior', 'staff', 'lead', 'engineer', 'remote'].includes(token));
}

function titleMatches(candidate, expected) {
  const left = String(candidate || '').toLowerCase();
  const right = String(expected || '').toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const tokens = titleTokens(expected);
  if (tokens.length === 0) return left.includes(right) || right.includes(left);
  const matched = tokens.filter((token) => left.includes(token)).length;
  return matched >= Math.min(tokens.length, 2);
}

function parseGreenhouseUrl(url, fallbackCompany) {
  if (!url) return null;
  const standard = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (standard) return { boardToken: standard[1], jobId: standard[2] };
  const ghJid = url.match(/[?&]gh_jid=(\d+)/i);
  if (ghJid && fallbackCompany) {
    return { boardToken: normalizeSlugPart(fallbackCompany), jobId: ghJid[1] };
  }
  return null;
}

function parseAshbyUrl(url) {
  const match = String(url || '').match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  return match ? { boardToken: match[1], jobId: match[2] } : null;
}

function parseLeverUrl(url) {
  const match = String(url || '').match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  return match ? { company: match[1], jobId: match[2] } : null;
}

function parseWorkdayUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const hostMatch = parsed.hostname.match(/^([^/.]+)\.(?:wd\d+\.)?myworkdayjobs\.com$/i);
  if (!hostMatch) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const boardIndex = parts.findIndex((part) => !['en-US', 'en', 'jobs'].includes(part));
  if (boardIndex < 0 || !parts[boardIndex]) return null;
  const board = parts[boardIndex];
  const externalPath = `/${parts.slice(boardIndex + 1).join('/')}`;
  if (!externalPath || externalPath === '/') return null;
  return {
    subdomain: hostMatch[1],
    host: parsed.hostname,
    board,
    externalPath,
  };
}

function normalizeCanonicalJob(job, fallback = {}) {
  return {
    id: job.id,
    platform: displayPlatform(job.platform),
    title: job.title || fallback.title || '',
    company: job.company || fallback.company || '',
    url: job.url || fallback.url || '',
    postedAt: job.postedAt || fallback.posted_at || fallback.postedAt || '',
    description: job.description || fallback.description || '',
    location: job.location || fallback.location || '',
  };
}

async function fetchGreenhouseJob(url, fallback = {}, fetchImpl = safeFetch) {
  const parsed = parseGreenhouseUrl(url, fallback.company);
  if (!parsed) return null;
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${parsed.boardToken}/jobs/${parsed.jobId}?content=true`;
  const res = await fetchImpl(apiUrl, {}, `greenhouse-resolve/${parsed.boardToken}/${parsed.jobId}`);
  if (!res) return normalizeCanonicalJob({
    id: `greenhouse-${parsed.jobId}`,
    platform: 'Greenhouse',
    url,
  }, fallback);

  let data;
  try { data = await res.json(); } catch { data = null; }
  return normalizeCanonicalJob({
    id: `greenhouse-${parsed.jobId}`,
    platform: 'Greenhouse',
    title: data?.title,
    company: parsed.boardToken,
    url: data?.absolute_url || url,
    postedAt: data?.updated_at,
    description: stripHtml(data?.content || ''),
    location: data?.location?.name || '',
  }, fallback);
}

async function fetchAshbyJob(url, fallback = {}, fetchImpl = safeFetch) {
  const parsed = parseAshbyUrl(url);
  if (!parsed) return null;
  const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${parsed.boardToken}?includeCompensation=true`;
  const res = await fetchImpl(apiUrl, {}, `ashby-resolve/${parsed.boardToken}`);
  let match = null;
  if (res) {
    try {
      const data = await res.json();
      match = (data?.jobs || []).find((job) => job.id === parsed.jobId);
    } catch {}
  }

  return normalizeCanonicalJob({
    id: `ashby-${parsed.jobId}`,
    platform: 'Ashby',
    title: match?.title,
    company: parsed.boardToken,
    url: match?.jobUrl || url,
    postedAt: match?.publishedDate || match?.updatedAt,
    description: stripHtml(match?.descriptionHtml || match?.descriptionPlain || match?.description || ''),
    location: match?.location || match?.locationName || '',
  }, fallback);
}

async function fetchLeverJob(url, fallback = {}, fetchImpl = safeFetch) {
  const parsed = parseLeverUrl(url);
  if (!parsed) return null;
  const apiUrl = `https://api.lever.co/v0/postings/${parsed.company}/${parsed.jobId}`;
  const res = await fetchImpl(apiUrl, {}, `lever-resolve/${parsed.company}/${parsed.jobId}`);
  let data = null;
  if (res) {
    try { data = await res.json(); } catch {}
  }

  return normalizeCanonicalJob({
    id: `lever-${parsed.jobId}`,
    platform: 'Lever',
    title: data?.text,
    company: parsed.company,
    url: data?.hostedUrl || url,
    postedAt: data?.createdAt ? new Date(data.createdAt).toISOString() : '',
    description: stripHtml([
      data?.descriptionPlain,
      ...(data?.lists || []).map((list) => `${list.text}\n${list.content}`),
    ].filter(Boolean).join('\n')),
    location: data?.categories?.location || '',
  }, fallback);
}

async function fetchWorkdayJob(url, fallback = {}, fetchImpl = safeFetch) {
  const parsed = parseWorkdayUrl(url);
  if (!parsed) return null;
  const detailUrl = `https://${parsed.host}/wday/cxs/${parsed.subdomain}/${parsed.board}${parsed.externalPath}`;
  const res = await fetchImpl(detailUrl, {}, `workday-resolve/${parsed.subdomain}/${parsed.board}`);
  let info = null;
  if (res) {
    try {
      const data = await res.json();
      info = data?.jobPostingInfo || data;
    } catch {}
  }
  const workdayId = parsed.externalPath.split('_').pop() || parsed.externalPath.split('/').pop();
  return normalizeCanonicalJob({
    id: `workday-${parsed.subdomain}-${workdayId}`,
    platform: 'Workday',
    title: info?.title,
    company: fallback.company || parsed.subdomain,
    url,
    postedAt: info?.startDate || info?.postedOn,
    description: stripHtml(info?.jobDescription || ''),
    location: info?.location || info?.locationsText || '',
  }, fallback);
}

async function fetchPrimaryJob(platform, url, fallback = {}, fetchImpl = safeFetch) {
  const normalized = normalizePlatform(platform);
  if (normalized === 'greenhouse') return fetchGreenhouseJob(url, fallback, fetchImpl);
  if (normalized === 'ashby') return fetchAshbyJob(url, fallback, fetchImpl);
  if (normalized === 'lever') return fetchLeverJob(url, fallback, fetchImpl);
  if (normalized === 'workday') return fetchWorkdayJob(url, fallback, fetchImpl);
  return null;
}

function primaryFromUrl(url) {
  const ats = detectAts(url);
  if (!ats || !isPrimaryPlatform(ats.platform)) return null;
  return {
    platform: normalizePlatform(ats.platform),
    displayPlatform: displayPlatform(ats.platform),
    company: ats.company || null,
  };
}

async function fetchText(url, fetchImpl = safeFetch, label = 'ats-resolver') {
  const res = await fetchImpl(url, { headers: DEFAULT_HEADERS, redirect: 'follow' }, label);
  if (!res) return null;
  try {
    const finalUrl = res.url || url;
    const text = await res.text();
    return { text, finalUrl };
  } catch {
    return null;
  }
}

function greenHouseBoardCandidates(company) {
  const slug = normalizeSlugPart(company);
  const candidates = new Set([slug]);
  const raw = String(company || '').toLowerCase();
  if (raw.includes('ujet')) candidates.add('ujet');
  return [...candidates].filter(Boolean);
}

async function searchPrimaryBoards(job, fetchImpl = safeFetch) {
  for (const board of greenHouseBoardCandidates(job.company)) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
    const res = await fetchImpl(url, {}, `greenhouse-search/${board}`);
    if (!res) continue;
    let data;
    try { data = await res.json(); } catch { continue; }
    const match = (data?.jobs || []).find((candidate) => titleMatches(candidate.title, job.title));
    if (!match) continue;
    return normalizeCanonicalJob({
      id: `greenhouse-${match.id}`,
      platform: 'Greenhouse',
      title: match.title,
      company: board,
      url: match.absolute_url,
      postedAt: match.updated_at,
      description: stripHtml(match.content || ''),
      location: match.location?.name || '',
    }, job);
  }
  return null;
}

function resolution(status, fields = {}) {
  return {
    status,
    platform: fields.platform || null,
    url: fields.url || null,
    job: fields.job || null,
    confidence: fields.confidence || 0,
    evidence: fields.evidence || {},
  };
}

async function resolvePrimaryUrl(url, job, fetchImpl) {
  const primary = primaryFromUrl(url);
  if (!primary) return null;
  const canonicalJob = await fetchPrimaryJob(primary.platform, url, job, fetchImpl);
  if (!canonicalJob?.id) return null;
  return resolution('primary', {
    platform: primary.displayPlatform,
    url,
    job: canonicalJob,
    confidence: 0.95,
    evidence: { method: 'direct-url', sourceUrl: url },
  });
}

async function resolveAlternateJob(job, options = {}) {
  const fetchImpl = options.fetch || safeFetch;
  if (!job || !job.url) return resolution('unresolved', { evidence: { reason: 'missing-url' } });

  const jlog = log.child({ jobId: job.id, company: job.company, platform: job.platform });
  const t = log.timer();
  jlog.info('Resolution started', { url: job.url });

  if (isPrimaryPlatform(job.platform)) {
    const direct = await resolvePrimaryUrl(job.url, job, fetchImpl);
    if (direct) {
      jlog.info('Resolved via direct primary URL', { canonicalId: direct.job?.id, confidence: direct.confidence, ms: t() });
      return direct;
    }
  }

  const direct = await resolvePrimaryUrl(job.url, job, fetchImpl);
  if (direct) {
    jlog.info('Resolved via direct URL', { canonicalId: direct.job?.id, confidence: direct.confidence, ms: t() });
    return direct;
  }

  const page = await fetchText(job.url, fetchImpl, `resolve-page/${job.id || job.url}`);
  const candidateUrls = page ? extractCandidateUrls(page.text, page.finalUrl) : [];
  jlog.debug('Page fetched', { fetched: Boolean(page), candidateUrls: candidateUrls.length });
  const unsupported = new Set();

  for (const candidateUrl of candidateUrls) {
    const primary = await resolvePrimaryUrl(candidateUrl, job, fetchImpl);
    if (primary) {
      primary.evidence = { ...primary.evidence, method: 'extracted-url', sourceUrl: job.url };
      primary.confidence = 0.9;
      jlog.info('Resolved via extracted URL', { canonicalId: primary.job?.id, confidence: primary.confidence, ms: t() });
      return primary;
    }
    const unsupportedName = classifyUnsupportedUrl(candidateUrl);
    if (unsupportedName) unsupported.add(unsupportedName);
  }

  const boardMatch = await searchPrimaryBoards(job, fetchImpl);
  if (boardMatch) {
    jlog.info('Resolved via board search', { canonicalId: boardMatch.id, confidence: 0.82, ms: t() });
    return resolution('primary', {
      platform: boardMatch.platform,
      url: boardMatch.url,
      job: boardMatch,
      confidence: 0.82,
      evidence: { method: 'company-title-board-search', sourceUrl: job.url },
    });
  }

  const sourceUnsupported = classifyUnsupportedUrl(job.url);
  if (sourceUnsupported) unsupported.add(sourceUnsupported);
  if (unsupported.size > 0) {
    jlog.info('Unsupported platform', { platforms: [...unsupported], ms: t() });
    return resolution('unsupported', {
      evidence: {
        unsupportedPlatform: [...unsupported][0],
        candidates: [...unsupported],
      },
      confidence: 0.75,
    });
  }

  jlog.info('Unresolved', { reason: page ? 'no-primary-ats-found' : 'source-fetch-failed', candidates: candidateUrls.length, ms: t() });
  return resolution('unresolved', {
    evidence: {
      reason: page ? 'no-primary-ats-found' : 'source-fetch-failed',
      candidateCount: candidateUrls.length,
    },
  });
}

module.exports = {
  PRIMARY_PLATFORMS,
  classifyUnsupportedUrl,
  displayPlatform,
  extractBuiltInApplyUrl,
  extractCandidateUrls,
  fetchPrimaryJob,
  isPrimaryPlatform,
  normalizePlatform,
  parseAshbyUrl,
  parseGreenhouseUrl,
  parseLeverUrl,
  parseWorkdayUrl,
  resolveAlternateJob,
  searchPrimaryBoards,
};
