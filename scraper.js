/**
 * scraper.js
 * Thin orchestrator — runs all platform scrapers in parallel and writes jobs.json.
 *
 * Usage (standalone):  node scraper.js
 * Usage (module):      const { scrapeAll } = require('./scraper');
 */

'use strict';

const fs = require('fs');
const { loadDashboardEnv } = require('./lib/env');

loadDashboardEnv(__dirname);

const { jobsJsonPath } = require('./config/paths');
const log = require('./lib/logger')('scraper');
const { validateJobs } = require('./lib/validate');
const { scrapeGreenhouse } = require('./scrapers/greenhouse');
const { scrapeLever }      = require('./scrapers/lever');
const { scrapeWorkable }   = require('./scrapers/workable');
const { scrapeWellfound }  = require('./scrapers/wellfound');
const { scrapeRemoteOK }   = require('./scrapers/remoteok');
const { scrapeJobicy }     = require('./scrapers/jobicy');
const { scrapeArbeitnow }  = require('./scrapers/arbeitnow');
const { scrapeWWR }        = require('./scrapers/wwr');
const { scrapeAshby }      = require('./scrapers/ashby');
const { scrapeWorkday }    = require('./scrapers/workday');
const { scrapeBuiltin }    = require('./scrapers/builtin');
const { scrapeRippling }   = require('./scrapers/rippling');

const { isLocationAllowed } = require('./lib/location-filter');
const { MAX_AGE_DAYS }      = require('./config/companies');

const MS_PER_DAY = 86_400_000;

function isRecent(dateVal) {
  if (!dateVal) return false;
  const ts = typeof dateVal === 'number' ? dateVal : Date.parse(dateVal);
  if (isNaN(ts)) return false;
  return Date.now() - ts <= MAX_AGE_DAYS * MS_PER_DAY;
}

async function scrapeAll() {
  log.info('Starting scrape across all platforms');

  const [greenhouse, lever, workable, wellfound, remoteok, jobicy, arbeitnow, wwr, ashby, workday, builtin, rippling] = await Promise.allSettled([
    scrapeGreenhouse(),
    scrapeLever(),
    scrapeWorkable(),
    scrapeWellfound(),
    scrapeRemoteOK(),
    scrapeJobicy(),
    scrapeArbeitnow(),
    scrapeWWR(),
    scrapeAshby(),
    scrapeWorkday(),
    scrapeBuiltin(),
    scrapeRippling(),
  ]);

  const results = [
    ['greenhouse', greenhouse], ['lever', lever], ['workable', workable],
    ['wellfound', wellfound], ['remoteok', remoteok], ['jobicy', jobicy],
    ['arbeitnow', arbeitnow], ['wwr', wwr], ['ashby', ashby], ['workday', workday],
    ['builtin', builtin], ['rippling', rippling],
  ];

  const allJobs = results.flatMap(([label, r]) =>
    r.status === 'fulfilled' ? validateJobs(r.value, label) : []
  );

  // Deduplicate by URL within this batch (DB-level dedup happens in pipeline.js)
  const seen = new Set();
  const unique = allJobs.filter((j) => {
    if (!j.url || seen.has(j.url)) return false;
    seen.add(j.url);
    return true;
  });

  // Age filter: keep if new to DB (not in knownIds) OR recently posted.
  // run-daily.sh writes existing job IDs to /tmp/known_job_ids.json before calling us.
  let knownIds = new Set();
  try {
    knownIds = new Set(JSON.parse(fs.readFileSync('/tmp/known_job_ids.json', 'utf8')));
  } catch {}
  const ageFiltered = unique.filter((j) => !knownIds.has(j.id) || isRecent(j.postedAt || ''));

  const locationFiltered = ageFiltered.filter((j) => isLocationAllowed(j.location));

  log.info('Scrape complete', { beforeFilter: unique.length, afterFilter: locationFiltered.length });

  // Write results to jobs.json for pipeline.js to consume
  fs.writeFileSync(jobsJsonPath, JSON.stringify(locationFiltered, null, 2));

  return locationFiltered;
}

// Run standalone
if (require.main === module) {
  scrapeAll()
    .then((jobs) => log.info('Scraped jobs written to jobs.json', { count: jobs.length }))
    .catch((err) => {
      log.error('Fatal error', { error: err.message });
      process.exit(1);
    });
}

module.exports = { scrapeAll };
