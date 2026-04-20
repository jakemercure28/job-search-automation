'use strict';

/**
 * fix-descriptions.js
 *
 * One-time migration: clean up messed-up characters in existing job descriptions.
 *
 * Issues found:
 *   - 357 jobs with HTML entities (&amp;, &nbsp;, &#160; etc.) from double-encoding
 *   - 11 jobs with raw HTML tags left in (<p>, <br>, <li>, etc.)
 *   - 5 jobs with UTF-8/Latin-1 encoding artifacts (â€™ etc.)
 *
 * Run once: node fix-descriptions.js
 */

const { getDb } = require('../lib/db');
const { stripHtml } = require('../lib/utils');

const db = getDb();

// Run on all non-empty descriptions — stripHtml is idempotent, only writes if changed.
// LIKE-based filtering misses uppercase tags (<BR>, <P> etc.) so we just scan everything.
const dirty = db.prepare(
  "SELECT id, description FROM jobs WHERE description IS NOT NULL AND description != ''"
).all();

console.log(`Scanning ${dirty.length} jobs...`);

const update = db.prepare("UPDATE jobs SET description=?, updated_at=datetime('now') WHERE id=?");

let fixed = 0;
let unchanged = 0;

db.transaction(() => {
  for (const job of dirty) {
    // Re-run through stripHtml — idempotent on already-stripped text,
    // but now catches residual entities and stray tags
    const cleaned = stripHtml(job.description);
    if (cleaned !== job.description) {
      update.run(cleaned, job.id);
      fixed++;
    } else {
      unchanged++;
    }
  }
})();

console.log(`Done: ${fixed} updated, ${unchanged} already clean.`);
