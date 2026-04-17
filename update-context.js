'use strict';

/**
 * Auto-update .context/ files from git history and SQLite data.
 * Runs via cron alongside the scraper. No API keys needed.
 *
 * Updates:
 *   - reference/applications.md   (rejection log from events table)
 *   - decisions/architecture.md   (recent PRs merged, appended)
 *   - goals/career.md       (pipeline stats snapshot)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');

const REPO_ROOT = __dirname;
const CONTEXT_DIR = path.join(REPO_ROOT, '.context');
const DB_PATH = process.env.JOB_DB_PATH || path.join(__dirname, 'profiles', 'example', 'jobs.db');

function run(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------------------
// 1. Update reference/applications.md with rejection data from events table
// ---------------------------------------------------------------------------

function updateApplications(db) {
  const filePath = path.join(CONTEXT_DIR, 'reference', 'applications.md');

  const rejections = db.prepare(`
    SELECT j.company, j.title, j.score, j.applied_at, j.rejected_at,
      j.rejected_from_stage,
      ROUND(julianday(j.rejected_at) - julianday(j.applied_at), 1) as days_to_reject,
      ROUND(julianday(j.applied_at) - julianday(j.posted_at), 1) as posting_age
    FROM jobs j
    WHERE j.stage = 'rejected' AND j.rejected_at IS NOT NULL
    ORDER BY j.rejected_at DESC
  `).all();

  const interviewing = db.prepare(`
    SELECT company, title, score, stage, applied_at
    FROM jobs WHERE stage IN ('phone_screen', 'interview', 'onsite', 'offer')
    ORDER BY applied_at DESC
  `).all();

  let content = `# Application Notes

Auto-updated by update-context.js. Last run: ${new Date().toISOString().slice(0, 10)}

## Active Interviews

`;

  if (interviewing.length) {
    for (const j of interviewing) {
      const stage = { phone_screen: 'Phone Screen', interview: 'Interview', onsite: 'Onsite', offer: 'Offer' }[j.stage] || j.stage;
      content += `### ${j.company} / ${j.title}\n`;
      content += `**Stage:** ${stage} | **Score:** ${j.score} | **Applied:** ${(j.applied_at || '').slice(0, 10)}\n\n`;
    }
  } else {
    content += `No active interviews.\n\n`;
  }

  content += `## Rejections (${rejections.length} total)\n\n`;

  if (rejections.length) {
    content += `| Company | Role | Score | From | Days to Reject | Posting Age |\n`;
    content += `|---------|------|-------|------|----------------|-------------|\n`;
    for (const r of rejections) {
      const from = r.rejected_from_stage || 'applied';
      const days = r.days_to_reject != null ? `${r.days_to_reject}d` : '?';
      const age = r.posting_age != null ? `${r.posting_age}d` : '?';
      content += `| ${r.company} | ${r.title.slice(0, 40)} | ${r.score || '?'} | ${from} | ${days} | ${age} |\n`;
    }

    const validDays = rejections.filter(r => r.days_to_reject != null);
    const validAge = rejections.filter(r => r.posting_age != null);
    const avgDays = validDays.length ? (validDays.reduce((s, r) => s + r.days_to_reject, 0) / validDays.length).toFixed(1) : '?';
    const avgAge = validAge.length ? (validAge.reduce((s, r) => s + r.posting_age, 0) / validAge.length).toFixed(1) : '?';
    const staleRejects = rejections.filter(r => r.posting_age > 30).length;

    content += `\n**Averages:** ${avgDays} days to rejection, ${avgAge} days posting age at application\n`;
    content += `**Stale postings (>30 days old at apply):** ${staleRejects} of ${rejections.length} rejections\n`;
  }

  fs.writeFileSync(filePath, content);
  console.log(`[update-context] Updated reference/applications.md (${interviewing.length} active, ${rejections.length} rejections)`);
}

// ---------------------------------------------------------------------------
// 2. Update goals/career.md with pipeline stats snapshot
// ---------------------------------------------------------------------------

function updateCareerStats(db) {
  const filePath = path.join(CONTEXT_DIR, 'goals', 'career.md');

  const stats = {
    total: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status != 'archived'").get().n,
    applied: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status IN ('applied','responded')").get().n,
    interviewing: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage IN ('phone_screen','interview','onsite','offer')").get().n,
    rejected: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'rejected'").get().n,
    offers: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE stage = 'offer'").get().n,
  };

  // Get conversion rate
  const convRate = stats.applied > 0 ? Math.round((stats.interviewing / stats.applied) * 100) : 0;

  // Get this week's application count
  const weekApps = db.prepare(`
    SELECT COUNT(*) as n FROM jobs
    WHERE applied_at IS NOT NULL AND julianday('now') - julianday(applied_at) <= 7
  `).get().n;

  // Read existing file to preserve any manually-written content
  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf8');
  }

  // Find or create the auto-generated stats section
  const MARKER_START = '<!-- AUTO-STATS-START -->';
  const MARKER_END = '<!-- AUTO-STATS-END -->';

  const statsBlock = `${MARKER_START}
## Pipeline Snapshot (auto-updated ${new Date().toISOString().slice(0, 10)})

- **Total tracked:** ${stats.total}
- **Applied:** ${stats.applied}
- **Interviewing:** ${stats.interviewing} (${convRate}% conversion from applied)
- **Rejected:** ${stats.rejected}
- **Offers:** ${stats.offers}
- **Applied this week:** ${weekApps}
${MARKER_END}`;

  if (existing.includes(MARKER_START)) {
    // Replace existing auto section
    const before = existing.slice(0, existing.indexOf(MARKER_START));
    const after = existing.slice(existing.indexOf(MARKER_END) + MARKER_END.length);
    fs.writeFileSync(filePath, before + statsBlock + after);
  } else {
    // Append after the header
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + statsBlock + '\n');
  }

  console.log(`[update-context] Updated goals/career.md (${stats.applied} applied, ${stats.interviewing} interviewing)`);
}

// ---------------------------------------------------------------------------
// 3. Update decisions/architecture.md with recent PRs
// ---------------------------------------------------------------------------

function updateRecentPRs() {
  const filePath = path.join(CONTEXT_DIR, 'decisions', 'architecture.md');
  const existing = fs.readFileSync(filePath, 'utf8');

  // Get PRs merged in the last 7 days
  let recentCommits;
  try {
    recentCommits = run('git log --oneline --merges --since="7 days ago" --grep="Merge pull request"');
  } catch (e) {
    recentCommits = '';
  }

  if (!recentCommits) {
    console.log('[update-context] No new PRs in last 7 days, skipping architecture.md');
    return;
  }

  const MARKER_START = '<!-- AUTO-RECENT-PRS-START -->';
  const MARKER_END = '<!-- AUTO-RECENT-PRS-END -->';

  const lines = recentCommits.split('\n').filter(Boolean).slice(0, 15);
  const prBlock = `${MARKER_START}
## Recent Changes (auto-updated ${new Date().toISOString().slice(0, 10)})

${lines.map(l => `- ${l}`).join('\n')}
${MARKER_END}`;

  if (existing.includes(MARKER_START)) {
    const before = existing.slice(0, existing.indexOf(MARKER_START));
    const after = existing.slice(existing.indexOf(MARKER_END) + MARKER_END.length);
    fs.writeFileSync(filePath, before + prBlock + after);
  } else {
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + prBlock + '\n');
  }

  console.log(`[update-context] Updated decisions/architecture.md (${lines.length} recent PRs)`);
}

// ---------------------------------------------------------------------------
// 4. Git commit if anything changed
// ---------------------------------------------------------------------------

function commitIfChanged() {
  const status = run('git status --porcelain .context/');
  if (!status) {
    console.log('[update-context] No context changes to commit');
    return;
  }

  console.log('[update-context] Changes detected, committing...');
  run('git add .context/');
  run(`git commit -m "Auto-update context files ($(date +%Y-%m-%d))"`);
  run('git push');
  console.log('[update-context] Committed and pushed');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(`[update-context] Starting context update at ${new Date().toISOString()}`);

  if (!fs.existsSync(DB_PATH)) {
    console.log(`[update-context] DB not found at ${DB_PATH}, skipping`);
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    updateApplications(db);
    updateCareerStats(db);
    updateRecentPRs();
    commitIfChanged();
  } finally {
    db.close();
  }

  console.log('[update-context] Done');
}

main();
