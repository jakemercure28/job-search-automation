/**
 * pipeline.js
 * Reads jobs.json written by scraper.js, inserts into DB, scores unscored jobs.
 *
 * Usage: node pipeline.js
 */

'use strict';

const fs = require('fs');

const { jobsJsonPath } = require('./config/paths');
const { requireEnv } = require('./lib/env');
const {
  getDb,
  getExistingJobKeys,
  insertJob,
  getUnscoredJobs,
  markJobScoreAttempt,
  markJobScoreFailure,
  updateJobScore,
} = require('./lib/db');
const { scoreJob } = require('./scorer');
const { callGemini } = require('./lib/gemini');
const { classifyComplexity } = require('./lib/complexity');
const { run: autoApply } = require('./lib/auto-applier');
const log = require('./lib/logger')('pipeline');

async function generateSummary(newJobs) {
  if (!newJobs.length) {
    return 'No new jobs scraped today.';
  }

  const top5 = [...newJobs].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  const highScored = top5.filter(j => j.score >= 8);
  const jobsList = top5.map(j => `${j.title} at ${j.company} (${j.score != null ? j.score : '?'}/10)`).join(', ');
  const count = newJobs.length;
  const noun = count === 1 ? 'job' : 'jobs';

  try {
    const prompt = `Write ONE casual sentence summarizing today's new job listings for a job seeker. Be specific about quality and highlights — mention company names and whether they're strong fits. Keep it under 140 chars. No exclamation marks. No em dashes.

New listings today: ${count} ${noun}
Top matches by score: ${jobsList}
Strong fits (8+/10): ${highScored.length > 0 ? highScored.map(j => `${j.company} (${j.score}/10)`).join(', ') : 'none today'}`;

    const result = await callGemini(prompt);
    return result || `${count} new ${noun} scraped today.`;
  } catch (e) {
    log.error('Summary generation failed', { error: e.message });
    return `${count} new ${noun} scraped today.`;
  }
}

