'use strict';

const { logEvent } = require('./db');
const { getApplicationPrep, prepareApplication } = require('./application-prep');
const { classifyComplexity } = require('./complexity');
const { applyGreenhouse } = require('./ats-appliers/greenhouse');
const { applyLever } = require('./ats-appliers/lever');
const { applyAshby } = require('./ats-appliers/ashby');
const { pickResume } = require('./apply/shared');
const applicantDefaults = require('../config/applicant');
const { recordAutoApplyAttempt } = require('./auto-apply-receipts');
const log = require('./logger')('apply-cli');

const SUPPORTED_PLATFORMS = new Set(['greenhouse', 'lever', 'ashby']);

function safeGetApplicationPrep(db, jobId) {
  try {
    return getApplicationPrep(db, jobId);
  } catch (_) {
    return null;
  }
}

function detectPlatform(job) {
  const platform = String(job?.platform || '').toLowerCase();
  const url = String(job?.url || '').toLowerCase();
  if (platform.includes('greenhouse') || url.includes('greenhouse.io')) return 'greenhouse';
  if (platform.includes('lever') || url.includes('lever.co')) return 'lever';
  if (platform.includes('ashby') || url.includes('ashbyhq.com')) return 'ashby';
  return null;
}

function isBlocked(job, blocklist) {
  if (!Array.isArray(blocklist) || !blocklist.length) return false;
  const company = String(job?.company || '').toLowerCase();
  return blocklist.some((entry) => company.includes(String(entry).toLowerCase()));
}

function isBlockedPlatform(platform, platformBlocklist) {
  if (!platform || !Array.isArray(platformBlocklist) || !platformBlocklist.length) return false;
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
  return {
    ...applicantDefaults,
    ...(applicant || {}),
    resumePath: pickResume(job),
  };
}

function extractPrepReview(prep) {
  const questions = Array.isArray(prep?.questions) ? prep.questions : [];
  const answers = prep?.answers || {};
  const unresolvedFields = questions.filter((field) => !Object.prototype.hasOwnProperty.call(answers, field.name));
  const lowConfidenceLabels = Array.isArray(prep?.voiceChecks?.lowConfidenceFields)
    ? prep.voiceChecks.lowConfidenceFields
    : [];
  const lowConfidenceFields = questions.filter((field) => lowConfidenceLabels.includes(field.label));
  return {
    questions,
    answers,
    unresolvedFields,
    lowConfidenceFields,
  };
}

function formatReviewFields(fields = []) {
  return fields.map((field) => ({
    label: field?.label || field?.name || 'Unknown field',
    name: field?.name || null,
    type: field?.type || null,
    required: Boolean(field?.required),
  }));
}

function formatAnswerValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value == null || value === '') return '—';
  return String(value);
}

function buildReviewPayload(job, prep, review = extractPrepReview(prep)) {
  const questions = Array.isArray(review.questions) ? review.questions : [];
  const answers = review.answers || {};
  const resolvedAnswers = questions
    .filter((field) => Object.prototype.hasOwnProperty.call(answers, field.name))
    .map((field) => ({
      label: field.label,
      name: field.name,
      value: formatAnswerValue(answers[field.name]),
    }));

  return {
    jobId: job?.id || null,
    company: job?.company || null,
    title: job?.title || null,
    score: job?.score ?? null,
    platform: detectPlatform(job),
    applyComplexity: job?.apply_complexity || null,
    prepStatus: prep?.status || null,
    workflow: prep?.workflow || null,
    summary: prep?.summary || null,
    applyUrl: prep?.apply_url || job?.url || null,
    resolvedAnswers,
    unresolvedFields: formatReviewFields(review.unresolvedFields),
    lowConfidenceFields: formatReviewFields(review.lowConfidenceFields),
    submitEligible: prep?.status === 'ready'
      && review.unresolvedFields.length === 0
      && review.lowConfidenceFields.length === 0,
  };
}

