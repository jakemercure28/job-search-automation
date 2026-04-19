'use strict';

// One-off: re-fetch Built In job pages for pending jobs with empty location
// and update the location field in the DB.

const Database = require('better-sqlite3');
const { safeFetch, sleep } = require('../lib/utils');
const { SCRAPER_DELAY_MS } = require('../config/constants');

const DB_PATH = process.env.DB_PATH || 'profiles/jake/jobs.db';
const BASE_URL = 'https://builtin.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseLocation(html) {
  const ldMatch = html.match(/<script[^>]+ld[^>]+>([\s\S]*?)<\/script>/);
  if (!ldMatch) return null;
  let data;
  try {
    const raw = ldMatch[1]
      .replace(/&#x2B;/g, '+').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    data = JSON.parse(raw);
  } catch { return null; }

  const graph = data['@graph'] || [data];
  const posting = graph.find(item => item['@type'] === 'JobPosting');
  if (!posting) return null;

  const jobLocations = Array.isArray(posting.jobLocation)
    ? posting.jobLocation
    : posting.jobLocation ? [posting.jobLocation] : [];

  if (posting.jobLocationType === 'TELECOMMUTE') return 'Remote';
  if (!jobLocations.length) return null;

  const parts = jobLocations.map((loc) => {
    const addr = loc.address || {};
    return [addr.addressLocality, addr.addressRegion].filter(Boolean).join(', ');
  }).filter(Boolean);

  return parts.join('|') || null;
}

async function main() {
  const db = new Database(DB_PATH);
  const jobs = db.prepare(
    "SELECT id, title, company FROM jobs WHERE platform='Built In' AND (location='' OR location IS NULL) AND status='pending'"
  ).all();

  console.log(`Backfilling ${jobs.length} jobs...`);

  const update = db.prepare("UPDATE jobs SET location=? WHERE id=?");
  const headers = { 'User-Agent': USER_AGENT };

  for (const job of jobs) {
    const builtinId = job.id.replace('builtin-', '');
    const url = `${BASE_URL}/job/${slugify(job.company)}/${slugify(job.title)}/${builtinId}`;
    console.log(`Fetching ${job.company} - ${job.title} ...`);

    const res = await safeFetch(url, { headers }, 'backfill');
    if (!res) { console.log('  fetch failed, skipping'); await sleep(SCRAPER_DELAY_MS); continue; }

    let html;
    try { html = await res.text(); } catch { console.log('  read failed, skipping'); continue; }

    const location = parseLocation(html);
    if (location) {
      update.run(location, job.id);
      console.log(`  -> ${location}`);
    } else {
      console.log('  -> no location found in LD+JSON');
    }

    await sleep(SCRAPER_DELAY_MS);
  }

  console.log('Done.');
}

main().catch(console.error);
