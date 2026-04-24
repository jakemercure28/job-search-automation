'use strict';

/**
 * rescore-gemini.js
 *
 * Re-scores all non-archived jobs (applied, pending, rejected) using Gemini.
 * Overwrites the `score` column. Applies YOE caps after scoring.
 *
 * Usage: node rescore-gemini.js
 *        node rescore-gemini.js --dry-run   (show what would be scored, don't write)
 */

const path = require('path');
const Database = require('better-sqlite3');
const { scoreJob } = require('../scorer');
const { sleep } = require('../lib/utils');
const logPaths = require('../lib/log-paths');
const log = require('../lib/logger')('rescore', { logFile: logPaths.daily('rescore') });

const DB_PATH = process.env.JOB_DB_PATH || path.join(__dirname, '../profiles/example/jobs.db');
const db = new Database(DB_PATH);
const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 1200; // Gemini rate limit buffer

async function main() {
  const jobs = db.prepare(`
    SELECT id, company, title, platform, description, score
    FROM jobs
    WHERE status != 'archived'
      AND stage NOT IN ('closed', 'offer')
      AND description IS NOT NULL
      AND LENGTH(description) > 50
    ORDER BY
      CASE WHEN stage IN ('applied','phone_screen','interview') THEN 0
           WHEN stage IS NULL THEN 1
           WHEN stage = 'rejected' THEN 2
           ELSE 3 END,
      company, title
  `).all();

  log.info('Jobs to re-score', { count: jobs.length, dryRun: DRY_RUN });

  let done = 0, errors = 0, changed = 0;

  for (const job of jobs) {
    try {
      const result = await scoreJob(job);
      const rawScore = result?.score;
      if (rawScore == null) {
        log.warn('No score returned', { company: job.company, title: job.title });
        errors++;
        continue;
      }
      const prev = job.score;

      if (!DRY_RUN) {
        db.prepare(`
          UPDATE jobs SET score=?, reasoning=?, updated_at=datetime('now') WHERE id=?
        `).run(rawScore, result.reasoning || null, job.id);
      }

      const diff = prev != null ? ` (was ${prev})` : ' (new)';
      if (prev !== rawScore) changed++;
      log.info(DRY_RUN ? 'dry-run' : 'scored', { company: job.company, title: job.title, score: rawScore, prev: job.score });
      done++;
    } catch (err) {
      log.error('Score failed', { company: job.company, title: job.title, error: err.message });
      errors++;
    }

    await sleep(DELAY_MS);
  }

  log.info('Done', { scored: done, changed, errors });
}

main().catch(err => {
  log.error('Fatal', { error: err.message });
  process.exit(1);
});
