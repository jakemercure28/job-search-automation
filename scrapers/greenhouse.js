'use strict';

const { stripHtml } = require('../lib/utils');
const { scrapeCompanies } = require('../lib/base-scraper');
const { GREENHOUSE_COMPANIES } = require('../config/companies');

async function scrapeGreenhouse() {
  return scrapeCompanies({
    companies: GREENHOUSE_COMPANIES,
    platform: 'greenhouse',
    buildUrl: (company) => `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
    parseResponse: (data) => data.jobs || [],
    matchField: (job) => job.title,
    mapJob: (job, company) => ({
      id: `greenhouse-${job.id}`,
      platform: 'Greenhouse',
      title: job.title,
      company: company,
      url: job.absolute_url,
      postedAt: job.updated_at,
      description: stripHtml(job.content || ''),
      location: (job.location?.name) || '',
    }),
  });
}

module.exports = { scrapeGreenhouse };
