'use strict';

const { requireEnv } = require('../lib/env');
const {
  getDb,
  getUnscoredJobs,
  markJobScoreAttempt,
  markJobScoreFailure,
  updateJobScore,
} = require('../lib/db');
const { classifyComplexity } = require('../lib/complexity');
const { scoreJob } = require('../scorer');
const logPaths = require('../lib/log-paths');
const log = require('../lib/logger')('score-retry', { logFile: logPaths.daily('retry-unscored') });

const DEFAULT_LIMIT = 25;

function parseLimit(argv) {
  const arg = argv.find((value) => value.startsWith('--limit='));
  if (!arg) return DEFAULT_LIMIT;

  const parsed = parseInt(arg.split('=')[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
}

async function run() {
  requireEnv('GEMINI_API_KEY');

  const limit = parseLimit(process.argv.slice(2));
  const db = getDb();
  const toScore = getUnscoredJobs(db, { limit });

  if (!toScore.length) {
    log.info('No pending unscored jobs to retry');
    return;
  }

  const archiveThreshold = parseInt(process.env.AUTO_ARCHIVE_THRESHOLD, 10) || 4;
  const autoArchive = db.prepare("UPDATE jobs SET status='archived', updated_at=datetime('now') WHERE id=? AND score <= ?");
  let scored = 0;
  let failed = 0;

  for (const job of toScore) {
    markJobScoreAttempt(db, job.id);

    try {
      const { score, reasoning } = await scoreJob(job);

      if (score == null) {
        const error = reasoning || 'Gemini returned an unparsable score.';
        markJobScoreFailure(db, job.id, error);
        failed++;
        log.error('Retry scoring failed', { title: job.title, error });
        continue;
      }

      updateJobScore(db, job.id, score, reasoning);
      if (score <= archiveThreshold) autoArchive.run(job.id, archiveThreshold);
      scored++;
    } catch (error) {
      markJobScoreFailure(db, job.id, error.message);
      failed++;
      log.error('Retry scoring failed', { title: job.title, error: error.message });
    }
  }

  const toClassify = db.prepare(
    "SELECT * FROM jobs WHERE apply_complexity IS NULL AND status != 'archived' AND score IS NOT NULL"
  ).all();
  await classifyComplexity(toClassify, db);

  log.info('Retry scoring complete', {
    queued: toScore.length,
    scored,
    failed,
    remaining_unscored: getUnscoredJobs(db).length,
  });
}

if (require.main === module) {
  run().catch((error) => {
    log.error('Fatal retry scoring error', { error: error.message });
    process.exit(1);
  });
}

module.exports = { run };
