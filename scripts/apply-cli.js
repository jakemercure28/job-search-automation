#!/usr/bin/env node
'use strict';

const path = require('path');

const { loadDashboardEnv } = require('../lib/env');

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (const token of argv) {
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) flags[trimmed] = true;
    else flags[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }

  return { flags, positionals };
}

function printUsage() {
  console.log(`Usage: node scripts/apply-cli.js <command> [flags]

Commands:
  list      List jobs by score, status, company, or title
  prep      Generate manual apply prep for one job
  resume    Generate a tailored resume PDF for one job
  show      Show job URL, prep status, and resume paths
  apply     Open headed browser, auto-fill form, pause for you to review and submit

Flags:
  --job=<id>           Target one job for prep/resume/show/apply
  --status=<status>    Filter list by job status
  --company=<text>     Filter list by company substring
  --title=<text>       Filter list by title substring
  --min-score=<n>      Filter list by minimum score
  --limit=<n>          Limit list output (default: 25)
  --force              Regenerate prep or tailored resume
  --skip-resume        Skip tailored resume generation in apply command
  --json               Emit JSON
`);
}

function parseInteger(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function formatTable(rows) {
  if (!rows.length) return 'No rows.';
  const headers = Object.keys(rows[0]);
  const widths = new Map(headers.map((header) => [header, header.length]));
  for (const row of rows) {
    for (const header of headers) {
      widths.set(header, Math.max(widths.get(header), String(row[header] ?? '').length));
    }
  }
  const headerLine = headers.map((header) => header.padEnd(widths.get(header))).join('  ');
  const divider = headers.map((header) => '-'.repeat(widths.get(header))).join('  ');
  const body = rows.map((row) => headers.map((header) => String(row[header] ?? '').padEnd(widths.get(header))).join('  ')).join('\n');
  return `${headerLine}\n${divider}\n${body}`;
}

function printOutput(payload, asJson) {
  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(Array.isArray(payload) ? formatTable(payload) : JSON.stringify(payload, null, 2));
}

function fetchJob(db, jobId) {
  if (!jobId) throw new Error('--job=<id> is required');
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  return job;
}

function listJobs(db, flags) {
  const where = ["status != 'archived'"];
  const params = {};

  if (flags.status) {
    where.push('status = @status');
    params.status = String(flags.status);
  }
  if (flags.company) {
    where.push('LOWER(company) LIKE @company');
    params.company = `%${String(flags.company).toLowerCase()}%`;
  }
  if (flags.title) {
    where.push('LOWER(title) LIKE @title');
    params.title = `%${String(flags.title).toLowerCase()}%`;
  }
  const minScore = parseInteger(flags['min-score'], null);
  if (minScore != null) {
    where.push('score >= @minScore');
    params.minScore = minScore;
  }

  const limit = Math.max(1, parseInteger(flags.limit, 25) || 25);
  params.limit = limit;

  return db.prepare(`
    SELECT id, company, title, score, status, COALESCE(stage, '') AS stage, url
    FROM jobs
    WHERE ${where.join(' AND ')}
    ORDER BY score DESC, created_at DESC
    LIMIT @limit
  `).all(params);
}

function buildShowPayload(db, job, profileDir) {
  const { getApplicationPrep } = require('../lib/application-prep');
  const { getTailoredResume, selectSourceResumeVariant } = require('../lib/tailored-resume');

  const prep = getApplicationPrep(db, job.id);
  const tailored = getTailoredResume(db, job.id);
  const baseSource = selectSourceResumeVariant(job, profileDir);

  return {
    job_id: job.id,
    company: job.company,
    title: job.title,
    score: job.score ?? null,
    status: job.status,
    job_url: job.url,
    prep_status: prep?.status || 'not generated',
    prep_url: `/job-application-prep?id=${encodeURIComponent(job.id)}`,
    tailored_status: tailored?.status || 'not generated',
    tailored_resume: tailored?.resume_pdf_path || tailored?.resume_html_path || null,
    base_resume: baseSource.path,
    summary: tailored?.summary || null,
  };
}

function prompt(question) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function runAssist(db, flags) {
  const {
    applyWithPlatform,
    buildApplicantForJob,
    buildReviewPayload,
    detectPlatform,
    refreshJobReadiness,
  } = require('../lib/auto-applier');
  const { prepareApplication } = require('../lib/application-prep');
  const { generateTailoredResume } = require('../lib/tailored-resume');
  const { recordAutoApplyAttempt } = require('../lib/auto-apply-receipts');
  const { baseDir } = require('../config/paths');
  const applicantDefaults = require('../config/applicant');

  const job = fetchJob(db, flags.job);

  const platform = detectPlatform(job);
  const supported = new Set(['greenhouse', 'lever', 'ashby']);
  if (!platform || !supported.has(platform)) {
    console.log(`\nPlatform "${platform || 'unknown'}" is not supported for assisted apply.`);
    console.log(`Apply manually: ${job.url}`);
    return;
  }

  // Step 1 — prep
  process.stdout.write(`\n[1/4] Loading prep for ${job.company} / ${job.title}...\n`);
  const prep = await prepareApplication(db, job, { force: Boolean(flags.force) });

  if (prep.status !== 'ready') {
    console.error(`\nPrep failed: ${prep.error || prep.page_issue || 'unknown error'}`);
    process.exit(1);
  }

  // Step 2 — review
  const review = buildReviewPayload(job, prep);
  const resolved = review.resolvedAnswers || [];
  const unresolved = review.unresolvedFields || [];
  const lowConf = review.lowConfidenceFields || [];

  process.stdout.write(`\n[2/4] ${resolved.length} answers ready`);
  if (unresolved.length || lowConf.length) {
    process.stdout.write(`, ${unresolved.length + lowConf.length} need attention`);
  }
  process.stdout.write('\n\n');

  if (resolved.length) {
    const labelWidth = Math.max(...resolved.map((r) => r.label.length), 5);
    for (const r of resolved) {
      const dots = '.'.repeat(labelWidth - r.label.length + 2);
      console.log(`  ${r.label} ${dots} ${r.value}`);
    }
  }

  if (unresolved.length) {
    console.log('\n  Unresolved fields (will be left blank):');
    for (const f of unresolved) console.log(`    - ${f.label}`);
  }
  if (lowConf.length) {
    console.log('\n  Low-confidence fields (review carefully):');
    for (const f of lowConf) console.log(`    - ${f.label}`);
  }

  if (unresolved.length || lowConf.length) {
    const answer = await prompt('\n  Continue anyway? [y/N] ');
    if (answer !== 'y') {
      console.log('Aborted.');
      return;
    }
  }

  // Optional tailored resume
  if (!flags['skip-resume']) {
    const { getTailoredResume } = require('../lib/tailored-resume');
    const existing = getTailoredResume(db, job.id);
    if (!existing || existing.status !== 'ready') {
      process.stdout.write('  Generating tailored resume...\n');
      await generateTailoredResume(db, job, { force: false, renderPdf: true });
    }
  }

  const { pickResume } = require('../lib/apply/shared');
  const applicant = { ...applicantDefaults, resumePath: pickResume(job) };
  const refreshed = await refreshJobReadiness(db, job);

  // Step 3 — open browser
  console.log('\n[3/4] Opening browser in headed mode...');
  let result;
  try {
    result = await applyWithPlatform(refreshed, applicant, platform, {
      mode: 'assist',
      prep: { ...prep, unresolvedFields: unresolved, lowConfidenceFields: lowConf },
    });
  } catch (err) {
    console.error(`\nBrowser error: ${err.message}`);
    recordAutoApplyAttempt(db, {
      job: refreshed,
      result: { success: false, status: 'failed', error: err.message },
      applicant,
      actor: 'cli-assist',
      mode: 'assist',
      platform,
    });
    process.exit(1);
  }

  if (!result.success) {
    console.error(`\nCould not fill form: ${result.error || 'unknown error'}`);
    if (result.preImagePath || result.incompleteImagePath) {
      console.log(`Screenshot: ${result.preImagePath || result.incompleteImagePath}`);
    }
    recordAutoApplyAttempt(db, {
      job: refreshed,
      result,
      applicant,
      actor: 'cli-assist',
      mode: 'assist',
      platform,
    });
    process.exit(1);
  }

  // Step 4 — hand off to user
  console.log('\n[4/4] Form filled. Browser is open — review and click Submit.');
  if (result.preImagePath) console.log(`      Screenshot: ${result.preImagePath}`);
  console.log('');

  await prompt('      Press Enter when you have submitted (or Ctrl+C to abort)... ');

  const submitted = await prompt('      Mark job as applied? [y/N] ');
  const success = submitted === 'y';

  if (success) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jobs
      SET status = 'applied', stage = 'applied',
          applied_at = CASE WHEN applied_at IS NULL THEN ? ELSE applied_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(now, refreshed.id);
    logEvent(db, refreshed.id, 'stage_change', refreshed.stage || null, 'applied');
    console.log(`\nMarked ${job.company} / ${job.title} as applied.`);
  } else {
    console.log('\nNot marked as applied. You can update the status from the dashboard.');
  }

  recordAutoApplyAttempt(db, {
    job: refreshed,
    result: { ...result, success, status: success ? 'success' : 'aborted' },
    applicant,
    actor: 'cli-assist',
    attemptedAt: new Date().toISOString(),
    mode: 'assist',
    platform,
  });
}

