'use strict';

const path = require('path');
const { loadDashboardEnv } = require('../lib/env');
const log = require('../lib/logger')('run-auto-apply');

function parseDryRun(argv) {
  return argv.includes('--dry-run');
}

function getProfileDir() {
  return path.resolve(process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example'));
}

function loadAutoApplyConfig() {
  return require(path.join(getProfileDir(), 'auto-apply-config'));
}

async function run() {
  loadDashboardEnv(path.join(__dirname, '..'));
  log.error('Unattended auto-apply has been removed. Use `npm run apply -- --job=<job-id>` instead.');
  process.exitCode = 1;
}

if (require.main === module) {
  run().catch((error) => {
    log.error('Reviewed apply shim failed', { error: error.message });
    process.exit(1);
  });
}

module.exports = { run, parseDryRun, getProfileDir, loadAutoApplyConfig };
