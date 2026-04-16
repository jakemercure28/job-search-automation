'use strict';

const { sleep, safeFetch } = require('./utils');
const { matchesSearchTerms } = require('./scraper-utils');
const { SCRAPER_DELAY_MS } = require('../config/constants');

/**
 * Generic loop for company-based scrapers.
 *
 * @param {object} opts
 * @param {string[]} opts.companies     - List of company slugs to scrape
 * @param {string}   opts.platform      - Platform label for logging (e.g. 'greenhouse')
 * @param {number}   [opts.delay]       - ms between requests (default: SCRAPER_DELAY_MS)
 * @param {function} opts.buildUrl      - (company) => URL string
 * @param {function} opts.parseResponse - (json, company) => array of raw items
 * @param {function} opts.matchField    - (item) => string to test against search terms
 * @param {function} opts.mapJob        - (item, company) => job object
 */
async function scrapeCompanies({ companies, platform, delay = SCRAPER_DELAY_MS, buildUrl, parseResponse, matchField, mapJob }) {
  const jobs = [];

  for (const company of companies) {
    const url = buildUrl(company);
    const res = await safeFetch(url, {}, `${platform}/${company}`);
    if (!res) { await sleep(delay); continue; }

    let data;
    try { data = await res.json(); } catch { await sleep(delay); continue; }

    for (const item of parseResponse(data, company)) {
      if (!matchesSearchTerms(matchField(item))) continue;
      jobs.push(mapJob(item, company));
    }

    await sleep(delay);
  }

  return jobs;
}

module.exports = { scrapeCompanies };
