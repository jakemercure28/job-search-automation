'use strict';

function normalizeCompanyTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function compareCompanyTags(left, right) {
  return left.localeCompare(right, 'en', { sensitivity: 'base' });
}

function parseCompanyTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  const seen = new Set();
  const tags = [];

  for (const rawTag of rawTags) {
    const tag = normalizeCompanyTag(rawTag);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }

  return tags.sort(compareCompanyTags);
}

function serializeCompanyTags(value) {
  return parseCompanyTags(value).join(', ');
}

module.exports = {
  compareCompanyTags,
  normalizeCompanyTag,
  parseCompanyTags,
  serializeCompanyTags,
};
