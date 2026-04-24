'use strict';

const { sleep, safeFetch } = require('./utils');
const { matchesSearchTerms } = require('./scraper-utils');
const { SCRAPER_DELAY_MS } = require('../config/constants');

const COMPANY_CONCURRENCY = 15;

/**
 * Generic loop for company-based scrapers.
 *
 * @param {object} opts
 * @param {string[]} opts.companies     - List of company slugs to scrape
 * @param {string}   opts.platform      - Platform label for logging (e.g. 'greenhouse')
 * @param {number}   [opts.delay]       - ms between batch requests (default: SCRAPER_DELAY_MS)
 * @param {function} opts.buildUrl      - (company) => URL string
 * @param {function} opts.parseResponse - (json, company) => array of raw items
 * @param {function} opts.matchField    - (item) => string to test against search terms
 * @param {function} opts.mapJob        - (item, company) => job object
 */
async function scrapeCompanies({ companies, platform, delay = SCRAPER_DELAY_MS, buildUrl, parseResponse, matchField, mapJob }) {
  const jobs = [];

  async function fetchCompany(company) {
    const url = buildUrl(company);
    const res = await safeFetch(url, {}, `${platform}/${company}`);
    if (!res) return [];
    let data;
    try { data = await res.json(); } catch { return []; }
    return parseResponse(data, company)
      .filter(item => matchesSearchTerms(matchField(item)))
      .map(item => mapJob(item, company));
  }

  for (let i = 0; i < companies.length; i += COMPANY_CONCURRENCY) {
    const batch = companies.slice(i, i + COMPANY_CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchCompany));
    for (const r of results) {
      if (r.status === 'fulfilled') jobs.push(...r.value);
    }
    if (i + COMPANY_CONCURRENCY < companies.length) await sleep(delay);
  }

  return jobs;
}

module.exports = { scrapeCompanies };
