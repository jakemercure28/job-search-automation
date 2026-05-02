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
const { callGemini, MODEL } = require('./lib/gemini');
const { GEMINI_DAILY_LIMIT } = require('./config/constants');
const { classifyComplexity } = require('./lib/complexity');
const { isPrimaryPlatform } = require('./lib/ats-resolver');
const { normalizeScrapedJobs } = require('./scripts/resolve-ats-aliases');
const logPaths = require('./lib/log-paths');
const log = require('./lib/logger')('pipeline', { logFile: logPaths.daily('pipeline') });

function hasPrimaryDuplicate(db, job) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM jobs
    WHERE LOWER(TRIM(title)) = LOWER(TRIM(?))
      AND LOWER(TRIM(company)) = LOWER(TRIM(?))
      AND LOWER(COALESCE(platform, '')) IN ('ashby', 'greenhouse', 'lever', 'workday')
    LIMIT 1
  `).get(job.title || '', job.company || ''));
}

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
  const scrapedRaw = JSON.parse(fs.readFileSync(jobsJsonPath, 'utf8'));

  const db = getDb();
  const { jobs: scraped, report: atsResolutionReport } = await normalizeScrapedJobs(scrapedRaw, { log, useGemini: true });
  if (atsResolutionReport.length) {
    log.info('ATS resolution before import', {
      canonicalized: atsResolutionReport.filter((row) => row.action === 'canonicalized').length,
      unsupported: atsResolutionReport.filter((row) => row.action === 'skipped-unsupported').length,
      unresolved: atsResolutionReport.filter((row) => row.action === 'unresolved').length,
    });
  }

  // Insert and deduplicate in a single transaction for atomicity
  const existing = getExistingJobKeys(db);
  const insertAndDedup = db.transaction((scraped) => {
    let skipped = 0;
    let inserted = 0;
    for (const j of scraped) {
      const key = (j.title || '').trim().toLowerCase() + '|||' + (j.company || '').trim().toLowerCase();
      if (existing.has(key) && (!isPrimaryPlatform(j.platform) || hasPrimaryDuplicate(db, j))) { skipped++; continue; }
      existing.add(key); // prevent intra-batch dupes
      if (insertJob(db, j)) inserted++;
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

    // Archive alternate-source jobs that duplicate a primary ATS row.
    const alternateDupesResult = db.prepare(`
      UPDATE jobs SET status = 'archived', updated_at = datetime('now')
      WHERE LOWER(COALESCE(platform, '')) NOT IN ('ashby', 'greenhouse', 'lever', 'workday')
        AND EXISTS (
          SELECT 1 FROM jobs source
          WHERE LOWER(COALESCE(source.platform, '')) IN ('ashby', 'greenhouse', 'lever', 'workday')
            AND LOWER(TRIM(source.title)) = LOWER(TRIM(jobs.title))
            AND LOWER(TRIM(source.company)) = LOWER(TRIM(jobs.company))
            AND source.id != jobs.id
        )
    `).run();
    if (alternateDupesResult.changes > 0) {
      log.info('Auto-archived alternate-source duplicates (prefer primary ATS)', { count: alternateDupesResult.changes });
    }

    return { inserted, skipped };
  });
  const { inserted, skipped } = insertAndDedup(scraped);

  // Score unscored jobs, respecting the daily API quota
  const todayStr = new Date().toLocaleDateString('en-CA');
  const usedToday = db.prepare(
    "SELECT COALESCE(SUM(call_count), 0) as n FROM api_usage WHERE date = ? AND model = ?"
  ).get(todayStr, MODEL).n;
  const remainingQuota = Math.max(0, GEMINI_DAILY_LIMIT - usedToday - 10); // reserve 10 for summary + retries
  const toScore = getUnscoredJobs(db, { limit: remainingQuota });
  if (usedToday > 0 || remainingQuota < GEMINI_DAILY_LIMIT) {
    log.info('Daily quota check', { usedToday, remainingQuota, toScore: toScore.length });
  }

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
  run().then(() => process.exit(0)).catch((err) => {
    log.error('Fatal error', { error: err.message });
    process.exit(1);
  });
}

module.exports = { run, hasPrimaryDuplicate };
