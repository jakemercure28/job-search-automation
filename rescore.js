#!/usr/bin/env node
'use strict';

/**
 * rescore.js
 * Tool for comparing Claude vs Gemini job scoring.
 *
 * Usage:
 *   node rescore.js export          — Export stratified sample to rescore-batches/
 *   node rescore.js import <file>   — Import Claude scores from JSON file
 *   node rescore.js report          — Generate comparison report
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('./lib/db');

const BATCH_DIR = path.join(__dirname, 'rescore-batches');
const BATCH_SIZE = 10;
const DESC_LIMIT = 2000;

// Stratified sample sizes — weight toward higher scores where miscalibration costs the most
const STRATA = [
  { label: 'score-1',    min: 1, max: 1, count: 5 },
  { label: 'score-2-4',  min: 2, max: 4, count: 10 },
  { label: 'score-5-7',  min: 5, max: 7, count: 15 },
  { label: 'score-8-10', min: 8, max: 10, count: 20 },
];

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function doExport() {
  const db = getDb();

  if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });

  const sampled = [];

  for (const s of STRATA) {
    const rows = db.prepare(`
      SELECT id, title, company, location, platform, description, score, reasoning
      FROM jobs
      WHERE score >= ? AND score <= ? AND description IS NOT NULL
      ORDER BY RANDOM()
      LIMIT ?
    `).all(s.min, s.max, s.count);

    process.stderr.write(`[rescore] ${s.label}: sampled ${rows.length}/${s.count} jobs\n`);
    sampled.push(...rows);
  }

  // Truncate descriptions and strip gemini reasoning for scoring prompt
  const jobs = sampled.map(r => ({
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location || 'Not specified',
    platform: r.platform || '',
    description: (r.description || '').slice(0, DESC_LIMIT),
    gemini_score: r.score,
    gemini_reasoning: r.reasoning,
  }));

  // Split into batches
  const batches = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE));
  }

  for (let i = 0; i < batches.length; i++) {
    const filePath = path.join(BATCH_DIR, `batch-${i + 1}.json`);
    fs.writeFileSync(filePath, JSON.stringify(batches[i], null, 2));
    process.stderr.write(`[rescore] Wrote ${filePath} (${batches[i].length} jobs)\n`);
  }

  // Generate scoring prompt
  const promptPath = path.join(BATCH_DIR, 'scoring-prompt.md');
  fs.writeFileSync(promptPath, `# Scoring Prompt for Claude Re-scoring

Score each job on a scale of 1-10 using this rubric. Read the candidate's resume.md and context.md first.

**HARD DISQUALIFIERS — score 1 and stop if any apply:**
- The role's location conflicts with the candidate's location requirements AND is not remote/distributed
- Requires relocation to a city the candidate has not indicated willingness to live in
- International role with no remote option for the candidate's country

**If no hard disqualifiers, evaluate on 1-10:**
1. **Stack match** (2 pts): Does the tech stack align with the candidate's experience? Penalize for required expertise gaps.
2. **Seniority fit** (2 pts): Does the YOE requirement match the candidate's level? Penalize for overleveling.
3. **Compensation signals** (2 pts): Any comp signals aligned with expectations ($130k floor, $140-180k sweet spot)?
4. **Company stage** (2 pts): Does stage/type match preferences (Series A-D)?
5. **Overall desirability** (2 pts): Dealbreakers, excitement factors, location/remote fit.

**Important:** Score independently. Do NOT anchor on the Gemini score provided — it's there for comparison only.

**Output format per job:**
\`\`\`json
[
  { "id": "<job id>", "claude_score": <1-10>, "claude_reasoning": "<one paragraph, 3-5 sentences>" }
]
\`\`\`
`);
  process.stderr.write(`[rescore] Wrote ${promptPath}\n`);
  process.stderr.write(`[rescore] Done. ${jobs.length} jobs across ${batches.length} batches.\n`);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function doImport(filePath) {
  if (!filePath) {
    process.stderr.write('[rescore] Usage: node rescore.js import <file.json>\n');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    process.stderr.write(`[rescore] File not found: ${absPath}\n`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(absPath, 'utf8'));
  if (!Array.isArray(data)) {
    process.stderr.write('[rescore] Expected a JSON array.\n');
    process.exit(1);
  }

  const db = getDb();
  const stmt = db.prepare('UPDATE jobs SET claude_score = ?, claude_reasoning = ? WHERE id = ?');

  let updated = 0;
  for (const item of data) {
    if (!item.id || item.claude_score == null) {
      process.stderr.write(`[rescore] Skipping invalid entry: ${JSON.stringify(item).slice(0, 100)}\n`);
      continue;
    }
    const result = stmt.run(item.claude_score, item.claude_reasoning || '', item.id);
    if (result.changes > 0) updated++;
  }

  process.stderr.write(`[rescore] Imported ${updated}/${data.length} scores.\n`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function doReport() {
  const db = getDb();

  const rows = db.prepare(`
    SELECT id, title, company, score AS gemini_score, claude_score,
           reasoning AS gemini_reasoning, claude_reasoning,
           status, stage, location
    FROM jobs
    WHERE claude_score IS NOT NULL
    ORDER BY ABS(score - claude_score) DESC
  `).all();

  if (rows.length === 0) {
    process.stderr.write('[rescore] No Claude scores found. Run export + import first.\n');
    process.exit(0);
  }

  const lines = [];
  lines.push('# Score Comparison Report: Claude vs Gemini');
  lines.push(`\nGenerated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`Jobs compared: ${rows.length}\n`);

  // Summary stats
  const geminiScores = rows.map(r => r.gemini_score);
  const claudeScores = rows.map(r => r.claude_score);
  const diffs = rows.map(r => Math.abs(r.gemini_score - r.claude_score));
  const signedDiffs = rows.map(r => r.claude_score - r.gemini_score);

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const geminiMean = mean(geminiScores);
  const claudeMean = mean(claudeScores);
  const meanDiff = mean(diffs);
  const meanSignedDiff = mean(signedDiffs);

  lines.push('## Summary');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Gemini mean score | ${geminiMean.toFixed(1)} |`);
  lines.push(`| Claude mean score | ${claudeMean.toFixed(1)} |`);
  lines.push(`| Mean absolute difference | ${meanDiff.toFixed(1)} |`);
  lines.push(`| Mean signed difference (Claude - Gemini) | ${meanSignedDiff > 0 ? '+' : ''}${meanSignedDiff.toFixed(1)} |`);
  lines.push(`| Exact agreement | ${rows.filter(r => r.gemini_score === r.claude_score).length} (${(rows.filter(r => r.gemini_score === r.claude_score).length / rows.length * 100).toFixed(0)}%) |`);
  lines.push(`| Within 1 point | ${rows.filter(r => Math.abs(r.gemini_score - r.claude_score) <= 1).length} (${(rows.filter(r => Math.abs(r.gemini_score - r.claude_score) <= 1).length / rows.length * 100).toFixed(0)}%) |`);
  lines.push(`| Differ by 3+ | ${rows.filter(r => Math.abs(r.gemini_score - r.claude_score) >= 3).length} (${(rows.filter(r => Math.abs(r.gemini_score - r.claude_score) >= 3).length / rows.length * 100).toFixed(0)}%) |`);

  // Bucket accuracy
  lines.push('\n## Bucket Agreement');
  lines.push('How often both models place the job in the same tier:\n');
  lines.push('| Tier | Gemini count | Claude agrees | Agreement % |');
  lines.push('|------|-------------|--------------|-------------|');

  const buckets = [
    { label: 'Low (1-3)', min: 1, max: 3 },
    { label: 'Mid (4-6)', min: 4, max: 6 },
    { label: 'High (7-8)', min: 7, max: 8 },
    { label: 'Top (9-10)', min: 9, max: 10 },
  ];

  for (const b of buckets) {
    const inBucket = rows.filter(r => r.gemini_score >= b.min && r.gemini_score <= b.max);
    const agrees = inBucket.filter(r => r.claude_score >= b.min && r.claude_score <= b.max);
    const pct = inBucket.length > 0 ? (agrees.length / inBucket.length * 100).toFixed(0) : 'N/A';
    lines.push(`| ${b.label} | ${inBucket.length} | ${agrees.length} | ${pct}% |`);
  }

  // Significant disagreements
  const bigDisagree = rows.filter(r => Math.abs(r.gemini_score - r.claude_score) >= 3);
  if (bigDisagree.length > 0) {
    lines.push('\n## Significant Disagreements (diff >= 3)');
    lines.push('');

    // Split into Gemini over-scored and under-scored
    const overScored = bigDisagree.filter(r => r.gemini_score > r.claude_score);
    const underScored = bigDisagree.filter(r => r.claude_score > r.gemini_score);

    if (overScored.length > 0) {
      lines.push(`### Gemini Over-scored (${overScored.length} jobs)`);
      lines.push('Jobs where Gemini scored higher than Claude thinks is warranted:\n');
      for (const r of overScored) {
        lines.push(`**${r.title}** @ ${r.company} (${r.location})`);
        lines.push(`- Gemini: ${r.gemini_score}/10 | Claude: ${r.claude_score}/10 | Delta: ${r.gemini_score - r.claude_score}`);
        lines.push(`- Gemini: ${(r.gemini_reasoning || '').slice(0, 200)}`);
        lines.push(`- Claude: ${(r.claude_reasoning || '').slice(0, 200)}`);
        lines.push('');
      }
    }

    if (underScored.length > 0) {
      lines.push(`### Gemini Under-scored (${underScored.length} jobs)`);
      lines.push('Jobs where Gemini scored lower than Claude thinks is warranted:\n');
      for (const r of underScored) {
        lines.push(`**${r.title}** @ ${r.company} (${r.location})`);
        lines.push(`- Gemini: ${r.gemini_score}/10 | Claude: ${r.claude_score}/10 | Delta: ${r.claude_score - r.gemini_score}`);
        lines.push(`- Gemini: ${(r.gemini_reasoning || '').slice(0, 200)}`);
        lines.push(`- Claude: ${(r.claude_reasoning || '').slice(0, 200)}`);
        lines.push('');
      }
    }
  }

  // All comparisons table
  lines.push('\n## All Comparisons');
  lines.push('');
  lines.push('| Title | Company | Gemini | Claude | Diff |');
  lines.push('|-------|---------|--------|--------|------|');
  for (const r of rows) {
    const diff = r.claude_score - r.gemini_score;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    const flag = Math.abs(diff) >= 3 ? ' **' : '';
    lines.push(`| ${r.title.slice(0, 40)} | ${r.company.slice(0, 20)} | ${r.gemini_score} | ${r.claude_score} | ${diffStr}${flag} |`);
  }

  const report = lines.join('\n');
  const reportPath = path.join(BATCH_DIR, 'comparison-report.md');
  fs.writeFileSync(reportPath, report);
  process.stdout.write(report + '\n');
  process.stderr.write(`\n[rescore] Report saved to ${reportPath}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'export': doExport(); break;
  case 'import': doImport(args[0]); break;
  case 'report': doReport(); break;
  default:
    process.stderr.write('Usage: node rescore.js <export|import|report> [args]\n');
    process.exit(1);
}
