'use strict';

const { logEvent } = require('./db');
const logPaths = require('./log-paths');
const log = require('./logger')('rejection-email-sync', { logFile: logPaths.persistent('rejection-sync') });
const {
  decodeQuotedPrintable,
  getReadableEmailText,
  isRejectionEmail,
  parseMatchableUrl,
} = require('./email/parser');
const { matchRejectionEmail } = require('./email/matcher');
const {
  DEFAULT_MAILBOX,
  TRASH_MAILBOX,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MAX_MESSAGES,
  fetchMailboxMessages,
} = require('./email/imap-client');

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10 * 1000;

function ensureSyncMetadata(db, prefix = 'rejection_email') {
  return {
    lastUid: db.prepare(`SELECT value FROM metadata WHERE key = '${prefix}_last_uid'`).get()?.value || null,
    uidValidity: db.prepare(`SELECT value FROM metadata WHERE key = '${prefix}_uid_validity'`).get()?.value || null,
  };
}

function saveSyncMetadata(db, { lastUid, uidValidity }, prefix = 'rejection_email') {
  if (lastUid != null) {
    db.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('${prefix}_last_uid', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(String(lastUid));
  }

  if (uidValidity != null) {
    db.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('${prefix}_uid_validity', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(String(uidValidity));
  }
}

function logCandidateEmail(db, mailbox, uidValidity, message, match, status, reason) {
  db.prepare(`
    INSERT OR IGNORE INTO rejection_email_log (
      mailbox,
      uid_validity,
      uid,
      message_id,
      received_at,
      from_address,
      subject,
      company_hint,
      title_hint,
      matched_job_id,
      match_confidence,
      match_status,
      reason,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    mailbox,
    uidValidity,
    message.uid,
    message.messageId || null,
    message.receivedAt || null,
    message.fromAddress || null,
    message.subject || null,
    match?.job?.company || null,
    match?.job?.title || null,
    match?.job?.id || null,
    match?.confidence || null,
    status,
    reason || match?.reason || null
  );
}

function applyRejectionUpdate(db, message, match, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const current = db.prepare(`
    SELECT id, stage, status, applied_at
    FROM jobs
    WHERE id = ?
  `).get(match.job.id);

  if (!current) return { status: 'unmatched', reason: 'job_missing' };
  if (current.stage === 'rejected') return { status: 'ignored', reason: 'already_rejected' };
  if (!current.applied_at) return { status: 'ignored', reason: 'job_not_applied' };

  if (dryRun) return { status: 'dry_run', reason: match.reason };

  const fromStage = current.stage || 'applied';

  db.transaction(() => {
    db.prepare(`
      UPDATE jobs
      SET status = 'rejected',
          stage = 'rejected',
          rejected_from_stage = ?,
          rejected_at = COALESCE(rejected_at, ?),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(fromStage, message.receivedAt || new Date().toISOString(), current.id);

    logEvent(db, current.id, 'stage_change', fromStage, 'rejected');
  })();

  return { status: 'applied', reason: match.reason };
}

async function sweepMailbox(db, mailbox, metadataPrefix, options) {
  const fetchMessages = options.fetchMessages || fetchMailboxMessages;
  const state = ensureSyncMetadata(db, metadataPrefix);
  const result = await fetchMessages({
    mailbox,
    lookbackDays: options.lookbackDays || DEFAULT_LOOKBACK_DAYS,
    maxMessages: options.maxMessages || DEFAULT_MAX_MESSAGES,
    lastUid: state.lastUid,
    uidValidity: state.uidValidity,
  });

  const summary = { fetched: result.messages.length, candidates: 0, applied: 0, dryRun: 0, ignored: 0, unmatched: 0 };

  for (const message of result.messages) {
    if (!isRejectionEmail(message)) continue;
    summary.candidates += 1;

    const match = matchRejectionEmail(db, message);
    if (!match.job) {
      summary.unmatched += 1;
      logCandidateEmail(db, mailbox, result.uidValidity, message, match, 'unmatched', match.reason);
      continue;
    }

    const applied = applyRejectionUpdate(db, message, match, { dryRun: options.dryRun });
    if (applied.status === 'applied') summary.applied += 1;
    else if (applied.status === 'dry_run') summary.dryRun += 1;
    else if (applied.status === 'ignored') summary.ignored += 1;
    else summary.unmatched += 1;

    logCandidateEmail(db, mailbox, result.uidValidity, message, match, applied.status, applied.reason);
  }

  saveSyncMetadata(db, { lastUid: result.lastUid, uidValidity: result.uidValidity }, metadataPrefix);
  return summary;
}

async function syncRejectionEmails(db, options = {}) {
  const mailbox = options.mailbox || DEFAULT_MAILBOX;
  const main = await sweepMailbox(db, mailbox, 'rejection_email', options);

  const trash = options.skipTrash
    ? { fetched: 0, candidates: 0, applied: 0, dryRun: 0, ignored: 0, unmatched: 0 }
    : await sweepMailbox(db, TRASH_MAILBOX, 'rejection_email_trash', options);

  return {
    fetched: main.fetched + trash.fetched,
    candidates: main.candidates + trash.candidates,
    applied: main.applied + trash.applied,
    dryRun: main.dryRun + trash.dryRun,
    ignored: main.ignored + trash.ignored,
    unmatched: main.unmatched + trash.unmatched,
  };
}

function startRejectionEmailPoller(db, options = {}) {
  const disabled = String(process.env.REJECTION_EMAIL_SYNC_DISABLED || '').toLowerCase() === 'true';
  if (disabled) {
    log.info('Rejection email sync disabled');
    return { stop() {} };
  }

  if (!process.env.GMAIL_EMAIL || !process.env.GMAIL_APP_PASSWORD) {
    log.info('Rejection email sync not started, missing Gmail credentials');
    return { stop() {} };
  }

  const pollIntervalMs = Number(process.env.REJECTION_EMAIL_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS;
  const initialDelayMs = Number(process.env.REJECTION_EMAIL_INITIAL_DELAY_MS) || DEFAULT_INITIAL_DELAY_MS;
  let timer = null;
  let running = false;
  let stopped = false;

  const runOnce = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const summary = await syncRejectionEmails(db, options);
      if (summary.candidates || summary.fetched) {
        log.info('Rejection email sync complete', summary);
      }
    } catch (error) {
      log.warn('Rejection email sync failed', { error: error.message });
    } finally {
      running = false;
    }
  };

  timer = setInterval(runOnce, pollIntervalMs);
  setTimeout(runOnce, initialDelayMs);

  log.info('Rejection email sync started', { pollIntervalMs });

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  decodeQuotedPrintable,
  getReadableEmailText,
  isRejectionEmail,
  matchRejectionEmail,
  parseMatchableUrl,
  startRejectionEmailPoller,
  syncRejectionEmails,
};
