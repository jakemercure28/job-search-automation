'use strict';

const { stripHtml } = require('../lib/utils');
const { scrapeCompanies } = require('../lib/base-scraper');
const { ASHBY_COMPANIES } = require('../config/companies');
const { MAX_DESCRIPTION_LENGTH } = require('../config/constants');

async function scrapeAshby() {
  return scrapeCompanies({
    companies: ASHBY_COMPANIES,
    platform: 'ashby',
    buildUrl: (company) => `https://api.ashbyhq.com/posting-api/job-board/${company}`,
    parseResponse: (data) => data.jobs || [],
    matchField: (job) => job.title,
    mapJob: (job, company) => ({
      id: `ashby-${job.id}`,
      platform: 'Ashby',
      title: job.title,
      company: job.companyName || company,
      url: job.jobUrl,
      postedAt: job.publishedAt,
      description: (job.descriptionPlain || stripHtml(job.descriptionHtml || '')).slice(0, MAX_DESCRIPTION_LENGTH),
      location: job.location || job.address?.postalAddress?.addressLocality || (job.isRemote ? 'Remote' : ''),
    }),
  });
}

module.exports = { scrapeAshby };
