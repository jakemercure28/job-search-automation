'use strict';

// Location filter. Cities in LOCATION_FILTER (comma-separated env var) are always kept.
// "Remote" and unknown locations are kept. Cities in LOCATION_BLOCKLIST are always dropped.
// Everything else passes through to the scorer.
//
// Example .env entries:
//   LOCATION_FILTER=seattle,bellevue,redmond
//   LOCATION_BLOCKLIST=london,berlin,san francisco

const parseList = (value) => (value || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALLOW = parseList(process.env.LOCATION_FILTER);
const BLOCK = parseList(process.env.LOCATION_BLOCKLIST);
const REMOTE = /remote|anywhere|distributed|us.only|work from home|wfh/i;

function matchesAny(loc, list) {
  const lower = loc.toLowerCase();
  return list.some((term) => lower.includes(term));
}

/**
 * Returns true if the job location passes the configured filter.
 * Unknown/empty locations return true (scorer handles them).
 *
 * @param {string} location
 * @returns {boolean}
 */
function isLocationAllowed(location) {
  const loc = (location || '').trim();
  if (!loc) return true;

  if (ALLOW.length && matchesAny(loc, ALLOW)) return true;
  if (REMOTE.test(loc)) return true;
  if (/^(hybrid|in-office)$/i.test(loc)) return true;

  if (BLOCK.length && matchesAny(loc, BLOCK)) return false;

  // If an allow list is configured and we didn't hit it, drop.
  if (ALLOW.length) return false;

  return true;
}

module.exports = { isLocationAllowed };
