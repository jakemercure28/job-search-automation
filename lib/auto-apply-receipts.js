'use strict';

const fs = require('fs');
const path = require('path');

const { getApplicationPrep } = require('./application-prep');

function nowIso() {
  return new Date().toISOString();
}

function createRunId(prefix = 'run') {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

function classifyAutoApplyFailure(error, result = {}) {
  const text = String(error || result.error || '').toLowerCase();
  if (!text) return null;
  if (result.haltRun || /abuse|spam|suspicious activity|too many (requests|attempts)|temporarily blocked|automated activity|unusual activity/.test(text)) return 'abuse-warning';
  if (/already submitted|already applied|already been submitted|duplicate/.test(text)) return 'duplicate';
  if (/required fields still empty|resume file input not found|submit button not found|unsupported platform|cannot parse/.test(text)) return 'validation';
  if (/unsupported platform for prep automation|unsupported platform/.test(text)) return 'unsupported-field';
  if (/no success confirmation|confirmation email|security code/.test(text)) return 'confirmation-missing';
  if (/timeout|navigation|networkidle|net::|failed to fetch|econn|socket hang up/.test(text)) return 'navigation';
  if (/rate limit|rate-limited|429/.test(text)) return 'rate-limited';
  return 'unknown';
}

function buildDisplayError(error, failureClass) {
  if (!error) return null;
  const compact = String(error).replace(/\s+/g, ' ').trim();
  if (compact.length <= 120) return compact;
  const prefix = failureClass ? `[${failureClass}] ` : '';
  return `${prefix}${compact.slice(0, 117 - prefix.length)}...`;
}

function safeFileStats(filePath) {
  if (!filePath) return null;
  try {
    return fs.statSync(filePath);
  } catch (_) {
    return null;
  }
}

function normalizeAttemptRow(row) {
  if (!row) return null;
  return {
    ...row,
    dry_run: Number(row.dry_run || 0),
    attempt_id: row.id,
    artifact_links: {
      resume: row.resume_path ? `/auto-apply-artifact?attemptId=${encodeURIComponent(String(row.id))}&type=resume` : null,
      pre: row.pre_image_path ? `/auto-apply-artifact?attemptId=${encodeURIComponent(String(row.id))}&type=pre` : null,
      post: row.post_image_path ? `/auto-apply-artifact?attemptId=${encodeURIComponent(String(row.id))}&type=post` : null,
    },
  };
}

function recordAutoApplyAttempt(db, {
  job,
  result,
  applicant,
  dryRun = false,
  runId = null,
  mode = 'submit',
  actor = 'manual',
  attemptedAt = nowIso(),
  platform = null,
}) {
  const status = result?.status || (result?.success ? 'success' : 'failed');
  const prep = job ? getApplicationPrep(db, job.id) : null;
  const failureClass = status === 'failed' ? classifyAutoApplyFailure(result?.error, result) : null;
  const displayError = buildDisplayError(result?.error, failureClass);
  const resumePath = applicant?.resumePath || null;
  const resumeFilename = result?.resumeFilename || (resumePath ? path.basename(resumePath) : null);
  const preImagePath = result?.preImagePath || result?.incompleteImagePath || null;
  const postImagePath = result?.postImagePath || null;

  const insert = db.prepare(`
    INSERT INTO auto_apply_log (
      job_id, attempted_at, status, error, resume_filename, security_code, dry_run,
      run_id, mode, platform, failure_class, pre_image_path, post_image_path,
      resume_path, prep_generated_at, actor, display_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = insert.run(
    job.id,
    attemptedAt,
    status,
    result?.error || null,
    resumeFilename,
    result?.securityCode || null,
    dryRun ? 1 : 0,
    runId,
    mode,
    platform,
    failureClass,
    preImagePath,
    postImagePath,
    resumePath,
    prep?.generated_at || null,
    actor,
    displayError
  );

  return normalizeAttemptRow(db.prepare(`
    SELECT l.*, j.company, j.title, j.score
    FROM auto_apply_log l
    JOIN jobs j ON j.id = l.job_id
    WHERE l.id = ?
  `).get(info.lastInsertRowid));
}

function insertAutoApplyRun(db, {
  id = createRunId(),
  startedAt = nowIso(),
  actor = 'manual',
  mode = 'submit',
  dryRun = false,
  filters = null,
} = {}) {
  db.prepare(`
    INSERT INTO auto_apply_runs (id, started_at, actor, mode, dry_run, filters_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    startedAt,
    actor,
    mode,
    dryRun ? 1 : 0,
    filters ? JSON.stringify(filters) : null
  );
  return id;
}

function finishAutoApplyRun(db, runId, summary = {}, completedAt = nowIso()) {
  if (!runId) return;
  db.prepare(`
    UPDATE auto_apply_runs
    SET completed_at = ?,
        summary_json = ?
    WHERE id = ?
  `).run(completedAt, JSON.stringify(summary || {}), runId);
}

function getAutoApplyAttemptById(db, id) {
  return normalizeAttemptRow(db.prepare(`
    SELECT
      l.*,
      j.company,
      j.title,
      j.score,
      j.url,
      r.started_at AS run_started_at,
      r.completed_at AS run_completed_at
    FROM auto_apply_log l
    JOIN jobs j ON j.id = l.job_id
    LEFT JOIN auto_apply_runs r ON r.id = l.run_id
    WHERE l.id = ?
  `).get(id));
}

function listAutoApplyAttempts(db, {
  limit = 200,
  status = null,
  platform = null,
  mode = null,
  minScore = null,
  maxScore = null,
  days = null,
  actor = null,
  jobId = null,
} = {}) {
  let rows = db.prepare(`
    SELECT l.*, j.company, j.title, j.score, j.url
    FROM auto_apply_log l
    JOIN jobs j ON j.id = l.job_id
    ORDER BY l.attempted_at DESC, l.id DESC
    LIMIT 500
  `).all().map(normalizeAttemptRow);

  if (jobId) rows = rows.filter((row) => row.job_id === jobId);
  if (status) rows = rows.filter((row) => row.status === status);
  if (platform) rows = rows.filter((row) => String(row.platform || '').toLowerCase() === String(platform).toLowerCase());
  if (mode) {
    if (mode === 'real') rows = rows.filter((row) => !row.dry_run);
    else if (mode === 'dry-run') rows = rows.filter((row) => row.dry_run);
    else rows = rows.filter((row) => String(row.mode || '').toLowerCase() === String(mode).toLowerCase());
  }
  if (actor) rows = rows.filter((row) => String(row.actor || '').toLowerCase() === String(actor).toLowerCase());
  if (Number.isInteger(minScore)) rows = rows.filter((row) => Number(row.score || 0) >= minScore);
  if (Number.isInteger(maxScore)) rows = rows.filter((row) => Number(row.score || 0) <= maxScore);
  if (Number.isInteger(days) && days > 0) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    rows = rows.filter((row) => new Date(row.attempted_at).getTime() >= cutoff);
  }

  return rows.slice(0, limit);
}

function summarizeAutoApplyAttempts(rows) {
  const summary = {
    total: rows.length,
    submitted: 0,
    prepared: 0,
    failed: 0,
    dryRun: 0,
    retryNeeded: 0,
  };

  for (const row of rows) {
    if (row.dry_run) summary.dryRun += 1;
    if (row.status === 'success') summary.submitted += 1;
    else if (row.status === 'prepared') summary.prepared += 1;
    else if (row.status === 'failed') {
      summary.failed += 1;
      if (row.failure_class !== 'duplicate' && row.failure_class !== 'abuse-warning') summary.retryNeeded += 1;
    }
  }

  return summary;
}

function resolveAttemptArtifactPath(attempt, type) {
  if (!attempt) return null;
  const artifactPath = type === 'resume'
    ? attempt.resume_path
    : type === 'post'
      ? attempt.post_image_path
      : attempt.pre_image_path;
  if (!artifactPath) return null;
  const stats = safeFileStats(artifactPath);
  return stats?.isFile() ? artifactPath : null;
}

module.exports = {
  buildDisplayError,
  classifyAutoApplyFailure,
  createRunId,
  finishAutoApplyRun,
  getAutoApplyAttemptById,
  insertAutoApplyRun,
  listAutoApplyAttempts,
  normalizeAttemptRow,
  nowIso,
  recordAutoApplyAttempt,
  resolveAttemptArtifactPath,
  summarizeAutoApplyAttempts,
};
