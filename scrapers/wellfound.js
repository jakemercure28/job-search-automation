'use strict';

const { stripHtml, safeFetch } = require('../lib/utils');
const { matchesSearchTerms } = require('../lib/scraper-utils');

// Replaces the defunct Wellfound scraper.
// Remotive has server-side category filtering; we fetch system-admin and backend-dev
// to complement the devops-sysadmin feed already in jobicy.js.
async function scrapeWellfound() {
  const categories = ['system-admin', 'backend-dev'];
  const jobs = [];
  const seen = new Set();

  for (const cat of categories) {
    const url = `https://remotive.com/api/remote-jobs?category=${cat}&limit=100`;
    const res = await safeFetch(url, {}, `remotive/${cat}`);
    if (!res) continue;

    let data;
    try { data = await res.json(); } catch { continue; }

    for (const job of data.jobs || []) {
      const title = job.title || '';
      if (!matchesSearchTerms(title)) continue;
      if (seen.has(job.id)) continue;
      seen.add(job.id);

      jobs.push({
        id: `remotive-${job.id}`,
        platform: 'Remotive',
        title,
        company: job.company_name || '',
        url: job.url || '',
        postedAt: job.publication_date || new Date().toISOString(),
        description: stripHtml(job.description || ''),
        location: job.candidate_required_location || 'Remote',
      });
    }
  }

  return jobs;
}

module.exports = { scrapeWellfound };
