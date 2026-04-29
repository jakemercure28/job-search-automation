'use strict';

const { stripHtml } = require('../utils');

const REJECTION_PATTERNS = [
  /\bunfortunately\b/i,
  /\bnot moving forward\b/i,
  /\bwill not be moving forward\b/i,
  /\bwon'?t be moving forward\b/i,
  /\bdecided not to proceed\b/i,
  /\bdecided to proceed with candidates?\b/i,
  /\bdecided not to move forward\b/i,
  /\bdecided to not move forward\b/i,
  /\bhave decided not to move forward\b/i,
  /\b(?:made|make) the decision to not move forward\b/i,
  /\bnot proceed with your candidacy\b/i,
  /\bextend an offer to another candidate\b/i,
  /\bmove ahead with another candidate\b/i,
  /\bmove forward with other candidates\b/i,
  /\bmoving forward with other candidates\b/i,
  /\bnot continuing with (?:any )?(?:new )?interviews\b/i,
  /\bnot continuing with your application\b/i,
  /\bbetter match for this (?:particular )?(?:position|role)\b/i,
  /\bbackgrounds? more closely align\b/i,
  /\bposition has been (?:filled|closed)\b/i,
  /\brole has been (?:filled|closed)\b/i,
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

module.exports = {
  REJECTION_PATTERNS,
  normalizeText,
  normalizeCompact,
  decodeQuotedPrintable,
  extractLinks,
  hasTerm,
  getReadableEmailText,
  isRejectionEmail,
  parseMatchableUrl,
};
