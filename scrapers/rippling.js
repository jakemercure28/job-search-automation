'use strict';

const { sleep, safeFetch, stripHtml } = require('../lib/utils');
const { RIPPLING_COMPANIES } = require('../config/companies');
const { matchesSearchTerms } = require('../lib/scraper-utils');
const { MAX_DESCRIPTION_LENGTH } = require('../config/constants');

function parseNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

async function fetchJobsPage(slug, page) {
  const url = page === 0
    ? `https://ats.rippling.com/${slug}/jobs`
    : `https://ats.rippling.com/${slug}/jobs?page=${page}`;
  const res = await safeFetch(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0' },
  }, `rippling/${slug}/page${page}`);
  if (!res) return null;
  const html = await res.text();
  const data = parseNextData(html);
  if (!data) return null;
  const queries = data?.props?.pageProps?.dehydratedState?.queries || [];
  const jobsQuery = queries.find(q => Array.isArray(q.queryKey) && q.queryKey[2] === 'job-posts');
  return jobsQuery?.state?.data || null;
}

async function fetchJobDetail(slug, uuid) {
  const url = `https://ats.rippling.com/${slug}/jobs/${uuid}`;
  const res = await safeFetch(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0' },
  }, `rippling/${slug}/${uuid}`);
  if (!res) return null;
  const html = await res.text();
  const data = parseNextData(html);
  return data?.props?.pageProps?.apiData?.jobPost || null;
}

async function scrapeRippling() {
  const jobs = [];

  for (const slug of RIPPLING_COMPANIES) {
    const pageData = await fetchJobsPage(slug, 0);
    await sleep(300);
    if (!pageData) continue;

    const allItems = [...(pageData.items || [])];
    const totalPages = pageData.totalPages || 1;

    for (let page = 1; page < totalPages; page++) {
      const pd = await fetchJobsPage(slug, page);
      await sleep(300);
      if (pd) allItems.push(...(pd.items || []));
    }

    for (const item of allItems) {
      if (!matchesSearchTerms(item.name)) continue;

      const detail = await fetchJobDetail(slug, item.id);
      await sleep(300);

      const rawDesc = detail
        ? (detail.description?.company || '') + ' ' + (detail.description?.role || '')
        : '';
      const description = stripHtml(rawDesc).slice(0, MAX_DESCRIPTION_LENGTH);

      const location = item.locations?.[0]?.name || detail?.workLocations?.[0] || '';

      jobs.push({
        id: `rippling-${slug}-${item.id}`,
        platform: 'Rippling',
        title: item.name,
        company: detail?.companyName || slug,
        url: item.url || `https://ats.rippling.com/${slug}/jobs/${item.id}`,
        postedAt: detail?.createdOn || null,
        description,
        location,
      });
    }
  }

  return jobs;
}

module.exports = { scrapeRippling };
