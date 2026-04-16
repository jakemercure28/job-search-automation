#!/usr/bin/env node
'use strict';

// CLI for manually adding LinkedIn Easy Apply (or other manually applied) jobs to the pipeline.
// Usage: node add-applied.js
//
// For each job:
//   1. Prompts for title, company, URL, location, platform, description
//   2. Inserts into jobs.db as status=applied, stage=applied
//   3. Scores the job automatically via Gemini (requires GEMINI_API_KEY)
//   4. Checks if company is in the scraper list (companies.js)
//   5. If not, offers to add it
//   6. Loops until done

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = process.env.JOB_DB_PATH || path.join(__dirname, 'profiles', 'example', 'jobs.db');
const companiesPath = process.env.JOB_PROFILE_DIR
  ? path.join(process.env.JOB_PROFILE_DIR, 'companies.js')
  : path.join(__dirname, 'profiles', 'example', 'companies.js');

const db = new Database(dbPath);

// Scorer is optional — only loaded if GEMINI_API_KEY is set
let _scoreJob = null;
function getScorer() {
  if (_scoreJob) return _scoreJob;
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    _scoreJob = require('./scorer').scoreJob;
    return _scoreJob;
  } catch (e) {
    return null;
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function generateId(platform, company, title) {
  const prefix = platform === 'LinkedIn Easy Apply' ? 'linkedin-ea' : slugify(platform);
  return `${prefix}-${slugify(company)}-${slugify(title)}`.slice(0, 120);
}

function checkCompanyInScraper(companyName) {
  const { GREENHOUSE_COMPANIES, LEVER_COMPANIES, ASHBY_COMPANIES, WORKABLE_COMPANIES, WORKDAY_COMPANIES } = require(companiesPath);
  const needle = companyName.toLowerCase().replace(/\s+/g, '');

  for (const slug of GREENHOUSE_COMPANIES) {
    if (slug.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle) ||
        needle.includes(slug.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      return { found: true, platform: 'Greenhouse', slug };
    }
  }
  for (const slug of LEVER_COMPANIES) {
    if (slug.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle) ||
        needle.includes(slug.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      return { found: true, platform: 'Lever', slug };
    }
  }
  for (const slug of ASHBY_COMPANIES) {
    if (slug.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle) ||
        needle.includes(slug.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      return { found: true, platform: 'Ashby', slug };
    }
  }
  for (const slug of WORKABLE_COMPANIES) {
    if (slug.toLowerCase().replace(/[^a-z0-9]/g, '').includes(needle) ||
        needle.includes(slug.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
      return { found: true, platform: 'Workable', slug };
    }
  }
  for (const entry of WORKDAY_COMPANIES) {
    const label = entry.label.toLowerCase().replace(/\s+/g, '');
    if (label.includes(needle) || needle.includes(label)) {
      return { found: true, platform: 'Workday', slug: entry.sub };
    }
  }
  return { found: false };
}

function appendCompanyToScraper(platform, slug, label) {
  const source = fs.readFileSync(companiesPath, 'utf8');
  let updated = source;
  const comment = `  '${slug}',          // ${label} — added via add-applied.js`;

  if (platform === 'Greenhouse') {
    updated = source.replace(/^(\s*'[^']+',\s*\/\/[^\n]*\n)(?=\];[\s\n]*\/\/ Companies known to use Lever)/m,
      `$1${comment}\n`);
    if (updated === source) {
      // Fallback: append before closing ]; of GREENHOUSE_COMPANIES
      updated = source.replace(/(const GREENHOUSE_COMPANIES = \[[\s\S]*?)(^\];)/m, `$1${comment}\n$2`);
    }
  } else if (platform === 'Lever') {
    updated = source.replace(/(const LEVER_COMPANIES = \[[\s\S]*?)(^\];)/m, `$1${comment}\n$2`);
  } else if (platform === 'Ashby') {
    updated = source.replace(/(const ASHBY_COMPANIES = \[[\s\S]*?)(^\];)/m, `$1${comment}\n$2`);
  } else if (platform === 'Workable') {
    updated = source.replace(/(const WORKABLE_COMPANIES = \[[\s\S]*?)(^\];)/m, `$1${comment}\n$2`);
  }

  if (updated === source) {
    console.log(`  Could not auto-append. Add manually to ${platform.toUpperCase()}_COMPANIES in companies.js: '${slug}'`);
    return false;
  }

  fs.writeFileSync(companiesPath, updated);
  return true;
}

const insertJob = db.prepare(`
  INSERT OR IGNORE INTO jobs
    (id, title, company, url, platform, location, posted_at, description, status, stage, applied_at, created_at, updated_at)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, 'applied', 'applied', ?, datetime('now'), datetime('now'))
`);

const insertEvent = db.prepare(`
  INSERT INTO events (job_id, event_type, from_value, to_value)
  VALUES (?, 'stage_change', NULL, 'applied')
`);

async function addOneJob() {
  console.log('\n--- Add Applied Job ---');
  const title = (await ask('Title: ')).trim();
  if (!title) return false;

  const company = (await ask('Company: ')).trim();
  const url = (await ask('URL (or enter to skip): ')).trim() || '';
  const location = (await ask('Location: ')).trim() || '';
  const platformRaw = (await ask('Platform [LinkedIn Easy Apply]: ')).trim();
  const platform = platformRaw || 'LinkedIn Easy Apply';
  const description = (await ask('Description (one line, or enter to skip): ')).trim() || '';

  const id = generateId(platform, company, title);
  const appliedAt = new Date().toISOString();

  const result = db.transaction(() => {
    const r = insertJob.run(id, title, company, url, platform, location, appliedAt, description, appliedAt);
    if (r.changes > 0) {
      insertEvent.run(id);
    }
    return r;
  })();

  if (result.changes === 0) {
    console.log(`  Already in DB (skipped): ${company} — ${title}`);
  } else {
    console.log(`  Inserted: ${company} — ${title} (id: ${id})`);

    // Auto-score via Gemini
    const scoreJob = getScorer();
    if (scoreJob) {
      process.stdout.write('  Scoring...');
      try {
        const { score, reasoning } = await scoreJob({ id, title, company, url, platform, location, description, postedAt: appliedAt });
        db.prepare('UPDATE jobs SET score=?, reasoning=? WHERE id=?').run(score, reasoning, id);
        console.log(` ${score}/10`);
      } catch (e) {
        console.log(` failed (${e.message})`);
      }
    } else {
      console.log('  Score: skipped (no GEMINI_API_KEY)');
    }
  }

  // Check scraper list
  const check = checkCompanyInScraper(company);
  if (check.found) {
    console.log(`  Scraper: already tracking ${company} on ${check.platform} ('${check.slug}')`);
  } else {
    console.log(`  Scraper: ${company} not in scraper list.`);
    const atsPlatform = (await ask('  ATS platform? (greenhouse/lever/ashby/workable/skip): ')).trim().toLowerCase();
    if (atsPlatform && atsPlatform !== 'skip') {
      const validPlatforms = ['greenhouse', 'lever', 'ashby', 'workable'];
      if (!validPlatforms.includes(atsPlatform)) {
        console.log(`  Unknown platform '${atsPlatform}'. For Workday, add manually. Skipping.`);
      } else {
        const atsSlug = (await ask(`  Slug for ${company} on ${atsPlatform} (e.g. 'palona-ai'): `)).trim();
        if (atsSlug) {
          const platformTitle = atsPlatform.charAt(0).toUpperCase() + atsPlatform.slice(1);
          const ok = appendCompanyToScraper(platformTitle, atsSlug, company);
          if (ok) console.log(`  Added '${atsSlug}' to ${platformTitle} scraper list.`);
        } else {
          console.log('  No slug provided, skipping.');
        }
      }
    } else {
      console.log('  Skipped — not added to scraper.');
    }
  }

  return true;
}

async function main() {
  console.log('Add manually applied jobs to the pipeline.');
  console.log('Leave Title blank to stop.\n');

  while (true) {
    const added = await addOneJob();
    if (!added) break;
    const again = (await ask('\nAdd another? (y/n): ')).trim().toLowerCase();
    if (again !== 'y') break;
  }

  rl.close();
  console.log('\nDone. View at http://localhost:3131?filter=applied');
}

main().catch(err => { console.error(err); process.exit(1); });
