'use strict';

const { ImapFlow } = require('imapflow');

const { logEvent } = require('./db');
const log = require('./logger')('rejection-email-sync');
const { stripHtml } = require('./utils');

const DEFAULT_MAILBOX = 'INBOX';
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_MESSAGES = 75;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10 * 1000;

const REJECTION_PATTERNS = [
  /\bunfortunately\b/i,
  /\bnot moving forward\b/i,
  /\bwill not be moving forward\b/i,
  /\bwon'?t be moving forward\b/i,
  /\bdecided not to proceed\b/i,
  /\bnot proceed with your candidacy\b/i,
  /\bmove ahead with another candidate\b/i,
  /\bmove forward with other candidates\b/i,
  /\bbetter match for this (?:particular )?(?:position|role)\b/i,
  /\bposition has been filled\b/i,
  /\brole has been filled\b/i,
  /\bno longer under consideration\b/i,
  /\bnot selected\b/i,
  /\bwe will not be proceeding\b/i,
  /\bwe are unable to move forward\b/i,
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeCompact(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function decodeQuotedPrintable(input) {
  const normalized = Buffer.from(String(input || '').replace(/=\r?\n/g, ''), 'utf8')
    .toString('utf8')
    .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return normalized;
}

function extractLinks(text) {
  return Array.from(new Set(
    String(text || '')
      .match(/https?:\/\/[^\s"'<>]+/g) || []
  )).map((url) => url.replace(/[),.;]+$/, ''));
}

function hasTerm(text, term) {
  const spacedHaystack = ` ${normalizeText(text)} `;
  const spacedNeedle = ` ${normalizeText(term)} `;
  if (Boolean(spacedNeedle.trim()) && spacedHaystack.includes(spacedNeedle)) return true;

  const compactNeedle = normalizeCompact(term);
  if (compactNeedle.length < 7) return false;

  return normalizeCompact(text).includes(compactNeedle);
}

function getReadableEmailText(message) {
  const decodedRaw = decodeQuotedPrintable(message.raw || '');
  const stripped = stripHtml(decodedRaw, 50_000);
  return [message.subject, message.fromAddress, stripped].filter(Boolean).join('\n');
}

function isRejectionEmail(message) {
  const text = getReadableEmailText(message);
  return REJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

function parseMatchableUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    const result = {
      host,
      path: parts.join('/').toLowerCase(),
      jobId: null,
      slug: null,
      uuid: null,
    };

    if (host.includes('greenhouse')) {
      result.slug = parts[0] || null;
      const jobsIndex = parts.indexOf('jobs');
      result.jobId = parsed.searchParams.get('gh_jid') || (jobsIndex >= 0 ? parts[jobsIndex + 1] || null : null);
    } else if (host.includes('ashbyhq.com')) {
      result.slug = parts[0] || null;
      result.uuid = parts[1] || null;
    } else if (host.includes('lever.co')) {
      result.slug = parts[0] || null;
      result.uuid = parts[1] || null;
    } else if (host.includes('ats.rippling.com')) {
      result.slug = parts[0] || null;
      const jobsIndex = parts.indexOf('jobs');
      result.uuid = jobsIndex >= 0 ? parts[jobsIndex + 1] || null : null;
    }

    return result;
  } catch (_) {
    return null;
  }
}

function uniqueById(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function getActiveAppliedJobs(db) {
  return db.prepare(`
    SELECT id, company, title, url, stage, status, applied_at
    FROM jobs
    WHERE applied_at IS NOT NULL
      AND COALESCE(stage, '') NOT IN ('rejected', 'closed')
  `).all();
}

function matchByUrl(message, jobs) {
  const links = extractLinks(`${message.raw || ''}\n${message.subject || ''}`);
  if (!links.length) return null;

  const parsedLinks = links.map(parseMatchableUrl).filter(Boolean);
  if (!parsedLinks.length) return null;

  const candidates = jobs.filter((job) => {
    const parsedJobUrl = parseMatchableUrl(job.url);
    if (!parsedJobUrl) return false;

    return parsedLinks.some((link) => {
      if (parsedJobUrl.host !== link.host) return false;
      if (parsedJobUrl.jobId && link.jobId && parsedJobUrl.jobId === link.jobId) return true;
      if (parsedJobUrl.uuid && link.uuid && parsedJobUrl.uuid === link.uuid) return true;
      return parsedJobUrl.path && link.path && parsedJobUrl.path === link.path;
    });
  });

  if (candidates.length !== 1) return null;
  return {
    job: candidates[0],
    confidence: 'strong',
    reason: 'url_match',
  };
}

function matchByCompanyAndTitle(message, jobs) {
  const text = getReadableEmailText(message);
  const companies = new Map();

  for (const job of jobs) {
    if (!hasTerm(text, job.company)) continue;
    const key = normalizeText(job.company);
    const bucket = companies.get(key) || [];
    bucket.push(job);
    companies.set(key, bucket);
  }

  if (!companies.size) {
    return { job: null, confidence: 'none', reason: 'no_company_match' };
  }

  if (companies.size > 1) {
    return { job: null, confidence: 'none', reason: 'multiple_company_matches' };
  }

  const [companyJobs] = companies.values();
  if (companyJobs.length === 1) {
    return {
      job: companyJobs[0],
      confidence: 'medium',
      reason: 'single_active_company_job',
    };
  }

  const titleMatches = companyJobs.filter((job) => hasTerm(text, job.title));
  if (titleMatches.length === 1) {
    return {
      job: titleMatches[0],
      confidence: 'strong',
      reason: 'company_title_match',
    };
  }

  if (titleMatches.length > 1) {
    return { job: null, confidence: 'none', reason: 'multiple_title_matches' };
  }

  return { job: null, confidence: 'none', reason: 'ambiguous_company_match' };
}

function matchRejectionEmail(db, message) {
  const jobs = getActiveAppliedJobs(db);
  const urlMatch = matchByUrl(message, jobs);
  if (urlMatch) return urlMatch;
  return matchByCompanyAndTitle(message, jobs);
}

function ensureSyncMetadata(db) {
  return {
    lastUid: db.prepare("SELECT value FROM metadata WHERE key = 'rejection_email_last_uid'").get()?.value || null,
    uidValidity: db.prepare("SELECT value FROM metadata WHERE key = 'rejection_email_uid_validity'").get()?.value || null,
  };
}

function saveSyncMetadata(db, { lastUid, uidValidity }) {
  if (lastUid != null) {
    db.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('rejection_email_last_uid', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(String(lastUid));
  }

  if (uidValidity != null) {
    db.prepare(`
      INSERT INTO metadata (key, value, updated_at)
      VALUES ('rejection_email_uid_validity', ?, datetime('now'))
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
  if (current.stage === 'closed') return { status: 'ignored', reason: 'already_closed' };
  if (!current.applied_at) return { status: 'ignored', reason: 'job_not_applied' };

  if (dryRun) return { status: 'dry_run', reason: match.reason };

  const fromStage = current.stage || 'applied';

  db.transaction(() => {
    db.prepare(`
      UPDATE jobs
      SET status = 'archived',
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

async function fetchMailboxMessages({
  mailbox = DEFAULT_MAILBOX,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  maxMessages = DEFAULT_MAX_MESSAGES,
  lastUid = null,
  uidValidity = null,
} = {}) {
  const email = process.env.GMAIL_EMAIL;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!email || !password) throw new Error('GMAIL_EMAIL or GMAIL_APP_PASSWORD not set');

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });

  await client.connect();

  try {
    const mailboxInfo = await client.mailboxOpen(mailbox);
    const nextUidValidity = mailboxInfo.uidValidity || client.mailbox?.uidValidity || null;
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    let uids = await client.search({ since });
    if (uidValidity && nextUidValidity && String(uidValidity) === String(nextUidValidity) && lastUid != null) {
      uids = uids.filter((uid) => uid > Number(lastUid));
    }

    uids = uids.sort((left, right) => left - right).slice(-maxMessages);

    const messages = [];
    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { envelope: true, source: true });
      messages.push({
        uid,
        subject: msg.envelope?.subject || '',
        fromAddress: (msg.envelope?.from || []).map((person) => person.address || '').filter(Boolean).join(', '),
        messageId: msg.envelope?.messageId || null,
        receivedAt: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
        raw: msg.source.toString('utf8'),
      });
    }

    return {
      uidValidity: nextUidValidity,
      lastUid: uids.length ? uids[uids.length - 1] : lastUid,
      messages,
    };
  } finally {
    try { await client.logout(); } catch (_) {}
  }
}

async function syncRejectionEmails(db, options = {}) {
  const mailbox = options.mailbox || DEFAULT_MAILBOX;
  const fetchMessages = options.fetchMessages || fetchMailboxMessages;
  const state = ensureSyncMetadata(db);
  const result = await fetchMessages({
    mailbox,
    lookbackDays: options.lookbackDays || DEFAULT_LOOKBACK_DAYS,
    maxMessages: options.maxMessages || DEFAULT_MAX_MESSAGES,
    lastUid: state.lastUid,
    uidValidity: state.uidValidity,
  });

  const summary = {
    fetched: result.messages.length,
    candidates: 0,
    applied: 0,
    dryRun: 0,
    ignored: 0,
    unmatched: 0,
  };

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

  saveSyncMetadata(db, {
    lastUid: result.lastUid,
    uidValidity: result.uidValidity,
  });

  return summary;
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
