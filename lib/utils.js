'use strict';

const { FETCH_TIMEOUT_MS, MAX_DESCRIPTION_LENGTH } = require('../config/constants');
const log = require('./logger')('scraper');

const HTML_ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  ldquo: '\u201C',
  rdquo: '\u201D',
  lsquo: '\u2018',
  rsquo: '\u2019',
  hellip: '…',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeEntities(s) {
  let decoded = String(s || '');

  // Run a few passes so inputs like "&amp;amp;" fully collapse without risking an infinite loop.
  for (let i = 0; i < 3; i += 1) {
    const next = decoded
      .replace(/&([a-z]+);/gi, (match, entity) => HTML_ENTITY_MAP[entity.toLowerCase()] || match)
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
}

function stripHtml(text, maxLen = MAX_DESCRIPTION_LENGTH) {
  const decoded = decodeEntities(text || '');
  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

async function safeFetch(url, options = {}, label = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) return null;
    return res;
  } catch (err) {
    log.warn('Fetch error', { label, error: err.message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { sleep, stripHtml, safeFetch, escapeHtml };
