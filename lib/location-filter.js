'use strict';

// Location filter. Configure allowed cities via LOCATION_FILTER (comma-separated).
// LOCATION_BLOCKLIST always drops. Remote/unknown always pass.
// Example .env entry:
//   LOCATION_FILTER=city1,city2,city3

const parseList = (value) => (value || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALLOW = parseList(process.env.LOCATION_FILTER);
const BLOCK = parseList(process.env.LOCATION_BLOCKLIST);

// Matches locations that are clearly remote/flexible — must stand alone or
// appear without a specific non-Seattle city pinning the role elsewhere.
// "United States" / "USA" alone (no city) means distributed/nationwide → keep.
const REMOTE = /\bremote\b|work from home|\bwfh\b|\banywhere\b|distributed|us[- ]only/i;

// "United States" or "USA" only when the location isn't also naming a specific city
// (e.g. "United States" alone → keep; "San Francisco, CA, United States" → drop)
function looksNationwide(loc) {
  if (!/united states|nationwide|\busa\b/i.test(loc)) return false;
  // If there's a comma-separated city/state before it, it's a specific office location
  return !/,/.test(loc);
}

function matchesAny(loc, list) {
  const lower = loc.toLowerCase();
  return list.some((term) => lower.includes(term));
}

/**
 * Returns true if the job location passes the filter.
 * Blank/unknown locations pass through (scorer handles ambiguity).
 */
function isLocationAllowed(location) {
  const loc = (location || '').trim();
  if (!loc) return true;

  if (ALLOW.length && matchesAny(loc, ALLOW)) return true;
  if (REMOTE.test(loc)) return true;
  if (looksNationwide(loc)) return true;
  if (/^(hybrid|in-office)$/i.test(loc)) return true;

  if (BLOCK.length && matchesAny(loc, BLOCK)) return false;

  // No allow list configured — pass everything through.
  if (!ALLOW.length) return true;

  return false;
}

module.exports = { isLocationAllowed };
