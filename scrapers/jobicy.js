'use strict';

const { stripHtml, safeFetch } = require('../lib/utils');
const { detectAts } = require('../lib/atsDetector');
const { matchesSearchTerms } = require('../lib/scraper-utils');

async function scrapeJobicy() {
  const jobs = [];
  const url = 'https://remotive.com/api/remote-jobs?category=devops-sysadmin&limit=100';
  const res = await safeFetch(url, {}, 'remotive');
  if (!res) return jobs;

  let data;
  try { data = await res.json(); } catch { return jobs; }

  for (const job of data.jobs || []) {
    const title = job.title || '';
    if (!matchesSearchTerms(title)) continue;

    const jobUrl = job.url || '';
    const ats = detectAts(jobUrl);

    jobs.push({
      id: `jobicy-${job.id}`,
      platform: ats ? ats.platform : 'Remotive',
      title,
      company: job.company_name || '',
      url: jobUrl,
      postedAt: job.publication_date || new Date().toISOString(),
      description: stripHtml(job.description || ''),
      location: job.candidate_required_location || 'Remote',
    });
  }

  return jobs;
}

module.exports = { scrapeJobicy };
