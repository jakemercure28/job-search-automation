'use strict';

const Database = require('better-sqlite3');

const { dbPath } = require('../config/paths');
const { applyBaseSchema, applyMigrations } = require('./db/schema');

let _db = null;

function getDb() {
  if (_db) return _db;

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
    total: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status != 'archived'").get().n,
    notApplied: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status NOT IN ('applied','responded','archived','closed') AND COALESCE(stage, '') != 'closed'").get().n,
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
  getUnscoredJobs,
  markJobScoreAttempt,
  markJobScoreFailure,
  updateJobScore,
  getGlobalStats,
  getAppliedByCompany,
};
