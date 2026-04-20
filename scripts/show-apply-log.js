'use strict';

const { getDb } = require('../lib/db');

const db = getDb();

const rows = db.prepare(`
  SELECT
    l.attempted_at,
    j.company,
    j.title,
    j.score,
    l.resume_filename,
    l.status,
    l.security_code,
    l.error
  FROM auto_apply_log l
  JOIN jobs j ON l.job_id = j.id
  ORDER BY l.attempted_at DESC
  LIMIT 50
`).all();

if (!rows.length) {
  console.log('No auto-apply attempts logged yet.');
  process.exit(0);
}

console.log('\nAuto-Apply Receipt Log\n' + '='.repeat(100));

for (const r of rows) {
  const date = r.attempted_at.slice(0, 16).replace('T', ' ');
  const company = (r.company || '').slice(0, 20).padEnd(20);
  const title = (r.title || '').slice(0, 38).padEnd(38);
  const score = String(r.score ?? '?').padStart(2);
  const resume = (r.resume_filename || '—').slice(0, 24).padEnd(24);
  const status = r.status === 'success' ? '✓ success' : '✗ failed ';
  const code = r.security_code ? `code:${r.security_code}` : '         ';
  const err = r.error ? `  ERROR: ${r.error.slice(0, 60)}` : '';

  console.log(`${date}  [${score}]  ${company}  ${title}  ${resume}  ${status}  ${code}${err}`);
}

console.log('='.repeat(100));
console.log(`${rows.length} application(s) shown\n`);
