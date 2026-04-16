'use strict';

const { stripHtml, safeFetch } = require('../lib/utils');
const { detectAts } = require('../lib/atsDetector');
const { matchesSearchTerms } = require('../lib/scraper-utils');

async function scrapeArbeitnow() {
  const jobs = [];
  // Free public API — remote international jobs, good for remote-anywhere roles
  const url = 'https://www.arbeitnow.com/api/job-board-api';
  const res = await safeFetch(url, {}, 'arbeitnow');
  if (!res) return jobs;

  let data;
  try { data = await res.json(); } catch { return jobs; }

  for (const job of data.data || []) {
    const title = job.title || '';
    if (!matchesSearchTerms(title)) continue;

    const jobUrl = job.url || '';
    const ats = detectAts(jobUrl);

    jobs.push({
      id: `arbeitnow-${job.slug}`,
      platform: ats ? ats.platform : 'Arbeitnow',
      title,
      company: job.company_name || '',
      url: jobUrl,
      postedAt: new Date(job.created_at * 1000).toISOString(),
      description: stripHtml(job.description || ''),
      location: job.location || (job.remote ? 'Remote' : ''),
    });
  }

  return jobs;
}

module.exports = { scrapeArbeitnow };
