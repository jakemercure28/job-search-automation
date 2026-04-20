'use strict';

// One-time backfill: generate rejection_reasoning for all applied jobs that don't have it yet.

const { getDb } = require('../lib/db');
const { scoreRejectionLikelihood } = require('../scorer');

async function main() {
  const db = getDb();
  const jobs = db.prepare(
    "SELECT * FROM jobs WHERE status='applied' AND rejection_reasoning IS NULL ORDER BY applied_at DESC"
  ).all();

  console.log(`Backfilling rejection reasoning for ${jobs.length} applied jobs...`);

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    process.stdout.write(`[${i + 1}/${jobs.length}] ${job.company} — ${job.title}... `);
    try {
      const text = await scoreRejectionLikelihood(job);
      db.prepare("UPDATE jobs SET rejection_reasoning=?, updated_at=datetime('now') WHERE id=?")
        .run(text, job.id);
      console.log('done');
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  console.log('Backfill complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
