'use strict';

const { sleep, safeFetch, stripHtml } = require('../lib/utils');
const { WORKDAY_COMPANIES, SEARCH_TERMS } = require('../config/companies');
const { matchesSearchTerms } = require('../lib/scraper-utils');

// How many companies to query in parallel. Workday is tolerant of concurrent
// requests but we cap it to avoid hammering shared infra.
const WORKDAY_CONCURRENCY = 8;

function parseWorkdayDate(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  const match = dateStr.match(/Posted\s+(\d+)\s+Days?\s+Ago|Posted\s+(Today|Yesterday)/i);
  if (!match) return dateStr;

  let daysAgo = 0;
  if (match[1]) {
    daysAgo = parseInt(match[1], 10);
  } else if (match[2]) {
    daysAgo = match[2].toLowerCase() === 'today' ? 0 : 1;
  }

  const date = new Date(today);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

async function scrapeCompany({ sub, wd, board, label }) {
  const jobs = [];
  const seen = new Set();
  const baseUrl = `https://${sub}.wd${wd}.myworkdayjobs.com`;
  const listUrl = `${baseUrl}/wday/cxs/${sub}/${board}/jobs`;

  // Run all search terms in parallel for this company
  const termResults = await Promise.allSettled(
    SEARCH_TERMS.map(term =>
      safeFetch(listUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20, offset: 0, searchText: term }),
      }, `workday/${sub}/${term}`)
        .then(res => res ? res.json() : null)
        .catch(() => null)
    )
  );

  // Collect unique matching jobs across all terms
  const detailFetches = [];
  for (const r of termResults) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    for (const job of r.value.jobPostings || []) {
      const jobId = `workday-${sub}-${job.externalPath?.split('/').pop() || job.title}`;
      if (seen.has(jobId)) continue;
      if (!matchesSearchTerms(job.title)) continue;
      seen.add(jobId);
      detailFetches.push({ job, jobId });
    }
  }

  // Fetch descriptions in parallel
  const detailResults = await Promise.allSettled(
    detailFetches.map(({ job, jobId }) => {
      if (!job.externalPath) return Promise.resolve({ job, jobId, description: '' });
      const detailUrl = `${baseUrl}/wday/cxs/${sub}/${board}${job.externalPath}`;
      return safeFetch(detailUrl, {}, `workday/${sub}/detail`)
        .then(res => res ? res.json() : null)
        .then(detail => ({
          job, jobId,
          description: stripHtml(detail?.jobPostingInfo?.jobDescription || ''),
        }))
        .catch(() => ({ job, jobId, description: '' }));
    })
  );

  for (const r of detailResults) {
    if (r.status !== 'fulfilled') continue;
    const { job, jobId, description } = r.value;
    jobs.push({
      id: jobId,
      platform: 'Workday',
      title: job.title,
      company: label,
      url: `${baseUrl}/en-US/${board}${job.externalPath}`,
      postedAt: parseWorkdayDate(job.postedOn || ''),
      description,
      location: job.locationsText || job.locationName || '',
    });
  }

  return jobs;
}

async function scrapeWorkday() {
  const allJobs = [];

  // Process companies in parallel batches
  for (let i = 0; i < WORKDAY_COMPANIES.length; i += WORKDAY_CONCURRENCY) {
    const batch = WORKDAY_COMPANIES.slice(i, i + WORKDAY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(scrapeCompany));
    for (const r of results) {
      if (r.status === 'fulfilled') allJobs.push(...r.value);
    }
    if (i + WORKDAY_CONCURRENCY < WORKDAY_COMPANIES.length) await sleep(300);
  }

  return allJobs;
}

module.exports = { scrapeWorkday };
