'use strict';

const { loadDashboardEnv } = require('../lib/env');
const { getDb } = require('../lib/db');
const autoApplyConfig = require('../profiles/example/auto-apply-config');
const { run: runAutoApply } = require('../lib/auto-applier');
const log = require('../lib/logger')('run-auto-apply');

function parseDryRun(argv) {
  return argv.includes('--dry-run');
}

async function run() {
  loadDashboardEnv();

  const dryRun = parseDryRun(process.argv.slice(2));
  const db = getDb();

  const before = db.prepare(`
    SELECT COUNT(*) AS eligible
    FROM jobs
    WHERE apply_complexity = 'simple'
      AND status NOT IN ('applied', 'archived')
      AND auto_applied_at IS NULL
      AND auto_apply_status IS NULL
  `).get();

  log.info('Auto-apply preflight', {
    eligible: before.eligible,
    dailyLimit: autoApplyConfig.dailyLimit,
    dryRun,
  });

  await runAutoApply(db, autoApplyConfig, dryRun);

  const after = db.prepare(`
    SELECT
      SUM(CASE WHEN auto_apply_status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN auto_apply_status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM jobs
  `).get();

  log.info('Auto-apply finished', {
    success: after.success || 0,
    failed: after.failed || 0,
    dryRun,
  });
}

if (require.main === module) {
  run().catch((error) => {
    log.error('Fatal auto-apply run error', { error: error.message });
    process.exit(1);
  });
}

module.exports = { run };
