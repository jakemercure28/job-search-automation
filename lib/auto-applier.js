'use strict';

const { logEvent } = require('./db');
const { prepareApplication } = require('./application-prep');
const { classifyComplexity } = require('./complexity');
const { applyGreenhouse } = require('./ats-appliers/greenhouse');
const { applyLever } = require('./ats-appliers/lever');
const { applyAshby } = require('./ats-appliers/ashby');
const { pickResume } = require('./apply/shared');
const {
  finishAutoApplyRun,
  insertAutoApplyRun,
  recordAutoApplyAttempt,
} = require('./auto-apply-receipts');
const log = require('./logger')('auto-apply');

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

function detectPlatform(job) {
  const p = (job.platform || '').toLowerCase();
  if (p.includes('greenhouse')) return 'greenhouse';
  if (p.includes('lever')) return 'lever';
  if (p.includes('ashby')) return 'ashby';
  if ((job.url || '').includes('greenhouse.io')) return 'greenhouse';
  if ((job.url || '').includes('lever.co')) return 'lever';
  if ((job.url || '').includes('ashbyhq.com')) return 'ashby';
  return null;
}

function isBlocked(job, blocklist) {
  if (!blocklist || !blocklist.length) return false;
  const company = (job.company || '').toLowerCase();
  return blocklist.some((b) => company.includes(String(b).toLowerCase()));
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

function buildApplicantForJob(job, applicant) {
  const resumePath = pickResume(job);
  return { ...applicant, resumePath };
}

async function applyWithPlatform(job, applicant, platform, dryRun) {
  let prep = null;
  try {
    const { getDb } = require('./db');
    prep = await prepareApplication(getDb(), job, { force: true, extractQuestions: true });
  } catch (error) {
    log.warn('Application prep failed before submit', { jobId: job.id, platform, error: error.message });
    return { success: false, error: `Manual review required: ${error.message}` };
  }

  if (!prep || prep.status !== 'ready') {
    return {
      success: false,
      error: `Manual review required: ${prep?.error || prep?.summary || 'prep not ready'}`,
    };
  }

  if (platform === 'greenhouse') {
    return applyGreenhouse(job, applicant, dryRun, prep?.answers || {});
  }
  if (platform === 'lever') {
    return applyLever(job, applicant, dryRun, prep?.answers || {}, prep?.questions || []);
  }
  return applyAshby(job, applicant, dryRun, prep?.answers || {}, prep?.questions || []);
}

function sortJobs(jobs, scoreOrder = 'desc') {
  const dir = scoreOrder === 'asc' ? 1 : -1;
  return [...jobs].sort((left, right) => {
    const leftScore = Number(left.score || 0);
    const rightScore = Number(right.score || 0);
    if (leftScore !== rightScore) return dir * (leftScore - rightScore);
    return String(left.created_at || '').localeCompare(String(right.created_at || ''));
  });
}

async function planAutoApply(db, config, options = {}) {
  const {
    jobId = null,
    retryFailed = false,
    minScore = null,
    maxScore = null,
    platforms = null,
    includeSkipped = false,
    scoreOrder = 'desc',
    refreshReadiness: shouldRefreshReadiness = false,
  } = options;
  const { blocklist, platformBlocklist } = config;

  let jobs;
  if (jobId) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    jobs = job ? [job] : [];
  } else if (retryFailed) {
    jobs = db.prepare(`
      SELECT j.*
      FROM jobs j
      LEFT JOIN (
        SELECT l.job_id, l.failure_class
        FROM auto_apply_log l
        INNER JOIN (
          SELECT job_id, MAX(id) AS max_id
          FROM auto_apply_log
          GROUP BY job_id
        ) latest ON latest.max_id = l.id
      ) attempts ON attempts.job_id = j.id
      WHERE COALESCE(j.auto_apply_status, '') = 'failed'
        AND j.status = 'pending'
        AND COALESCE(attempts.failure_class, '') NOT IN ('duplicate', 'abuse-warning', 'manual-review-needed', 'closed-page')
      ORDER BY COALESCE(score, 0) DESC, created_at ASC
    `).all();
  } else {
    jobs = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'pending'
        AND auto_applied_at IS NULL
        AND COALESCE(auto_apply_status, '') != 'success'
      ORDER BY COALESCE(score, 0) DESC, created_at ASC
    `).all();
  }

  const rows = [];
  for (const baseJob of sortJobs(jobs, scoreOrder)) {
    let job = baseJob;
    if (shouldRefreshReadiness || jobId) {
      job = await refreshJobReadiness(db, job);
    }
    const platform = detectPlatform(job);
    let skipReason = null;

    if (Number.isInteger(minScore) && Number(job.score || 0) < minScore) skipReason = 'below-min-score';
    if (!skipReason && Number.isInteger(maxScore) && Number(job.score || 0) > maxScore) skipReason = 'above-max-score';
    if (!skipReason && Array.isArray(platforms) && platforms.length > 0) {
      skipReason = platforms.map((value) => String(value).toLowerCase()).includes(String(platform || '').toLowerCase())
        ? null
        : 'platform-filtered';
    }
    if (!skipReason && !SUPPORTED_PLATFORMS.has(platform)) skipReason = 'unsupported-platform';
    if (!skipReason && isBlocked(job, blocklist)) skipReason = 'company-blocked';
    if (!skipReason && isBlockedPlatform(platform, platformBlocklist)) skipReason = 'platform-blocked';
    const row = {
      jobId: job.id,
      company: job.company,
      title: job.title,
      score: job.score,
      platform,
      applyComplexity: job.apply_complexity || null,
      canSubmit: !skipReason,
      skipReason,
      status: job.status,
    };
    if (!skipReason || includeSkipped) rows.push(row);
  }

  return rows;
}

function updateJobAutoApplyState(db, jobId, attemptedAt, status, error, failureClass = null) {
  db.prepare(`
    UPDATE jobs
    SET auto_applied_at   = ?,
        auto_apply_status = ?,
        auto_apply_error  = ?,
        status            = CASE
                              WHEN ? = 'success' THEN 'applied'
                              WHEN ? = 'closed-page' THEN 'closed'
                              ELSE status
                            END,
        applied_at        = CASE WHEN ? = 'success' AND applied_at IS NULL THEN ? ELSE applied_at END,
        stage             = CASE
                              WHEN ? = 'success' THEN 'applied'
                              WHEN ? = 'closed-page' THEN 'closed'
                              ELSE stage
                            END,
        updated_at        = datetime('now')
    WHERE id = ?
  `).run(attemptedAt, status, error || null, status, failureClass, status, attemptedAt, status, failureClass, jobId);
}

async function prepareOne(db, config, jobId, options = {}) {
  const {
    actor = 'manual',
    runId = null,
    force = false,
    dryRun = false,
  } = options;

  let job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: 'job not found' };

  job = await refreshJobReadiness(db, job);
  const platform = detectPlatform(job);
  const applicant = buildApplicantForJob(job, config.applicant);
  const prep = await prepareApplication(db, job, { force, extractQuestions: true });
  const result = prep?.status === 'ready'
    ? { success: true, status: 'prepared' }
    : { success: false, status: 'failed', error: prep?.error || prep?.page_issue || 'Preparation failed' };
  const receipt = recordAutoApplyAttempt(db, {
    job,
    result,
    applicant,
    dryRun,
    runId,
    mode: 'prepare',
    actor,
    platform,
  });
  return { ...result, prep, receipt };
}

async function applyOne(db, config, jobId, dryRun = false, options = {}) {
  const {
    actor = 'manual',
    runId = null,
    allowRetry = false,
  } = options;
  let job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: 'job not found' };
  if (!allowRetry && job.status !== 'pending') return { success: false, error: `job is not pending (${job.status})` };
  if (allowRetry && job.status !== 'pending') return { success: false, error: `job is not retryable because status is ${job.status}` };
  if (!allowRetry && job.auto_apply_status === 'success') return { success: false, error: 'already applied' };

  job = await refreshJobReadiness(db, job);
  const platform = detectPlatform(job);
  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return { success: false, error: `unsupported platform: ${platform || 'unknown'}` };
  }
  if (isBlocked(job, config.blocklist)) return { success: false, error: 'company is blocklisted' };
  if (isBlockedPlatform(platform, config.platformBlocklist)) return { success: false, error: `platform blocked: ${platform}` };
  const applicant = buildApplicantForJob(job, config.applicant);
  log.info('Applying', { company: job.company, title: job.title, platform, dryRun, actor });

  let result;
  try {
    result = await applyWithPlatform(job, applicant, platform, dryRun);
  } catch (error) {
    result = { success: false, error: error.message };
  }

  const attemptedAt = new Date().toISOString();
  const status = result.success ? 'success' : 'failed';
  if (!dryRun) {
    const failureClass = result.success ? null : require('./auto-apply-receipts').classifyAutoApplyFailure(result.error, result);
    updateJobAutoApplyState(db, job.id, attemptedAt, status, result.error || null, failureClass);
    if (result.success) {
      logEvent(db, job.id, 'auto_applied', null, platform);
    }
  }

  const receipt = recordAutoApplyAttempt(db, {
    job,
    result: { ...result, status },
    applicant,
    dryRun,
    runId,
    mode: 'submit',
    actor,
    attemptedAt,
    platform,
  });

  log.info('applyOne result', { company: job.company, status, error: result.error, attemptId: receipt?.attempt_id });
  return { ...result, status, receipt };
}

async function run(db, config, dryRun = false, options = {}) {
  const {
    actor = 'manual',
    mode = 'submit',
    scoreOrder = 'desc',
    minScore = null,
    maxScore = null,
    platforms = null,
    limit = null,
    retryFailed = false,
    runId: providedRunId = null,
  } = options;

  if (!config.enabled && !dryRun && mode === 'submit') {
    log.info('Auto-apply disabled (AUTO_APPLY_ENABLED=false)');
    return { success: 0, failed: 0, skipped: 0, prepared: 0, runId: null };
  }

  const dailyLimit = Number(config.dailyLimit || 0);
  const appliedToday = countSuccessfulApplicationsToday(db);
  let remaining = (dryRun || mode !== 'submit' || !dailyLimit) ? Number.POSITIVE_INFINITY : dailyLimit - appliedToday;
  if (!dryRun && mode === 'submit' && remaining <= 0) {
    log.info('Daily auto-apply limit reached', { limit: dailyLimit });
    return { success: 0, failed: 0, skipped: 0, prepared: 0, runId: null };
  }

  const filters = { scoreOrder, minScore, maxScore, platforms, limit, retryFailed };
  const runId = providedRunId || insertAutoApplyRun(db, { actor, mode, dryRun, filters });
  const candidates = await planAutoApply(db, config, {
    retryFailed,
    minScore,
    maxScore,
    platforms,
    includeSkipped: true,
    scoreOrder,
  });

  if (!candidates.length) {
    finishAutoApplyRun(db, runId, { success: 0, failed: 0, skipped: 0, prepared: 0, totalCandidates: 0 });
    log.info('No eligible jobs for auto-apply');
    return { success: 0, failed: 0, skipped: 0, prepared: 0, runId };
  }

  const results = { success: 0, failed: 0, skipped: 0, prepared: 0, runId, attempts: [] };
  let processed = 0;
  for (const candidate of candidates) {
    if (candidate.skipReason) {
      results.skipped += 1;
      continue;
    }
    if (Number.isInteger(limit) && limit > 0 && processed >= limit) break;
    if (mode === 'submit' && results.success >= remaining) break;

    processed += 1;
    let outcome;
    if (mode === 'prepare') {
      outcome = await prepareOne(db, config, candidate.jobId, { actor, runId, dryRun, force: true });
      if (outcome.success) results.prepared += 1;
      else results.failed += 1;
    } else {
      outcome = await applyOne(db, config, candidate.jobId, dryRun, { actor, runId, allowRetry: retryFailed });
      if (outcome.success) results.success += 1;
      else results.failed += 1;
    }

    results.attempts.push(outcome.receipt || outcome);
    if (outcome.haltRun) break;
  }

  finishAutoApplyRun(db, runId, {
    success: results.success,
    failed: results.failed,
    skipped: results.skipped,
    prepared: results.prepared,
    totalCandidates: candidates.length,
  });
  log.info('Auto-apply run complete', results);
  return results;
}

module.exports = {
  applyOne,
  countSuccessfulApplicationsToday,
  detectPlatform,
  isBlockedPlatform,
  planAutoApply,
  prepareOne,
  refreshJobReadiness,
  run,
};
