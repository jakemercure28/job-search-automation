'use strict';

const { loadDashboardEnv } = require('../lib/env');
const { getDb } = require('../lib/db');
const { classifyComplexity } = require('../lib/complexity');
const logPaths = require('../lib/log-paths');
const log = require('../lib/logger')('reclassify-complexity', { logFile: logPaths.daily('reclassify') });

async function run() {
  loadDashboardEnv();

  const db = getDb();

  const reset = db.prepare(`
    UPDATE jobs
    SET apply_complexity = NULL,
        updated_at = datetime('now')
    WHERE status != 'archived'
      AND score IS NOT NULL
  `);

  const resetResult = reset.run();
  const toClassify = db.prepare(`
    SELECT *
    FROM jobs
    WHERE status != 'archived'
      AND score IS NOT NULL
      AND apply_complexity IS NULL
    ORDER BY created_at ASC
  `).all();

  await classifyComplexity(toClassify, db);

  const summary = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN apply_complexity = 'simple' THEN 1 ELSE 0 END) AS simple,
      SUM(CASE WHEN apply_complexity = 'complex' THEN 1 ELSE 0 END) AS complex,
      SUM(CASE WHEN apply_complexity IS NULL THEN 1 ELSE 0 END) AS unknown
    FROM jobs
    WHERE status != 'archived'
      AND score IS NOT NULL
  `).get();

  log.info('Reclassification complete', {
    reset: resetResult.changes,
    total: summary.total,
    simple: summary.simple,
    complex: summary.complex,
    unknown: summary.unknown,
  });
}

if (require.main === module) {
  run().catch((error) => {
    log.error('Fatal reclassification error', { error: error.message });
    process.exit(1);
  });
}

module.exports = { run };
