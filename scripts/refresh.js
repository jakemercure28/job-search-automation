#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const { loadDashboardEnv, loadEnvFile } = require('../lib/env');

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  return {
    skipDescriptions: flags.has('--skip-descriptions'),
    skipClosedCheck: flags.has('--skip-closed-check'),
    skipMarketResearch: flags.has('--skip-market-research'),
    withSlugCheck: flags.has('--with-slug-check'),
    help: flags.has('--help') || flags.has('-h'),
  };
}

function loadActiveProfileEnv(repoRoot) {
  loadDashboardEnv(repoRoot);

  const profileDir = process.env.JOB_PROFILE_DIR
    ? path.resolve(repoRoot, process.env.JOB_PROFILE_DIR)
    : path.join(repoRoot, 'profiles', 'example');

  loadEnvFile(path.join(profileDir, '.env'));

  if (!process.env.JOB_PROFILE_DIR) {
    process.env.JOB_PROFILE_DIR = profileDir;
  } else {
    process.env.JOB_PROFILE_DIR = path.resolve(repoRoot, process.env.JOB_PROFILE_DIR);
  }

  if (!process.env.JOB_DB_PATH) {
    process.env.JOB_DB_PATH = path.join(process.env.JOB_PROFILE_DIR, 'jobs.db');
  } else if (!path.isAbsolute(process.env.JOB_DB_PATH)) {
    process.env.JOB_DB_PATH = path.resolve(repoRoot, process.env.JOB_DB_PATH);
  }

  return {
    profileDir: process.env.JOB_PROFILE_DIR,
    dbPath: process.env.JOB_DB_PATH,
  };
}

function runStep(repoRoot, label, args, { optional = false } = {}) {
  console.log(`[refresh] ${label}...`);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status === 0) return;
  if (optional) {
    console.warn(`[refresh] Skipped ${label} after non-zero exit (${result.status || 1}).`);
    return;
  }

  process.exit(result.status || 1);
}

function printUsage() {
  console.log(`Usage: node scripts/refresh.js [flags]

Runs the local MacBook refresh flow for the active profile:
  scrape -> pipeline -> retry unscored

Optional local-only follow-up steps:
  check descriptions
  check closed jobs
  refresh market research

Flags:
  --skip-descriptions    Skip suspicious JD checks
  --skip-closed-check    Skip closed-job verification
  --skip-market-research Skip market research refresh
  --with-slug-check      Also validate ATS slugs
`);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    return;
  }

  const active = loadActiveProfileEnv(repoRoot);
  console.log(`[refresh] Active profile: ${active.profileDir}`);
  console.log(`[refresh] Active DB: ${active.dbPath}`);

  runStep(repoRoot, 'Scraping jobs', ['scraper.js']);
  runStep(repoRoot, 'Running pipeline', ['pipeline.js']);
  runStep(repoRoot, 'Retrying unscored jobs', ['scripts/retry-unscored.js', '--limit=25'], { optional: true });

  if (!args.skipDescriptions) {
    runStep(repoRoot, 'Checking description quality', ['scripts/check-descriptions.js'], { optional: true });
  }

  if (!args.skipClosedCheck) {
    runStep(repoRoot, 'Checking for closed jobs', ['scripts/check-closed.js'], { optional: true });
  }

  if (!args.skipMarketResearch) {
    runStep(repoRoot, 'Refreshing market research', ['scripts/run-market-research.js'], { optional: true });
  }

  if (args.withSlugCheck) {
    runStep(repoRoot, 'Validating ATS slugs', ['scripts/validate-slugs.js', '--broken-only'], { optional: true });
  }

  console.log('[refresh] Done.');
}

if (require.main === module) {
  main();
}

module.exports = {
  loadActiveProfileEnv,
  parseArgs,
};
