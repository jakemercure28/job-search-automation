'use strict';

const { sleep } = require('../lib/utils');
const { WORKABLE_COMPANIES } = require('../config/companies');
const { matchesSearchTerms } = require('../lib/scraper-utils');
const { isLocationAllowed } = require('../lib/location-filter');
const { fetchWorkableAccountJobs } = require('../lib/workable');
const log = require('../lib/logger')('workable-scraper');

async function scrapeWorkable() {
  const jobs = [];

  for (const company of WORKABLE_COMPANIES) {
    const result = await fetchWorkableAccountJobs(company);
    log.info('Workable slug checked', {
      slug: company,
      result: result.result,
      count: result.count,
      attempts: result.attempts.map((attempt) => ({
        endpoint: attempt.endpoint,
        status: attempt.status,
        count: attempt.count,
      })),
    });

    for (const job of result.jobs || []) {
      if (!matchesSearchTerms(job.title)) continue;
      if (!isLocationAllowed(job.location)) continue;
      jobs.push(job);
    }

    await sleep(400);
  }

  return jobs;
}

module.exports = { scrapeWorkable };
