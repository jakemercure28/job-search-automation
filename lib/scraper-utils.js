'use strict';

const { SEARCH_TERMS } = require('../config/companies');

/**
 * Returns true if the text matches any of the configured search terms.
 * Used by all scrapers to filter job titles.
 */
function matchesSearchTerms(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SEARCH_TERMS.some((t) => lower.includes(t));
}

module.exports = { matchesSearchTerms };
