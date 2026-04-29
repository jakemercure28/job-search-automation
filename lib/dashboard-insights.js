'use strict';

function toLocalDateString(date = new Date()) {
  return date.toLocaleDateString('en-CA');
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getRelevantScrapeCount(db, dateStr = toLocalDateString()) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM jobs
    WHERE date(created_at, 'localtime') = ?
      AND status NOT IN ('archived', 'rejected', 'closed')
  `).get(dateStr).n;
}

function getScraperHealth(db, dateStr = toLocalDateString()) {
  return db.prepare(`
    SELECT platform, COUNT(*) AS count
    FROM jobs
    WHERE date(created_at, 'localtime') = ?
      AND status NOT IN ('archived', 'rejected', 'closed')
    GROUP BY platform
    ORDER BY count DESC, platform ASC
  `).all(dateStr);
}

function getTodayActivityCounts(db, dateStr = toLocalDateString()) {
  const countStageEvent = db.prepare(`
    SELECT COUNT(*) AS n
    FROM events
    WHERE event_type = 'stage_change'
      AND to_value = ?
      AND date(created_at, 'localtime') = ?
  `);

  const manualApplied = db.prepare(`
    SELECT COUNT(*) AS n
    FROM events e
    WHERE e.event_type = 'stage_change'
      AND e.to_value = 'applied'
      AND date(e.created_at, 'localtime') = ?
      AND NOT EXISTS (
        SELECT 1
        FROM auto_apply_log l
        WHERE l.job_id = e.job_id
          AND l.status = 'success'
          AND COALESCE(l.dry_run, 0) = 0
          AND date(l.attempted_at, 'localtime') = date(e.created_at, 'localtime')
      )
  `).get(dateStr).n;
  const rejected = countStageEvent.get('rejected', dateStr).n;
  const closed = countStageEvent.get('closed', dateStr).n;
  const autoApplied = db.prepare(`
    SELECT COUNT(*) AS n
    FROM auto_apply_log
    WHERE status = 'success'
      AND COALESCE(dry_run, 0) = 0
      AND date(attempted_at, 'localtime') = ?
  `).get(dateStr).n;

  return {
    todayApplied: manualApplied,
    todayAutoApplied: autoApplied,
    todayRejected: rejected,
    todayClosed: closed,
  };
}

function getLatestDailyActivity(db, dateStr = toLocalDateString()) {
  const queueAdds = db.prepare(`
    SELECT COUNT(*) AS count, MAX(created_at) AS ts
    FROM jobs
    WHERE date(created_at, 'localtime') = ?
      AND status NOT IN ('archived', 'rejected', 'closed')
  `).get(dateStr);

  const countStageEvent = db.prepare(`
    SELECT COUNT(*) AS count, MAX(created_at) AS ts
    FROM events
    WHERE event_type = 'stage_change'
      AND to_value = ?
      AND date(created_at, 'localtime') = ?
  `);

  const autoApplied = db.prepare(`
    SELECT COUNT(*) AS count, MAX(attempted_at) AS ts
    FROM auto_apply_log
    WHERE status = 'success'
      AND COALESCE(dry_run, 0) = 0
      AND date(attempted_at, 'localtime') = ?
  `).get(dateStr);

  const activities = [
    { type: 'new_jobs', ...queueAdds },
    { type: 'rejected', ...countStageEvent.get('rejected', dateStr) },
    { type: 'closed', ...countStageEvent.get('closed', dateStr) },
    { type: 'applied', ...countStageEvent.get('applied', dateStr) },
    { type: 'auto_applied', ...autoApplied },
  ].filter((activity) => activity.count && activity.ts);

  const precedence = {
    rejected: 5,
    closed: 4,
    auto_applied: 3,
    applied: 2,
    new_jobs: 1,
  };

  activities.sort((a, b) => {
    const tsDiff = new Date(b.ts).getTime() - new Date(a.ts).getTime();
    if (tsDiff !== 0) return tsDiff;
    return (precedence[b.type] || 0) - (precedence[a.type] || 0);
  });

  return activities[0] || null;
}

function describeDailyActivity(activity) {
  if (!activity || !activity.count) return '';

  switch (activity.type) {
    case 'rejected':
      return `${pluralize(activity.count, 'rejection')} recorded today.`;
    case 'closed':
      return `${pluralize(activity.count, 'job')} closed today.`;
    case 'auto_applied':
      return `${pluralize(activity.count, 'job')} auto-applied today.`;
    case 'applied':
      return `${pluralize(activity.count, 'job')} applied today.`;
    case 'new_jobs':
    default:
      return `${pluralize(activity.count, 'job')} added to your queue today.`;
  }
}

function buildDailyDigest(db, dateStr = toLocalDateString()) {
  const latest = getLatestDailyActivity(db, dateStr);
  if (!latest) return 'No queue activity yet today.';

  const queueAdds = getRelevantScrapeCount(db, dateStr);
  if (latest.type === 'new_jobs') {
    return describeDailyActivity(latest);
  }

  const latestSummary = describeDailyActivity(latest);
  if (!queueAdds) return `Latest update: ${latestSummary}`;

  return `Latest update: ${latestSummary} ${pluralize(queueAdds, 'job')} ${queueAdds === 1 ? 'was' : 'were'} added to your queue earlier today.`;
}

function getDailyManualApplyCounts(db, days = 7, now = new Date()) {
  const rows = [];
  const stmt = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM events e
    WHERE e.event_type = 'stage_change'
      AND e.to_value = 'applied'
      AND date(e.created_at, 'localtime') = ?
      AND NOT EXISTS (
        SELECT 1
        FROM auto_apply_log l
        WHERE l.job_id = e.job_id
          AND l.status = 'success'
          AND COALESCE(l.dry_run, 0) = 0
          AND date(l.attempted_at, 'localtime') = date(e.created_at, 'localtime')
      )
  `);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = toLocalDateString(date);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
    const row = stmt.get(dateStr);
    rows.push({ label: dayLabel, count: row ? row.cnt : 0 });
  }

  return rows;
}

