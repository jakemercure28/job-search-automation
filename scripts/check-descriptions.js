'use strict';

/**
 * check-descriptions.js
 *
 * Checks today's newly scraped jobs for missing or suspiciously short descriptions.
 * Run after pipeline.js in run-daily.sh.
 *
 * Writes jd-health.json for the dashboard banner.
 *
 * Exit codes:
 *   0 — all ok (or no new jobs)
 *   1 — one or more jobs have critically short descriptions (< CRITICAL chars)
 */

const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger');
const logPaths = require('../lib/log-paths');

const log = createLogger('check-descriptions', { logFile: logPaths.daily('check-descriptions') });

const CRITICAL = 50;   // definitely broken — null/empty or just a few words
const WARN     = 300;  // suspicious — likely a snippet, not the full JD

function checkDescriptions(db) {
  const todayStr = new Date().toLocaleDateString('en-CA');
  const newJobs = db.prepare(
    `SELECT id, title, company, platform,
            COALESCE(length(description), 0) as len
     FROM jobs
     WHERE date(created_at, 'localtime') = ?`
  ).all(todayStr);

  const critical = newJobs.filter(j => j.len < CRITICAL);
  const warn     = newJobs.filter(j => j.len >= CRITICAL && j.len < WARN);
  const ok       = newJobs.length - critical.length - warn.length;

  return { total: newJobs.length, critical, warn, ok };
}

function writeJdHealth({ total, critical, warn }) {
  const out = {
    timestamp: new Date().toISOString(),
    critical,
    warn,
    total,
  };
  const p = path.join(__dirname, '../jd-health.json');
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
}

if (require.main === module) {
  const { getDb } = require('../lib/db');
  const db = getDb();
  const { total, critical, warn, ok } = checkDescriptions(db);

  if (!total) {
    log.info('No new jobs today — skipping');
    writeJdHealth({ total: 0, critical: [], warn: [] });
    process.exit(0);
  }

  for (const j of critical) {
    log.error('Critical: description too short', { platform: j.platform, company: j.company, title: j.title, chars: j.len });
  }
  for (const j of warn) {
    log.warn('Short description', { platform: j.platform, company: j.company, title: j.title, chars: j.len });
  }

  const status = critical.length > 0 ? 'FAIL' : warn.length > 0 ? 'WARN' : 'OK';
  log.info('Description quality check complete', { status, total, critical: critical.length, short: warn.length, ok });

  writeJdHealth({ total, critical, warn });

  if (critical.length > 0) process.exit(1);
}

module.exports = { checkDescriptions, writeJdHealth, CRITICAL, WARN };