async function resolvePreparedApplication(db, job, { force = true } = {}) {
  const prep = await prepareApplication(db, job, { force, extractQuestions: true });
  const review = extractPrepReview(prep);
  return { prep, ...review };
}

async function applyWithPlatform(job, applicant, platform, { mode = 'submit', prep }) {
  const platformOptions = {
    mode,
    answers: prep.answers || {},
    questions: prep.questions || [],
    unresolvedFields: prep.unresolvedFields || [],
    lowConfidenceFields: prep.lowConfidenceFields || [],
    overrideApplyUrl: prep.applyUrl || null,
  };

  if (platform === 'greenhouse') return applyGreenhouse(job, applicant, platformOptions);
  if (platform === 'lever') return applyLever(job, applicant, platformOptions);
  return applyAshby(job, applicant, platformOptions);
}

function updateJobSubmitState(db, job, attemptedAt, status, error = null) {
  if (status === 'success') {
    db.prepare(`
      UPDATE jobs
      SET auto_applied_at   = ?,
          auto_apply_status = 'success',
          auto_apply_error  = NULL,
          status            = 'applied',
          applied_at        = CASE WHEN applied_at IS NULL THEN ? ELSE applied_at END,
          stage             = 'applied',
          updated_at        = datetime('now')
      WHERE id = ?
    `).run(attemptedAt, attemptedAt, job.id);
    logEvent(db, job.id, 'stage_change', job.stage || null, 'applied');
    return;
  }

  db.prepare(`
    UPDATE jobs
    SET auto_applied_at   = ?,
        auto_apply_status = 'failed',
        auto_apply_error  = ?,
        updated_at        = datetime('now')
    WHERE id = ?
  `).run(attemptedAt, error || null, job.id);
}

function mergeAttemptDetails(review, result, verification) {
  return {
    applyUrl: review.applyUrl,
    reviewSummary: review.summary || null,
    resolvedAnswers: review.resolvedAnswers,
    unresolvedFields: review.unresolvedFields,
    lowConfidenceFields: review.lowConfidenceFields,
    ...(result?.details || {}),
    verification,
  };
}

function createReceiptResult(success, review, result = {}, error = null) {
  const verification = {
    preSubmitScreenshot: result?.preImagePath || result?.incompleteImagePath || null,
    postSubmitScreenshot: result?.postImagePath || null,
    confirmationEmail: Boolean(success),
    securityCode: result?.securityCode || null,
  };

  return {
    ...result,
    success,
    status: success ? 'success' : 'failed',
    error: error || result?.error || null,
    details: mergeAttemptDetails(review, result, verification),
  };
}

async function prepareOne(db, config, jobId, options = {}) {
  const actor = String(options.actor || 'manual');
  let job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, status: 'failed', error: 'job not found' };

  job = await refreshJobReadiness(db, job);
  const platform = detectPlatform(job);
  const applicant = buildApplicantForJob(job, config?.applicant);

  const prepared = await resolvePreparedApplication(db, job, { force: options.force !== false });
  const review = buildReviewPayload(job, prepared.prep, prepared);

  const result = prepared.prep?.status === 'ready'
    ? {
        success: true,
        status: 'prepared',
        details: {
          applyUrl: review.applyUrl,
          resolvedAnswers: review.resolvedAnswers,
          unresolvedFields: review.unresolvedFields,
          lowConfidenceFields: review.lowConfidenceFields,
          reviewSummary: review.summary,
        },
      }
    : {
        success: false,
        status: 'failed',
        error: prepared.prep?.error || prepared.prep?.page_issue || 'Preparation failed',
        details: {
          applyUrl: review.applyUrl,
          unresolvedFields: review.unresolvedFields,
          lowConfidenceFields: review.lowConfidenceFields,
          reviewSummary: review.summary,
        },
      };

  const receipt = recordAutoApplyAttempt(db, {
    job,
    result,
    applicant,
    actor,
    mode: 'prepare',
    platform,
  });

  return { ...result, job, prep: prepared.prep, review, receipt };
}

