'use strict';

const { sleep, stripHtml, safeFetch } = require('../lib/utils');
const { WORKABLE_COMPANIES } = require('../config/companies');
const { matchesSearchTerms } = require('../lib/scraper-utils');

async function scrapeWorkable() {
  const jobs = [];

  for (const company of WORKABLE_COMPANIES) {
    const url = `https://apply.workable.com/api/v3/accounts/${company}/jobs`;
    const res = await safeFetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
      },
      `workable/${company}`
    );
    if (!res) { await sleep(400); continue; }

    let data;
    try { data = await res.json(); } catch { await sleep(400); continue; }

    for (const job of data.results || []) {
      if (!matchesSearchTerms(job.title)) continue;

      const jobUrl = `https://apply.workable.com/${company}/j/${job.shortcode}`;
      jobs.push({
        id: `workable-${company}-${job.shortcode}`,
        platform: 'Workable',
        title: job.title,
        company: company,
        url: jobUrl,
        postedAt: job.created_at,
        description: stripHtml(job.description || ''),
        location: job.location || '',
      });
    }

    await sleep(400);
  }

  return jobs;
}

module.exports = { scrapeWorkable };