async function main(argv = process.argv.slice(2)) {
  const { flags, positionals } = parseArgs(argv);
  const command = positionals[0] || 'list';

  if (['help', '--help', '-h'].includes(command)) {
    printUsage();
    return;
  }

  loadDashboardEnv(path.join(__dirname, '..'));

  const { getDb, logEvent } = require('../lib/db');
  const { baseDir } = require('../config/paths');
  const db = getDb();
  const asJson = Boolean(flags.json);

  switch (command) {
    case 'list': {
      printOutput(listJobs(db, flags), asJson);
      return;
    }

    case 'prep': {
      const { prepareApplication } = require('../lib/application-prep');
      const job = fetchJob(db, flags.job);
      const prep = await prepareApplication(db, job, { force: Boolean(flags.force) });
      printOutput({
        job_id: job.id,
        company: job.company,
        title: job.title,
        status: prep.status,
        workflow: prep.workflow,
        apply_url: prep.apply_url || job.url,
        questions: prep.questions?.length || 0,
        summary: prep.summary || null,
        prep_url: `/job-application-prep?id=${encodeURIComponent(job.id)}`,
      }, asJson);
      return;
    }

    case 'resume': {
      const { generateTailoredResume } = require('../lib/tailored-resume');
      const job = fetchJob(db, flags.job);
      const result = await generateTailoredResume(db, job, {
        force: Boolean(flags.force),
        renderPdf: !flags['no-pdf'],
      });
      printOutput({
        job_id: job.id,
        company: job.company,
        title: job.title,
        status: result.status,
        source_variant: result.source_variant,
        resume_md: result.resume_md_path,
        resume_html: result.resume_html_path,
        resume_pdf: result.resume_pdf_path,
        summary: result.summary,
        keywords: result.keywords,
      }, asJson);
      return;
    }

    case 'show': {
      const job = fetchJob(db, flags.job);
      printOutput(buildShowPayload(db, job, baseDir), asJson);
      return;
    }

    case 'apply': {
      await runAssist(db, flags);
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  buildShowPayload,
  listJobs,
  main,
  parseArgs,
};
