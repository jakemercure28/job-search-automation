#!/usr/bin/env node
'use strict';

/**
 * AI-driven form fill bridge.
 *
 * Reads Claude-generated answers from the override JSON file and fills the
 * application form in a headed browser (assist mode). The browser stays open
 * so the user can review and click Submit.
 *
 * Usage:
 *   node scripts/ai-assist.js --job=<job-id>
 *
 * The override file must exist at:
 *   {JOB_PROFILE_DIR}/auto-apply-overrides/<job-id>.json
 *
 * Output: JSON to stdout with { success, preImagePath, error }
 */

const path = require('path');
const fs = require('fs');

const { loadDashboardEnv } = require('../lib/env');

function parseArgs(argv) {
  const flags = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const trimmed = token.slice(2);
    const eq = trimmed.indexOf('=');
    if (eq === -1) flags[trimmed] = true;
    else flags[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return flags;
}

async function main(argv = process.argv.slice(2)) {
  loadDashboardEnv(path.join(__dirname, '..'));

  const flags = parseArgs(argv);
  const jobId = flags.job;
  if (!jobId) {
    console.error(JSON.stringify({ success: false, error: '--job=<id> is required' }));
    process.exit(1);
  }

  const { getDb } = require('../lib/db');
  const { applyWithPlatform, detectPlatform } = require('../lib/auto-applier');
  const { pickResume } = require('../lib/apply/shared');
  const { recordAutoApplyAttempt } = require('../lib/auto-apply-receipts');
  const applicantDefaults = require('../config/applicant');
  const { baseDir } = require('../config/paths');

  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    console.error(JSON.stringify({ success: false, error: `Job not found: ${jobId}` }));
    process.exit(1);
  }

  const platform = detectPlatform(job);
  const supported = new Set(['greenhouse', 'lever', 'ashby']);
  if (!platform || !supported.has(platform)) {
    console.error(JSON.stringify({
      success: false,
      error: `Platform "${platform || 'unknown'}" is not supported. Apply manually: ${job.url}`,
    }));
    process.exit(1);
  }

  const overridePath = path.join(
    process.env.JOB_PROFILE_DIR || path.join(baseDir, 'profiles', 'jake'),
    'auto-apply-overrides',
    `${jobId}.json`,
  );

  if (!fs.existsSync(overridePath)) {
    console.error(JSON.stringify({
      success: false,
      error: `Override file not found: ${overridePath}\nRun the /apply skill to generate answers first.`,
    }));
    process.exit(1);
  }

  let override;
  try {
    override = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: `Failed to parse override file: ${err.message}` }));
    process.exit(1);
  }

  const answers = override.answers || {};
  const questions = override.questions || [];
  const unresolvedFields = questions.filter((q) => answers[q.name] == null);

  const applicant = { ...applicantDefaults, resumePath: pickResume(job) };

  let result;
  try {
    result = await applyWithPlatform(job, applicant, platform, {
      mode: 'assist',
      prep: { answers, questions, unresolvedFields, lowConfidenceFields: [] },
    });
  } catch (err) {
    const out = { success: false, error: err.message };
    recordAutoApplyAttempt(db, {
      job,
      result: { ...out, status: 'failed' },
      applicant,
      actor: 'ai-assist',
      mode: 'assist',
      platform,
    });
    console.error(JSON.stringify(out));
    process.exit(1);
  }

  recordAutoApplyAttempt(db, {
    job,
    result: { ...result, status: result.success ? 'prepared' : 'failed' },
    applicant,
    actor: 'ai-assist',
    attemptedAt: new Date().toISOString(),
    mode: 'assist',
    platform,
  });

  console.log(JSON.stringify({
    success: result.success,
    preImagePath: result.preImagePath || null,
    error: result.error || null,
    filledFields: result.details?.filledFields || [],
    unresolvedFields: unresolvedFields.map((f) => f.label),
  }, null, 2));

  if (!result.success) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: err.message || String(err) }));
  process.exit(1);
});
