'use strict';

const Database = require('better-sqlite3');

const { dbPath } = require('../config/paths');
const { applyBaseSchema, applyMigrations } = require('./db/schema');
const log = require('./logger')('db');

let _db = null;

function getDb() {
  if (_db) return _db;

  log.info('DB init', { path: dbPath });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('cache_size = -8000');
  _db.pragma('temp_store = MEMORY');

  applyBaseSchema(_db);
  applyMigrations(_db);

  return _db;
}

function logEvent(db, jobId, eventType, fromValue, toValue) {
  db.prepare("INSERT INTO events (job_id, event_type, from_value, to_value) VALUES (?, ?, ?, ?)")
    .run(jobId, eventType, fromValue || null, toValue || null);
}

// ---------------------------------------------------------------------------
// Named query functions
// ---------------------------------------------------------------------------

function getJobById(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
}

function getExistingJobKeys(db) {
  return new Set(
    db.prepare("SELECT LOWER(TRIM(title)) || '|||' || LOWER(TRIM(company)) FROM jobs").pluck().all()
  );
}

function insertJob(db, j) {
  const result = db.prepare(
    `INSERT OR IGNORE INTO jobs (id, title, company, url, platform, location, posted_at, description, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(j.id, j.title, j.company, j.url, j.platform, j.location || '', j.postedAt || '', j.description || '', 'pending');
  // Patch location on existing rows that were stored with an empty value
  if (j.location) {
    db.prepare(
      `UPDATE jobs SET location=? WHERE id=? AND (location='' OR location IS NULL)`
    ).run(j.location, j.id);
  }
  return result.changes > 0;
}

const JOB_STATE_COLUMNS = [
  'score',
  'reasoning',
  'outreach',
  'status',
  'first_seen_at',
  'applied_at',
  'stage',
  'notes',
  'reached_out_at',
  'interview_notes',
  'apply_complexity',
  'rejected_from_stage',
  'rejected_at',
  'claude_score',
  'claude_reasoning',
  'rejection_reasoning',
  'auto_applied_at',
  'auto_apply_status',
  'auto_apply_error',
  'score_attempts',
  'last_score_attempt_at',
  'score_error',
];

function blank(value) {
  return value == null || value === '';
}

function preferredStatus(currentStatus, alternateStatus) {
  const rank = {
    pending: 1,
    archived: 2,
    closed: 3,
    rejected: 4,
    responded: 5,
    applied: 6,
  };
  const current = currentStatus || 'pending';
  const alternate = alternateStatus || 'pending';
  if (alternate === 'archived' && current !== 'archived') return current;
  return (rank[alternate] || 1) > (rank[current] || 1) ? alternate : current;
}

function earliestDate(left, right) {
  if (blank(left)) return right || null;
  if (blank(right)) return left || null;
  return Date.parse(right) < Date.parse(left) ? right : left;
}

function buildCanonicalInsertRow(job, inherited = {}) {
  return {
    id: job.id,
    title: job.title || inherited.title || '',
    company: job.company || inherited.company || '',
    url: job.url || inherited.url || '',
    platform: job.platform || inherited.platform || '',
    location: job.location || inherited.location || '',
    posted_at: job.postedAt || job.posted_at || inherited.posted_at || inherited.postedAt || '',
    description: job.description || inherited.description || '',
    status: inherited.status || 'pending',
    score: inherited.score ?? null,
    reasoning: inherited.reasoning || null,
    outreach: inherited.outreach || null,
    first_seen_at: inherited.first_seen_at || inherited.created_at || null,
    applied_at: inherited.applied_at || null,
    stage: inherited.stage || null,
    notes: inherited.notes || null,
    reached_out_at: inherited.reached_out_at || null,
    interview_notes: inherited.interview_notes || null,
    apply_complexity: inherited.apply_complexity || null,
    rejected_from_stage: inherited.rejected_from_stage || null,
    rejected_at: inherited.rejected_at || null,
    claude_score: inherited.claude_score ?? null,
    claude_reasoning: inherited.claude_reasoning || null,
    rejection_reasoning: inherited.rejection_reasoning || null,
    auto_applied_at: inherited.auto_applied_at || null,
    auto_apply_status: inherited.auto_apply_status || null,
    auto_apply_error: inherited.auto_apply_error || null,
    score_attempts: inherited.score_attempts ?? 0,
    last_score_attempt_at: inherited.last_score_attempt_at || null,
    score_error: inherited.score_error || null,
  };
}

function insertCanonicalJob(db, job, inherited = {}) {
  const row = buildCanonicalInsertRow(job, inherited);
  const columns = [
    'id', 'title', 'company', 'url', 'platform', 'location', 'posted_at', 'description',
    'status', ...JOB_STATE_COLUMNS.filter((column) => column !== 'status'),
  ];
  const placeholders = columns.map(() => '?').join(', ');
  const result = db.prepare(`
    INSERT OR IGNORE INTO jobs (${columns.join(', ')})
    VALUES (${placeholders})
  `).run(...columns.map((column) => row[column]));

  db.prepare(`
    UPDATE jobs
    SET title = COALESCE(NULLIF(title, ''), ?),
        company = COALESCE(NULLIF(company, ''), ?),
        url = COALESCE(NULLIF(url, ''), ?),
        platform = COALESCE(NULLIF(platform, ''), ?),
        location = COALESCE(NULLIF(location, ''), ?),
        posted_at = COALESCE(NULLIF(posted_at, ''), ?),
        description = COALESCE(NULLIF(description, ''), ?),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(row.title, row.company, row.url, row.platform, row.location, row.posted_at, row.description, row.id);

  return result.changes > 0;
}

function mergeAlternateState(db, alternate, canonicalId) {
  const canonical = getJobById(db, canonicalId);
  if (!canonical) return;

  const next = {};
  for (const column of JOB_STATE_COLUMNS) {
    if (column === 'status') {
      next.status = preferredStatus(canonical.status, alternate.status);
    } else if (column === 'first_seen_at') {
      next.first_seen_at = earliestDate(canonical.first_seen_at || canonical.created_at, alternate.first_seen_at || alternate.created_at);
    } else if (blank(canonical[column]) && !blank(alternate[column])) {
      next[column] = alternate[column];
    } else {
      next[column] = canonical[column] ?? null;
    }
  }

  db.prepare(`
    UPDATE jobs
    SET score = ?,
        reasoning = ?,
        outreach = ?,
        status = ?,
        first_seen_at = ?,
        applied_at = ?,
        stage = ?,
        notes = ?,
        reached_out_at = ?,
        interview_notes = ?,
        apply_complexity = ?,
        rejected_from_stage = ?,
        rejected_at = ?,
        claude_score = ?,
        claude_reasoning = ?,
        rejection_reasoning = ?,
        auto_applied_at = ?,
        auto_apply_status = ?,
        auto_apply_error = ?,
        score_attempts = ?,
        last_score_attempt_at = ?,
        score_error = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.score,
    next.reasoning,
    next.outreach,
    next.status,
    next.first_seen_at,
    next.applied_at,
    next.stage,
    next.notes,
    next.reached_out_at,
    next.interview_notes,
    next.apply_complexity,
    next.rejected_from_stage,
    next.rejected_at,
    next.claude_score,
    next.claude_reasoning,
    next.rejection_reasoning,
    next.auto_applied_at,
    next.auto_apply_status,
    next.auto_apply_error,
    next.score_attempts,
    next.last_score_attempt_at,
    next.score_error,
    canonicalId
  );
}

function moveSingleRowArtifact(db, tableName, alternateId, canonicalId) {
  const exists = db.prepare(`SELECT 1 FROM ${tableName} WHERE job_id = ?`).get(canonicalId);
  if (exists) return false;
  const result = db.prepare(`UPDATE ${tableName} SET job_id = ? WHERE job_id = ?`).run(canonicalId, alternateId);
  return result.changes > 0;
}

function rekeyDependentRows(db, alternateId, canonicalId) {
  db.prepare('UPDATE events SET job_id = ? WHERE job_id = ?').run(canonicalId, alternateId);
  db.prepare('UPDATE auto_apply_log SET job_id = ? WHERE job_id = ?').run(canonicalId, alternateId);
  db.prepare('UPDATE rejection_email_log SET matched_job_id = ? WHERE matched_job_id = ?').run(canonicalId, alternateId);

  const movedPreps = moveSingleRowArtifact(db, 'application_preps', alternateId, canonicalId);
  const movedResumes = moveSingleRowArtifact(db, 'tailored_resumes', alternateId, canonicalId);
  return { movedPreps, movedResumes };
}

function recordJobAlias(db, alternate, resolution, status, extraEvidence = {}) {
  const evidence = {
    ...(resolution.evidence || {}),
    ...extraEvidence,
  };
  db.prepare(`
    INSERT INTO job_aliases (
      alternate_job_id,
      canonical_job_id,
      original_platform,
      original_url,
      resolved_platform,
      resolved_url,
      status,
      confidence,
      evidence_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(alternate_job_id) DO UPDATE SET
      canonical_job_id = excluded.canonical_job_id,
      original_platform = excluded.original_platform,
      original_url = excluded.original_url,
      resolved_platform = excluded.resolved_platform,
      resolved_url = excluded.resolved_url,
      status = excluded.status,
      confidence = excluded.confidence,
      evidence_json = excluded.evidence_json,
      updated_at = datetime('now')
  `).run(
    alternate.id,
    resolution.job?.id || null,
    alternate.platform || null,
    alternate.url || null,
    resolution.platform || null,
    resolution.url || null,
    status,
    resolution.confidence || null,
    JSON.stringify(evidence)
  );
}

function archiveAlternateJob(db, alternateId) {
  db.prepare("UPDATE jobs SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(alternateId);
}

function canonicalizeAlternateJob(db, alternate, resolution) {
  if (!alternate?.id) throw new Error('canonicalizeAlternateJob requires an alternate row with id');

  if (resolution.status !== 'primary' || !resolution.job?.id) {
    recordJobAlias(db, alternate, resolution, resolution.status || 'unresolved');
    if (resolution.status === 'unsupported') {
      archiveAlternateJob(db, alternate.id);
      logEvent(db, alternate.id, 'ats_resolution', alternate.platform, 'unsupported');
      log.info('Job archived as unsupported', { alternateId: alternate.id, platform: alternate.platform });
    } else {
      log.debug('Job not canonicalized', { alternateId: alternate.id, status: resolution.status || 'unresolved' });
    }
    return { action: resolution.status || 'unresolved', canonicalId: null };
  }

  return db.transaction(() => {
    insertCanonicalJob(db, resolution.job, alternate);
    mergeAlternateState(db, alternate, resolution.job.id);
    const artifactMoves = rekeyDependentRows(db, alternate.id, resolution.job.id);
    recordJobAlias(db, alternate, resolution, 'primary', artifactMoves);
    archiveAlternateJob(db, alternate.id);
    logEvent(db, resolution.job.id, 'ats_resolution', alternate.platform, resolution.platform);
    log.info('Job canonicalized', {
      alternateId: alternate.id,
      canonicalId: resolution.job.id,
      from: alternate.platform,
      to: resolution.platform,
      movedPreps: artifactMoves.movedPreps,
      movedResumes: artifactMoves.movedResumes,
    });
    return { action: 'canonicalized', canonicalId: resolution.job.id, artifactMoves };
  })();
}

function getUnscoredJobs(db, { limit } = {}) {
  const rows = db.prepare(`
    SELECT *
    FROM jobs
    WHERE score IS NULL
      AND status = 'pending'
    ORDER BY
      CASE WHEN last_score_attempt_at IS NULL THEN 0 ELSE 1 END,
      last_score_attempt_at ASC,
      created_at ASC
  `).all();

  if (!Number.isInteger(limit) || limit <= 0) return rows;
  return rows.slice(0, limit);
}

function markJobScoreAttempt(db, id) {
  db.prepare(`
    UPDATE jobs
    SET score_attempts = COALESCE(score_attempts, 0) + 1,
        last_score_attempt_at = datetime('now'),
        score_error = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}

function markJobScoreFailure(db, id, error) {
  db.prepare(`
    UPDATE jobs
    SET score_error = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(error, id);
}

function updateJobScore(db, id, score, reasoning) {
  db.prepare(`
    UPDATE jobs
    SET score = ?,
        reasoning = ?,
        score_error = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(score, reasoning, id);
}

function getGlobalStats(db) {
  return {
    total: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status NOT IN ('archived','rejected','closed')").get().n,
    notApplied: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status NOT IN ('applied','responded','archived','closed','rejected') AND COALESCE(stage, '') NOT IN ('closed','rejected')").get().n,
    applied: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status IN ('applied','responded') AND stage != 'closed'").get().n,
    interviewing: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage IN ('phone_screen','interview','onsite','offer')").get().n,
    offers: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'offer'").get().n,
    rejected: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'rejected'").get().n,
    closed: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'closed'").get().n,
    archived: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status = 'archived'").get().n,
  };
}

function getAppliedByCompany(db) {
  const result = {};
  for (const row of db.prepare("SELECT LOWER(TRIM(company)) as co, COUNT(*) as n FROM jobs WHERE status IN ('applied','responded') GROUP BY co").all()) {
    result[row.co] = row.n;
  }
  return result;
}

module.exports = {
  getDb,
  logEvent,
  getJobById,
  getExistingJobKeys,
  insertJob,
  insertCanonicalJob,
  canonicalizeAlternateJob,
  recordJobAlias,
  getUnscoredJobs,
  markJobScoreAttempt,
  markJobScoreFailure,
  updateJobScore,
  getGlobalStats,
  getAppliedByCompany,
};
