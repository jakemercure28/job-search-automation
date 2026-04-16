'use strict';

const { scrapeCompanies } = require('../lib/base-scraper');
const { LEVER_COMPANIES } = require('../config/companies');
const { stripHtml } = require('../lib/utils');

async function scrapeLever() {
  return scrapeCompanies({
    companies: LEVER_COMPANIES,
    platform: 'lever',
    buildUrl: (company) => `https://api.lever.co/v0/postings/${company}?mode=json`,
    parseResponse: (data) => Array.isArray(data) ? data : [],
    matchField: (job) => job.text,
    mapJob: (job, company) => {
      // Lever splits content into intro + named sections (lists). Concatenate all of them.
      const parts = [job.descriptionPlain || stripHtml(job.description || '')];
      for (const section of (job.lists || [])) {
        if (section.text) parts.push(section.text + ':');
        if (section.content) parts.push(stripHtml(section.content));
      }
      if (job.closing) parts.push(stripHtml(job.closing));
      return {
        id: `lever-${job.id}`,
        platform: 'Lever',
        title: job.text,
        company: company,
        url: job.hostedUrl,
        postedAt: new Date(job.createdAt).toISOString(),
        description: parts.filter(Boolean).join('\n\n'),
        location: (job.categories?.location) || '',
      };
    },
  });
}

module.exports = { scrapeLever };