async function run() {
  requireEnv('GEMINI_API_KEY');
  const scraped = JSON.parse(fs.readFileSync(jobsJsonPath, 'utf8'));

  const db = getDb();

  // Insert and deduplicate in a single transaction for atomicity
  const existing = getExistingJobKeys(db);
  const insertAndDedup = db.transaction((scraped) => {
    let skipped = 0;
    let inserted = 0;
    for (const j of scraped) {
      const key = (j.title || '').trim().toLowerCase() + '|||' + (j.company || '').trim().toLowerCase();
      if (existing.has(key)) { skipped++; continue; }
      existing.add(key); // prevent intra-batch dupes
      insertJob(db, j);
      inserted++;
    }
    if (skipped > 0) {
      log.info('Skipped pre-existing duplicates', { count: skipped });
    }

    // Auto-archive re-posts where the older version was just dismissed (no stage)
    const dedupResult = db.prepare(`
      UPDATE jobs SET status = 'archived', updated_at = datetime('now')
      WHERE status = 'pending' AND score IS NULL
        AND EXISTS (
          SELECT 1 FROM jobs j2
          WHERE LOWER(TRIM(j2.title)) = LOWER(TRIM(jobs.title))
            AND LOWER(TRIM(j2.company)) = LOWER(TRIM(jobs.company))
            AND j2.id != jobs.id
            AND j2.status = 'archived'
            AND (j2.stage IS NULL OR j2.stage = '')
        )
    `).run();
    if (dedupResult.changes > 0) {
      log.info('Auto-archived re-posted duplicates', { count: dedupResult.changes });
    }

    // For pending-only duplicates (same title+company, none archived), keep the newest
    const pendingDedupResult = db.prepare(`
      UPDATE jobs SET status = 'archived', updated_at = datetime('now')
      WHERE status = 'pending' AND score IS NULL
        AND id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY LOWER(TRIM(title)), LOWER(TRIM(company))
              ORDER BY created_at DESC
            ) as rn
            FROM jobs WHERE status = 'pending'
          ) WHERE rn = 1
        )
        AND EXISTS (
          SELECT 1 FROM jobs j2
          WHERE LOWER(TRIM(j2.title)) = LOWER(TRIM(jobs.title))
            AND LOWER(TRIM(j2.company)) = LOWER(TRIM(jobs.company))
            AND j2.id != jobs.id
            AND j2.status = 'pending'
        )
    `).run();
    if (pendingDedupResult.changes > 0) {
      log.info('Auto-archived older pending duplicates', { count: pendingDedupResult.changes });
    }

    // Archive Built In jobs that duplicate Greenhouse or Ashby (source platforms preferred)
    const builtInDupesResult = db.prepare(`
      UPDATE jobs SET status = 'archived', updated_at = datetime('now')
      WHERE platform = 'Built In'
        AND EXISTS (
          SELECT 1 FROM jobs source
          WHERE source.platform IN ('Greenhouse', 'Ashby')
            AND LOWER(TRIM(source.title)) = LOWER(TRIM(jobs.title))
            AND LOWER(TRIM(source.company)) = LOWER(TRIM(jobs.company))
            AND source.id != jobs.id
        )
    `).run();
    if (builtInDupesResult.changes > 0) {
      log.info('Auto-archived Built In duplicates (prefer Greenhouse/Ashby)', { count: builtInDupesResult.changes });
    }

    return { inserted, skipped };
  });
  const { inserted, skipped } = insertAndDedup(scraped);

  // Score all unscored jobs (outside transaction — each makes an API call, save partial progress)
  const toScore = getUnscoredJobs(db);
  const archiveThreshold = parseInt(process.env.AUTO_ARCHIVE_THRESHOLD, 10) || 4;
  const autoArchive = db.prepare("UPDATE jobs SET status='archived', updated_at=datetime('now') WHERE id=? AND score <= ?");

  for (const job of toScore) {
    markJobScoreAttempt(db, job.id);

    try {
      const { score, reasoning } = await scoreJob(job);

      if (score == null) {
        const error = reasoning || 'Gemini returned an unparsable score.';
        markJobScoreFailure(db, job.id, error);
        log.error('Scoring failed', { title: job.title, error });
        continue;
      }

      updateJobScore(db, job.id, score, reasoning);
      if (score !== null && score <= archiveThreshold) autoArchive.run(job.id, archiveThreshold);
    } catch (e) {
      markJobScoreFailure(db, job.id, e.message);
      log.error('Scoring failed', { title: job.title, error: e.message });
    }
  }

  // Classify application complexity for scored jobs (any non-archived status)
  const toClassify = db.prepare(
    "SELECT * FROM jobs WHERE apply_complexity IS NULL AND status != 'archived' AND score IS NOT NULL"
  ).all();
  await classifyComplexity(toClassify, db);

  // Auto-apply to high-scoring Greenhouse and Lever jobs
  try {
    const autoApplyConfig = require('./profiles/example/auto-apply-config');
    const dryRun = process.env.AUTO_APPLY_DRY_RUN === 'true';
    await autoApply(db, autoApplyConfig, dryRun);
  } catch (e) {
    log.error('Auto-apply step failed', { error: e.message });
  }

  // Generate and store daily summary from today's new jobs
  const todaysJobs = db.prepare(
    "SELECT title, company, score FROM jobs WHERE date(created_at, 'localtime') = date('now', 'localtime') AND status != 'archived' ORDER BY score DESC"
  ).all();
  const summary = await generateSummary(todaysJobs);
  db.prepare("INSERT OR REPLACE INTO metadata (key, value, updated_at) VALUES ('daily_summary', ?, datetime('now'))").run(summary);

  log.info('Pipeline complete', {
    scraped: scraped.length,
    inserted,
    skipped,
    scored: toScore.length,
  });
  log.info('Daily summary', { summary });

  // Run stats snapshot — visible at a glance in kubectl logs
  const stats = db.prepare(`
    SELECT
      COUNT(*)                                                        AS total,
      COUNT(CASE WHEN status = 'pending' THEN 1 END)                 AS pending_review,
      COUNT(CASE WHEN status = 'pending' AND score >= 7 THEN 1 END)  AS pending_high_score,
      COUNT(CASE WHEN applied_at IS NOT NULL THEN 1 END)             AS applied,
      COUNT(CASE WHEN stage = 'phone_screen' THEN 1 END)             AS phone_screens,
      COUNT(CASE WHEN stage = 'interview' THEN 1 END)                AS interviews,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END)                AS rejected,
      COUNT(CASE WHEN status = 'archived' THEN 1 END)                AS archived,
      COUNT(CASE WHEN date(created_at, 'localtime') = date('now', 'localtime') AND status != 'archived' THEN 1 END) AS new_today
    FROM jobs
  `).get();
  log.info('=== RUN STATS ===', {
    new_today:          stats.new_today,
    pending_review:     stats.pending_review,
    pending_high_score: `${stats.pending_high_score} (score 7+)`,
    applied:            stats.applied,
    phone_screens:      stats.phone_screens,
    interviews:         stats.interviews,
    rejected:           stats.rejected,
    total_in_db:        stats.total,
  });
}

if (require.main === module) {
  run().catch((err) => {
    log.error('Fatal error', { error: err.message });
    process.exit(1);
  });
}

module.exports = { run };
