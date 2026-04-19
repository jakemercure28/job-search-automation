'use strict';

const { sleep, safeFetch, stripHtml } = require('../lib/utils');
const { matchesSearchTerms } = require('../lib/scraper-utils');
const { SCRAPER_DELAY_MS } = require('../config/constants');

// Built In has regional subdomains (e.g. builtinseattle.com, builtinnyc.com, builtinaustin.com).
// Set BUILTIN_SUBDOMAIN in .env to target a specific region, or leave default for nationwide.
const BUILTIN_SUBDOMAIN = process.env.BUILTIN_SUBDOMAIN || 'www';
const BASE_URL = `https://${BUILTIN_SUBDOMAIN}.builtin.com`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Search terms to query Built In with (maps to their /jobs?search= param)
const BUILTIN_SEARCHES = [
  'devops',
  'site reliability',
  'infrastructure engineer',
  'platform engineer',
  'cloud engineer',
];

function extractJobUrls(html) {
  const matches = [...html.matchAll(/href="(\/job\/[^"]+\/\d+)"/g)];
  const seen = new Set();
  const urls = [];
  for (const m of matches) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      urls.push(BASE_URL + m[1]);
    }
  }
  return urls;
}

function parseJobPage(html, pageUrl) {
  const { unescape } = require('querystring');
  // Parse LD+JSON structured data
  const ldMatch = html.match(/<script[^>]+ld[^>]+>([\s\S]*?)<\/script>/);
  if (!ldMatch) return null;

  let data;
  try {
    // unescape HTML entities in the script tag content
    const raw = ldMatch[1].replace(/&#x2B;/g, '+').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const graph = data['@graph'] || [data];
  const posting = graph.find(item => item['@type'] === 'JobPosting');
  if (!posting) return null;

  const org = posting.hiringOrganization || {};
  const salary = posting.baseSalary?.value || {};
  // jobLocation can be a single object or an array of locations
  const jobLocations = Array.isArray(posting.jobLocation)
    ? posting.jobLocation
    : posting.jobLocation ? [posting.jobLocation] : [];

  // Build location string — join all offices with | so the location filter
  // checks every location and keeps the job if any one qualifies
  let locationStr = '';
  if (posting.jobLocationType === 'TELECOMMUTE') {
    locationStr = 'Remote';
  } else if (jobLocations.length > 0) {
    const locationParts = jobLocations.map((loc) => {
      const addr = loc.address || {};
      return [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
    }).filter(Boolean);
    locationStr = locationParts.join('|');
  }

  // Build salary string for description context
  let salaryStr = '';
  if (salary.minValue && salary.maxValue) {
    salaryStr = `$${Math.round(salary.minValue/1000)}K–$${Math.round(salary.maxValue/1000)}K`;
  }

  // Extract apply URL from jobPostInit
  const initMatch = html.match(/Builtin\.jobPostInit\(\{"job":\{"id":\d+[^}]*"howToApply":"([^"\\]*)"/);
  const applyUrl = initMatch ? initMatch[1].replace(/\\u0026/g, '&') : pageUrl;

  // Extract Built In job ID from URL
  const idMatch = pageUrl.match(/\/(\d+)$/);
  const builtinId = idMatch ? idMatch[1] : pageUrl;

  return {
    id: `builtin-${builtinId}`,
    platform: 'Built In',
    title: posting.title || '',
    company: org.name || '',
    url: applyUrl || pageUrl,
    builtinUrl: pageUrl,
    postedAt: posting.datePosted || new Date().toISOString(),
    description: `${salaryStr ? salaryStr + ' | ' : ''}${stripHtml(posting.description || '')}`,
    location: locationStr,
  };
}

async function scrapeBuiltin() {
  const jobs = [];
  const seenUrls = new Set();
  const headers = { 'User-Agent': USER_AGENT };

  for (const term of BUILTIN_SEARCHES) {
    const searchUrl = `${BASE_URL}/jobs?search=${encodeURIComponent(term)}`;
    const res = await safeFetch(searchUrl, { headers }, `builtin/${term}`);
    if (!res) { await sleep(SCRAPER_DELAY_MS); continue; }

    let html;
    try { html = await res.text(); } catch { await sleep(SCRAPER_DELAY_MS); continue; }

    const jobUrls = extractJobUrls(html);

    for (const url of jobUrls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Quick title check from URL slug before fetching full page
      const slugTitle = url.split('/job/')[1]?.split('/')[0]?.replace(/-/g, ' ') || '';
      if (!matchesSearchTerms(slugTitle)) continue;

      await sleep(SCRAPER_DELAY_MS);
      const jobRes = await safeFetch(url, { headers }, `builtin/job`);
      if (!jobRes) continue;

      let jobHtml;
      try { jobHtml = await jobRes.text(); } catch { continue; }

      const job = parseJobPage(jobHtml, url);
      if (!job) continue;
      if (!matchesSearchTerms(job.title)) continue;

      jobs.push(job);
    }

    await sleep(SCRAPER_DELAY_MS * 2);
  }

  return jobs;
}

module.exports = { scrapeBuiltin };
