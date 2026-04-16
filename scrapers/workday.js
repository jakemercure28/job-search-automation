'use strict';

const { sleep, safeFetch, stripHtml } = require('../lib/utils');
const { WORKDAY_COMPANIES, SEARCH_TERMS } = require('../config/companies');
const { matchesSearchTerms } = require('../lib/scraper-utils');

// Parse Workday's relative date strings ("Posted X Days Ago") into ISO dates
function parseWorkdayDate(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  const match = dateStr.match(/Posted\s+(\d+)\s+Days?\s+Ago|Posted\s+(Today|Yesterday)/i);
  if (!match) return dateStr; // Return as-is if it doesn't match the pattern

  let daysAgo = 0;
  if (match[1]) {
    daysAgo = parseInt(match[1], 10);
  } else if (match[2]) {
    daysAgo = match[2].toLowerCase() === 'today' ? 0 : 1;
  }

  const date = new Date(today);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0]; // Return YYYY-MM-DD format
}

async function scrapeWorkday() {
  const jobs = [];
  const seen = new Set();

  for (const { sub, wd, board, label } of WORKDAY_COMPANIES) {
    const baseUrl = `https://${sub}.wd${wd}.myworkdayjobs.com`;
    const listUrl = `${baseUrl}/wday/cxs/${sub}/${board}/jobs`;

    // Search server-side with each search term so relevant roles aren't
    // buried under thousands of retail/store positions.
    for (const term of SEARCH_TERMS) {
      const res = await safeFetch(listUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20, offset: 0, searchText: term }),
      }, `workday/${sub}/${term}`);
      if (!res) { await sleep(300); continue; }

      let data;
      try { data = await res.json(); } catch { await sleep(300); continue; }

      for (const job of data.jobPostings || []) {
        const jobId = `workday-${sub}-${job.externalPath?.split('/').pop() || job.title}`;
        if (seen.has(jobId)) continue;
        if (!matchesSearchTerms(job.title)) continue;
        seen.add(jobId);

        // Fetch full description from detail endpoint (list API doesn't include it)
        let description = '';
        if (job.externalPath) {
          const detailUrl = `${baseUrl}/wday/cxs/${sub}/${board}${job.externalPath}`;
          const detailRes = await safeFetch(detailUrl, {}, `workday/${sub}/detail`);
          if (detailRes) {
            try {
              const detail = await detailRes.json();
              description = stripHtml(detail.jobPostingInfo?.jobDescription || '');
            } catch { /* use empty */ }
          }
          await sleep(300);
        }

        const postedOn = job.postedOn || '';
        const loc = job.locationsText || job.locationName || '';
        jobs.push({
          id: jobId,
          platform: 'Workday',
          title: job.title,
          company: label,
          url: `${baseUrl}/en-US/${board}${job.externalPath}`,
          postedAt: parseWorkdayDate(postedOn),
          description,
          location: loc,
        });
      }

      await sleep(300);
    }
  }

  return jobs;
}

module.exports = { scrapeWorkday };