function recordStatusSnapshot(db) {
  try {
    const recent = db.prepare(
      `SELECT id FROM status_snapshots WHERE recorded_at >= datetime('now','-30 minutes') LIMIT 1`
    ).get();
    if (recent) return;

    const pending = db.prepare(
      `SELECT COUNT(*) as n FROM jobs
       WHERE status NOT IN ('applied','responded','archived','closed','rejected')
         AND COALESCE(stage,'') NOT IN ('closed','rejected')`
    ).get().n;

    const interviewing = db.prepare(
      `SELECT COUNT(*) as n FROM jobs
       WHERE stage IN ('phone_screen','interview','onsite','offer')`
    ).get().n;

    const applied = db.prepare(
      `SELECT COUNT(*) as n FROM jobs
       WHERE status IN ('applied','responded')
         AND COALESCE(stage,'') NOT IN ('phone_screen','interview','onsite','offer','closed')`
    ).get().n;

    db.prepare(
      `INSERT INTO status_snapshots (pending, applied, interviewing) VALUES (?, ?, ?)`
    ).run(pending, applied, interviewing);
  } catch (e) { /* never crash the caller */ }
}

function getTrackerData(db, period = '30d') {
  const cutoffs = { '7d': 7, '30d': 30, '90d': 90 };
  const days = cutoffs[period];
  const where = days ? `WHERE recorded_at >= datetime('now', '-${days} days')` : '';
  return db.prepare(
    `SELECT recorded_at, pending, applied, interviewing FROM status_snapshots ${where} ORDER BY recorded_at ASC`
  ).all();
}

module.exports = {
  toLocalDateString,
  getRelevantScrapeCount,
  getScraperHealth,
  getTodayActivityCounts,
  getLatestDailyActivity,
  buildDailyDigest,
  getDailyManualApplyCounts,
  recordStatusSnapshot,
  getTrackerData,
};
