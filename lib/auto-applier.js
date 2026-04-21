'use strict';

const path = require('path');
const { AI_TITLE_KW, AI_DESC_KW } = require('../config/constants');
const { logEvent } = require('./db');
const { prepareApplication } = require('./application-prep');
const { classifyComplexity } = require('./complexity');
const { applyGreenhouse } = require('./ats-appliers/greenhouse');
const { applyLever }      = require('./ats-appliers/lever');
const { applyAshby }      = require('./ats-appliers/ashby');
const log = require('./logger')('auto-apply');
const { baseDir } = require('../config/paths');

const SUPPORTED_PLATFORMS = new Set(['greenhouse', 'lever', 'ashby']);

function countSuccessfulApplicationsToday(db, dateStr = null) {
  const targetDate = dateStr || new Date().toLocaleDateString('en-CA');
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM auto_apply_log
    WHERE status = 'success'
      AND COALESCE(dry_run, 0) = 0
      AND date(attempted_at, 'localtime') = ?
  `).get(targetDate).n;
}

/**
 * Pick the right resume variant for a job.
 * Returns a path relative to the project root.
 */
function pickResume(job, baseResumeDir) {
  const isAi = AI_TITLE_KW.test(job.title || '') || AI_DESC_KW.test((job.description || '').slice(0, 1500));
  const variant = isAi ? 'resume-ai.pdf' : 'resume.pdf';
  return `${baseResumeDir}/${variant}`;
}

/**
 * Detect which ATS platform a job uses, based on platform field or URL.
 */
function detectPlatform(job) {
  const p = (job.platform || '').toLowerCase();
  if (p.includes('greenhouse')) return 'greenhouse';
  if (p.includes('lever'))      return 'lever';
  if (p.includes('ashby'))      return 'ashby';
  if ((job.url || '').includes('greenhouse.io'))  return 'greenhouse';
  if ((job.url || '').includes('lever.co'))       return 'lever';
  if ((job.url || '').includes('ashbyhq.com'))    return 'ashby';
  return null;
}

/**
 * Check if a company is in the blocklist (case-insensitive substring match).
 */
function isBlocked(job, blocklist) {
  if (!blocklist || !blocklist.length) return false;
  const company = (job.company || '').toLowerCase();
  return blocklist.some(b => company.includes(b.toLowerCase()));
}

function isBlockedPlatform(platform, platformBlocklist) {
  if (!platform || !platformBlocklist || !platformBlocklist.length) return false;
  return platformBlocklist.map((value) => String(value).toLowerCase()).includes(String(platform).toLowerCase());
}

async function refreshJobReadiness(db, job) {
  if (!job) return job;
  const needsClassification = !job.apply_complexity || !detectPlatform(job);
  if (!needsClassification) return job;

  await classifyComplexity([job], db);
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id) || job;
}

async function applyWithPlatform(job, applicant, platform, dryRun) {
  let prep = null;
  if (platform === 'greenhouse' || platform === 'ashby') {
    try {
      const { getDb } = require('./db');
      prep = await prepareApplication(getDb(), job, { force: true, extractQuestions: true });
    } catch (error) {
      log.warn('Application prep failed before submit', { jobId: job.id, platform, error: error.message });
    }
  }

  if (platform === 'greenhouse') {
    return applyGreenhouse(job, applicant, dryRun, prep?.answers || {});
  }
  if (platform === 'lever') {
    return applyLever(job, applicant, dryRun);
  }
  return applyAshby(job, applicant, dryRun, prep?.answers || {}, prep?.questions || []);
}

/**
 * Run the auto-applier.
 * Queries eligible jobs and submits applications via Greenhouse or Lever APIs.
 *
 * @param {object} db      - better-sqlite3 DB instance
 * @param {object} config  - auto-apply-config.js export
 * @param {boolean} dryRun - log what would happen without actually posting
 */
async function run(db, config, dryRun = false) {
  if (!config.enabled && !dryRun) {
    log.info('Auto-apply disabled (AUTO_APPLY_ENABLED=false)');
    return;
  }

  const { dailyLimit, applicant, blocklist, platformBlocklist } = config;

  // Successful auto-applies already submitted today count toward the daily limit.
  const appliedToday = countSuccessfulApplicationsToday(db);

  const remaining = dailyLimit - appliedToday;
  if (remaining <= 0) {
    log.info('Daily auto-apply limit reached', { limit: dailyLimit });
    return;
  }

  // Query the full eligible pool. The daily limit is a success target, not a
  // cap on how many candidates we inspect.
  const eligible = db.prepare(`
    SELECT * FROM jobs
    WHERE status = 'pending'
      AND auto_applied_at IS NULL
      AND COALESCE(auto_apply_status, '') != 'success'
    ORDER BY COALESCE(score, 0) DESC, created_at ASC
  `).all();

  if (!eligible.length) {
    log.info('No eligible jobs for auto-apply', { remaining });
    return;
  }

  log.info('Starting auto-apply run', {
    eligible: eligible.length,
    dailyLimit,
    appliedToday,
    remaining,
    dryRun,
  });

  const updateJob = db.prepare(`
    UPDATE jobs
    SET auto_applied_at   = ?,
        auto_apply_status = ?,
        auto_apply_error  = ?,
        status            = CASE WHEN ? = 'success' THEN 'applied' ELSE status END,
        applied_at        = CASE WHEN ? = 'success' AND applied_at IS NULL THEN ? ELSE applied_at END,
        stage             = CASE WHEN ? = 'success' THEN 'applied' ELSE stage END,
        updated_at        = datetime('now')
    WHERE id = ?
  `);

  const insertLog = db.prepare(`
    INSERT INTO auto_apply_log (job_id, attempted_at, status, error, resume_filename, security_code, dry_run)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const results = { success: 0, failed: 0, skipped: 0 };

  for (const baseJob of eligible) {
    if (results.success >= remaining) {
      break;
    }

    const job = await refreshJobReadiness(db, baseJob);
    const platform = detectPlatform(job);

    if (!SUPPORTED_PLATFORMS.has(platform)) {
      log.info('Skipping: unsupported platform', { id: job.id, platform: job.platform });
      results.skipped++;
      continue;
    }

    if (isBlocked(job, blocklist)) {
      log.info('Skipping: company on blocklist', { company: job.company });
      results.skipped++;
      continue;
    }

    if (isBlockedPlatform(platform, platformBlocklist)) {
      log.info('Skipping: platform on blocklist', { company: job.company, title: job.title, platform });
      results.skipped++;
      continue;
    }

    if (job.apply_complexity === 'complex') {
      log.info('Skipping: complex application form', { company: job.company, title: job.title, platform });
      results.skipped++;
      continue;
    }

    // Pick the right resume for this job (AI vs standard)
    const resumePath = pickResume(job, baseDir);
    const jobApplicant = { ...applicant, resumePath };

    log.info('Applying', { company: job.company, title: job.title, score: job.score, platform, resume: resumePath, dryRun });

    let result;
    try {
      result = await applyWithPlatform(job, jobApplicant, platform, dryRun);
    } catch (e) {
      result = { success: false, error: e.message };
    }

    const now = new Date().toISOString();
    const status = result.success ? 'success' : 'failed';

    if (!dryRun) {
      updateJob.run(
        now, status, result.error || null,
        status, status, now, status,
        job.id
      );

      if (result.success) {
        logEvent(db, job.id, 'auto_applied', null, platform);
      }
    }

    insertLog.run(
      job.id,
      now,
      status,
      result.error || null,
      path.basename(jobApplicant.resumePath),
      result.securityCode || null,
      dryRun ? 1 : 0
    );

    if (result.success) {
      results.success++;
      log.info('Auto-apply succeeded', { company: job.company, title: job.title });
    } else {
      results.failed++;
      log.warn('Auto-apply failed', { company: job.company, title: job.title, error: result.error });
      if (result.haltRun) {
        log.error('Halting auto-apply run due to abuse warning', { company: job.company, title: job.title });
        break;
      }
    }
  }

  log.info('Auto-apply run complete', results);
}