async function submitOne(db, config, jobId, options = {}) {
  const actor = String(options.actor || 'manual');
  let job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, status: 'failed', error: 'job not found' };
  if (job.status !== 'pending') {
    return { success: false, status: 'failed', error: `job is not pending (${job.status})` };
  }

  job = await refreshJobReadiness(db, job);
  const platform = detectPlatform(job);
  if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
    return { success: false, status: 'failed', error: `unsupported platform: ${platform || 'unknown'}` };
  }
  if (isBlocked(job, config?.blocklist)) {
    return { success: false, status: 'failed', error: 'company is blocklisted' };
  }
  if (isBlockedPlatform(platform, config?.platformBlocklist)) {
    return { success: false, status: 'failed', error: `platform blocked: ${platform}` };
  }

  const prepared = await resolvePreparedApplication(db, job, { force: true });
  const review = buildReviewPayload(job, prepared.prep, prepared);
  const applicant = buildApplicantForJob(job, config?.applicant);

  if (prepared.prep?.status !== 'ready') {
    const failed = createReceiptResult(false, review, {}, prepared.prep?.error || prepared.prep?.page_issue || 'Preparation failed');
    const attemptedAt = new Date().toISOString();
    updateJobSubmitState(db, job, attemptedAt, 'failed', failed.error);
    const receipt = recordAutoApplyAttempt(db, {
      job,
      result: failed,
      applicant,
      actor,
      attemptedAt,
      mode: 'submit',
      platform,
    });
    return { ...failed, job, prep: prepared.prep, review, receipt };
  }

  if (!review.submitEligible) {
    const fieldLabels = [
      ...review.unresolvedFields.map((field) => field.label),
      ...review.lowConfidenceFields.map((field) => field.label),
    ];
    const failed = createReceiptResult(false, review, {}, `Manual review required before submit: ${fieldLabels.join(', ')}`);
    const attemptedAt = new Date().toISOString();
    updateJobSubmitState(db, job, attemptedAt, 'failed', failed.error);
    const receipt = recordAutoApplyAttempt(db, {
      job,
      result: failed,
      applicant,
      actor,
      attemptedAt,
      mode: 'submit',
      platform,
    });
    return { ...failed, job, prep: prepared.prep, review, receipt };
  }

  log.info('Submitting reviewed application', {
    company: job.company,
    title: job.title,
    platform,
    actor,
  });

  let result;
  try {
    result = await applyWithPlatform(job, applicant, platform, {
      mode: 'submit',
      prep: prepared,
    });
  } catch (error) {
    result = { success: false, error: error.message };
  }

  const attemptedAt = new Date().toISOString();
  const finalResult = createReceiptResult(Boolean(result?.success), review, result, result?.error || null);
  updateJobSubmitState(db, job, attemptedAt, finalResult.success ? 'success' : 'failed', finalResult.error);
  const receipt = recordAutoApplyAttempt(db, {
    job,
    result: finalResult,
    applicant,
    actor,
    attemptedAt,
    mode: 'submit',
    platform,
  });

  return { ...finalResult, job, prep: prepared.prep, review, receipt };
}

function findNextApplyJob(db, config = {}) {
  const jobs = db.prepare(`
    SELECT *
    FROM jobs
    WHERE status = 'pending'
    ORDER BY COALESCE(score, 0) DESC, created_at ASC
  `).all();

  return jobs.find((job) => {
    const platform = detectPlatform(job);
    return SUPPORTED_PLATFORMS.has(platform)
      && !isBlocked(job, config.blocklist)
      && !isBlockedPlatform(platform, config.platformBlocklist)
      && job.auto_apply_status !== 'success';
  }) || null;
}

module.exports = {
  applyOne: submitOne,
  applyWithPlatform,
  buildApplicantForJob,
  buildReviewPayload,
  detectPlatform,
  findNextApplyJob,
  formatReviewFields,
  isBlockedPlatform,
  prepareOne,
  refreshJobReadiness,
  submitOne,
};
