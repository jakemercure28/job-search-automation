'use strict';

const { loadDashboardEnv } = require('./lib/env');
loadDashboardEnv(__dirname);

const { getDb } = require('./lib/db');
const { syncRejectionEmails } = require('./lib/rejection-email-sync');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = getDb();
  const summary = await syncRejectionEmails(db, { dryRun });
  process.stdout.write(JSON.stringify(summary) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