/**
 * Apply to a single specific job by ID.
 * Returns { success, error?, securityCode? }
 */
async function applyOne(db, config, jobId, dryRun = false) {
  let job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: 'job not found' };
  if (job.status !== 'pending') return { success: false, error: `job is not pending (${job.status})` };
  if (job.auto_apply_status === 'success') return { success: false, error: 'already applied' };

  job = await refreshJobReadiness(db, job);
  const { applicant } = config;
  const platform = detectPlatform(job);

  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return { success: false, error: `unsupported platform: ${platform || 'unknown'}` };
  }

  const resumePath = pickResume(job, baseDir);
  const jobApplicant = { ...applicant, resumePath };

  log.info('Applying (manual trigger)', { company: job.company, title: job.title, platform, dryRun });

  let result;
  try {
    result = await applyWithPlatform(job, jobApplicant, platform, dryRun);
  } catch (e) {
    result = { success: false, error: e.message };
  }

  const now = new Date().toISOString();
  const status = result.success ? 'success' : 'failed';

  if (!dryRun) {
    db.prepare(`
      UPDATE jobs
      SET auto_applied_at   = ?,
          auto_apply_status = ?,
          auto_apply_error  = ?,
          status            = CASE WHEN ? = 'success' THEN 'applied' ELSE status END,
          applied_at        = CASE WHEN ? = 'success' AND applied_at IS NULL THEN ? ELSE applied_at END,
          stage             = CASE WHEN ? = 'success' THEN 'applied' ELSE stage END,
          updated_at        = datetime('now')
      WHERE id = ?
    `).run(now, status, result.error || null, status, status, now, status, job.id);

    if (result.success) {
      logEvent(db, job.id, 'auto_applied', null, platform);
    }
  }

  db.prepare(`
    INSERT INTO auto_apply_log (job_id, attempted_at, status, error, resume_filename, security_code, dry_run)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(job.id, now, status, result.error || null, path.basename(jobApplicant.resumePath), result.securityCode || null, dryRun ? 1 : 0);

  log.info('applyOne result', { company: job.company, status, error: result.error });
  return result;
}

module.exports = { run, applyOne, countSuccessfulApplicationsToday, isBlockedPlatform, refreshJobReadiness };
