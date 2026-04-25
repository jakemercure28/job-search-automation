'use strict';

const { ImapFlow } = require('imapflow');
const log = require('./logger')('auto-apply');
const { stripHtml } = require('./utils');

const APPLICATION_CONFIRMATION_PATTERNS = [
  /thank you for applying/i,
  /application received/i,
  /received your application/i,
  /application (?:has been )?submitted/i,
  /we have received your application/i,
  /your application to .* has been received/i,
];

const REJECTION_PATTERNS = [
  /\bunfortunately\b/i,
  /\bnot moving forward\b/i,
  /\bwill not be moving forward\b/i,
  /\bwon'?t be moving forward\b/i,
  /\bdecided not to proceed\b/i,
  /\bmove ahead with another candidate\b/i,
  /\bmove forward with other candidates\b/i,
  /\bposition has been filled\b/i,
  /\brole has been filled\b/i,
  /\bno longer under consideration\b/i,
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasTerm(text, term) {
  const haystack = ` ${normalizeText(text)} `;
  const needle = ` ${normalizeText(term)} `;
  return Boolean(needle.trim()) && haystack.includes(needle);
}

function decodeQuotedPrintable(input) {
  return Buffer.from(String(input || '').replace(/=\r?\n/g, ''), 'utf8')
    .toString('utf8')
    .replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function getReadableEmailText(message) {
  const decodedRaw = decodeQuotedPrintable(message.raw || '');
  const stripped = stripHtml(decodedRaw, 50_000);
  return [message.subject, message.fromAddress, stripped].filter(Boolean).join('\n');
}

function isLikelyApplicationConfirmation(job, message) {
  const text = getReadableEmailText(message);
  if (REJECTION_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (!APPLICATION_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(text))) return false;

  const companyMatch = hasTerm(text, job.company);
  const titleMatch = hasTerm(text, job.title);
  const urlMatch = String(job.url || '')
    .split(/[/?#]/)
    .filter(Boolean)
    .some((part) => part.length >= 6 && hasTerm(text, part.replace(/[-_]+/g, ' ')));

  return companyMatch || titleMatch || urlMatch;
}

async function fetchRecentInboxMessages({ startedAt, limit = 20 } = {}) {
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
    await client.mailboxOpen('INBOX');
    const since = new Date(startedAt - 10 * 60 * 1000);
    let uids = await client.search({ since });
    uids = uids.slice(-limit);

    const messages = [];
    for (const uid of uids.reverse()) {
      const msg = await client.fetchOne(uid, { source: true, envelope: true });
      messages.push({
        uid,
        subject: msg.envelope?.subject || '',
        fromAddress: (msg.envelope?.from || []).map((person) => person.address || '').filter(Boolean).join(', '),
        receivedAt: msg.envelope?.date ? new Date(msg.envelope.date).getTime() : 0,
        raw: msg.source.toString(),
      });
    }
    return messages;
  } finally {
    try { await client.logout(); } catch {}
  }
}

async function waitForApplicationConfirmation(job, {
  startedAt = Date.now(),
  maxWaitMs = Number(process.env.AUTO_APPLY_CONFIRMATION_EMAIL_WAIT_MS) || 90000,
  pollMs = 5000,
} = {}) {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    try {
      const messages = await fetchRecentInboxMessages({ startedAt });
      const match = messages.find((message) => (
        message.receivedAt >= startedAt - 60000
        && isLikelyApplicationConfirmation(job, message)
      ));
      if (match) {
        log.info('Application confirmation email found', {
          company: job.company,
          title: job.title,
          subject: match.subject,
          fromAddress: match.fromAddress,
        });
        return match;
      }
    } catch (error) {
      log.warn('Application confirmation email check failed', { error: error.message });
    }
  }

  return null;
}

/**
 * Poll Gmail via IMAP for a Greenhouse security code email.
 * Waits up to maxWaitMs for the email to arrive, checking every 3 seconds.
 *
 * @returns {Promise<string|null>} 8-character code, or null if not found in time
 */
async function fetchGreenhouseCode(maxWaitMs = 45000) {
  const email = process.env.GMAIL_EMAIL;
  const password = process.env.GMAIL_APP_PASSWORD;
  if (!email || !password) throw new Error('GMAIL_EMAIL or GMAIL_APP_PASSWORD not set');

  const deadline = Date.now() + maxWaitMs;

  const startedAt = Date.now();

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4000));

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX');

      // Get all greenhouse-mail emails, check the most recent ones
      const msgs = await client.search({ from: 'greenhouse-mail' });

      // Check last 5 in reverse (most recent first)
      for (const uid of msgs.slice(-5).reverse()) {
        const msg = await client.fetchOne(uid, { source: true, envelope: true });
        const receivedAt = msg.envelope.date ? new Date(msg.envelope.date).getTime() : 0;

        // Only use codes from emails that arrived after we started this flow
        if (receivedAt < startedAt - 60000) continue;

        const text = msg.source.toString();
        const match = text.match(/<h1>([A-Za-z0-9]{8})<\/h1>/);
        if (match) {
          log.info('Greenhouse security code found in Gmail', { code: match[1] });
          try {
            await client.messageDelete(uid, { uid: true });
            log.info('Greenhouse security code email deleted from Gmail');
          } catch (deleteErr) {
            log.warn('Could not delete security code email', { error: deleteErr.message });
          }
          await client.logout();
          return match[1];
        }
      }

      await client.logout();
      log.info('Code not yet in Gmail, waiting...', { elapsedMs: Date.now() - startedAt });
    } catch (e) {
      log.warn('IMAP check failed', { error: e.message });
      try { await client.logout(); } catch {}
    }
  }

  return null;
}

module.exports = {
  fetchGreenhouseCode,
  getReadableEmailText,
  isLikelyApplicationConfirmation,
  waitForApplicationConfirmation,
};
