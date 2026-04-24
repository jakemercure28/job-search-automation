#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const { loadDashboardEnv, loadEnvFile } = require('../lib/env');
const { formatBuffer } = require('../lib/refresh-logger');

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  return {
    skipDescriptions: flags.has('--skip-descriptions'),
    skipClosedCheck: flags.has('--skip-closed-check'),
    skipMarketResearch: flags.has('--skip-market-research'),
    skipRejectionSync: flags.has('--skip-rejection-sync'),
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

function hms() {
  return new Date().toISOString().slice(11, 19);
}

function elapsed(startMs) {
  const ms = Date.now() - startMs;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toFixed(0)}s`;
}

// When stdout is not a TTY (i.e. piped into logs/refresh.log), capture child
// output and format it as readable text. When interactive, inherit so output
// streams live to the terminal.
const IS_LOG = !process.stdout.isTTY;

function runStep(repoRoot, label, args, { optional = false } = {}) {
  const start = Date.now();
  console.log(`${hms()}  [refresh]  ${label}...`);

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    // stderr is where the structured JSON logger writes; stdout is where plain-
    // text scripts (check-descriptions, check-closed) write their summaries.
    stdio: IS_LOG ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });

  if (IS_LOG) {
    // JSON structured logs (from lib/logger) come out on stderr; format those.
    // Plain-text output (check-* scripts) comes on stdout; pass through as-is.
    for (const line of formatBuffer(result.stderr)) console.log(line);
    for (const line of formatBuffer(result.stdout)) console.log(line);
  }

  if (result.status === 0) {
    console.log(`${hms()}  [refresh]  ${label} done (${elapsed(start)})`);
    return;
  }
  if (optional) {
    console.warn(`${hms()}  [refresh]  ${label} skipped — exit ${result.status || 1} (${elapsed(start)})`);
    return;
  }

  console.error(`${hms()}  [refresh]  ${label} FAILED — exit ${result.status || 1} (${elapsed(start)})`);
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
  sync rejection emails

Flags:
  --skip-descriptions    Skip suspicious JD checks
  --skip-closed-check    Skip closed-job verification
  --skip-market-research Skip market research refresh
  --skip-rejection-sync  Skip Gmail rejection email sync
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

  const runStart = Date.now();
  const active = loadActiveProfileEnv(repoRoot);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${new Date().toISOString().slice(0, 19)}Z  [refresh]  RUN START`);
  console.log(`  profile  ${active.profileDir}`);
  console.log(`  db       ${active.dbPath}`);
  console.log('─'.repeat(60));

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

  if (!args.skipRejectionSync) {
    runStep(repoRoot, 'Syncing rejection emails', ['scripts/sync-rejection-emails.js'], { optional: true });
  }

  if (args.withSlugCheck) {
    runStep(repoRoot, 'Validating ATS slugs', ['scripts/validate-slugs.js', '--broken-only'], { optional: true });
  }

  console.log('─'.repeat(60));
  console.log(`${new Date().toISOString().slice(0, 19)}Z  [refresh]  RUN COMPLETE (${elapsed(runStart)})`);
  console.log('─'.repeat(60));
}

if (require.main === module) {
  main();
}

module.exports = {
  loadActiveProfileEnv,
  parseArgs,
};
