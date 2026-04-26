'use strict';

const { ImapFlow } = require('imapflow');
const log = require('../logger')('imap');

const DEFAULT_MAILBOX = '[Gmail]/All Mail';
const TRASH_MAILBOX = '[Gmail]/Trash';
const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_MESSAGES = 300;

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

  log.info('Connecting', { host: 'imap.gmail.com', mailbox, lookbackDays });
  const t = log.timer();
  await client.connect();

  try {
    const mailboxInfo = await client.mailboxOpen(mailbox);
    const nextUidValidity = mailboxInfo.uidValidity || client.mailbox?.uidValidity || null;
    const since = new Date();
    since.setDate(since.getDate() - lookbackDays);

    let uids = await client.search({ since });
    const totalUids = uids.length;

    if (uidValidity && nextUidValidity && String(uidValidity) === String(nextUidValidity) && lastUid != null) {
      uids = uids.filter((uid) => uid > Number(lastUid));
    }

    uids = uids.sort((left, right) => left - right).slice(-maxMessages);
    log.info('UIDs fetched', { total: totalUids, afterFilter: uids.length, capped: maxMessages });

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

    log.info('Messages fetched', { count: messages.length, ms: t() });

    return {
      uidValidity: nextUidValidity,
      lastUid: uids.length ? uids[uids.length - 1] : lastUid,
      messages,
    };
  } finally {
    try {
      await client.logout();
      log.debug('Logged out');
    } catch (_) {}
  }
}

module.exports = {
  DEFAULT_MAILBOX,
  TRASH_MAILBOX,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_MAX_MESSAGES,
  fetchMailboxMessages,
};
