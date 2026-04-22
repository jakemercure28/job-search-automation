#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');
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
    if (eqIndex === -1) {
      flags[trimmed] = true;
      continue;
    }
    const key = trimmed.slice(0, eqIndex);
    const value = trimmed.slice(eqIndex + 1);
    flags[key] = value;
  }

  return { flags, positionals };
}

function parseInteger(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseCsv(value) {
  if (!value) return null;
  const items = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function maybeRunRemote(argv, flags) {
  const remoteHost = flags.remote ? String(flags.remote) : '';
  if (!remoteHost || flags['remote-exec']) return false;

  const remoteRepo = String(flags['remote-repo'] || '/Users/jake/job-search-automation');
  const remoteNode = String(flags['remote-node'] || '/opt/homebrew/opt/node@22/bin/node');
  const forwardedArgs = argv
    .filter((arg) => !arg.startsWith('--remote=') && !arg.startsWith('--remote-repo=') && !arg.startsWith('--remote-node='))
    .concat('--remote-exec');
  const remoteCmd = `cd ${shellQuote(remoteRepo)} && ${shellQuote(remoteNode)} scripts/auto-apply-cli.js ${forwardedArgs.map(shellQuote).join(' ')}`;

  const result = spawnSync('ssh', [remoteHost, remoteCmd], { stdio: 'inherit' });
  process.exit(result.status || 0);
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

  if (Array.isArray(payload)) {
    console.log(formatTable(payload));
    return;
  }

  if (payload?.rows && Array.isArray(payload.rows)) {
    if (payload.summary) console.log(JSON.stringify(payload.summary, null, 2));
    console.log(formatTable(payload.rows));
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

function printUsage() {
  console.log(`Usage: node scripts/auto-apply-cli.js <command> [flags]

Commands:
  plan       List eligible and skipped jobs
  prepare    Generate prep for one job or a batch
  assist     Guided flow: select next job, generate prep, review, then optionally submit
  run        Submit a batch of jobs
  submit     Submit one specific job
  retry      Retry retryable failed pending jobs
  show       Show recent attempt receipts

Common flags:
  --job=<id>           Target one job
  --limit=<n>          Limit batch size
  --platforms=a,b      Restrict to platforms
  --min-score=<n>      Minimum score
  --max-score=<n>      Maximum score
  --score-order=asc    Lowest score first (default)
  --remote=imac-server Execute the CLI on the iMac repo
  --json               Emit JSON

Assist flags:
  --yes                Submit immediately after prep review if ready
  --dry-run            Submit in dry-run mode
`);
}

function loadAutoApplyConfig() {
  const profileDir = path.resolve(process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example'));
  return require(path.join(profileDir, 'auto-apply-config'));
}

function summarizePlan(rows) {
  const summary = { total: rows.length, eligible: 0, skipped: 0, skipReasons: {} };
  for (const row of rows) {
    if (row.canSubmit && !row.skipReason) {
      summary.eligible += 1;
      continue;
    }
    summary.skipped += 1;
    const key = row.skipReason || 'unknown';
    summary.skipReasons[key] = (summary.skipReasons[key] || 0) + 1;
  }
  return summary;
}

function formatAnswerValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value == null || value === '') return '—';
  return String(value);
}

function buildAssistReview(job, prep) {
  const questions = Array.isArray(prep?.questions) ? prep.questions : [];
  const answers = prep?.answers || {};
  const resolvedAnswers = questions
    .filter((field) => Object.prototype.hasOwnProperty.call(answers, field.name))
    .map((field) => ({
      label: field.label,
      value: formatAnswerValue(answers[field.name]),
    }));
  const unresolvedQuestions = questions
    .filter((field) => !Object.prototype.hasOwnProperty.call(answers, field.name))
    .map((field) => field.label);

  return {
    jobId: job?.id || null,
    company: job?.company || null,
    title: job?.title || null,
    score: job?.score ?? null,
    platform: job?.platform || null,
    applyComplexity: job?.apply_complexity || null,
    prepStatus: prep?.status || null,
    workflow: prep?.workflow || null,
    summary: prep?.summary || null,
    applyUrl: prep?.apply_url || job?.url || null,
    overridePath: job?.id ? require('../lib/application-overrides').overridePathForJob(job.id) : null,
    resolvedAnswers,
    unresolvedQuestions,
    submitEligible: prep?.status === 'ready',
  };
}

function printAssistReview(review) {
  console.log('');
  console.log(`${review.company} | ${review.title}`);
  console.log(`job: ${review.jobId}`);
  console.log(`score: ${review.score ?? '—'} | platform: ${review.platform || '—'} | complexity: ${review.applyComplexity || '—'}`);
  console.log(`prep: ${review.prepStatus || '—'} | workflow: ${review.workflow || '—'}`);
  console.log(`summary: ${review.summary || '—'}`);

  if (review.resolvedAnswers.length) {
    console.log('');
    console.log('Resolved answers:');
    for (const answer of review.resolvedAnswers) {
      console.log(`- ${answer.label}: ${answer.value}`);
    }
  }

  if (review.unresolvedQuestions.length) {
    console.log('');
    console.log('Manual review required for:');
    for (const label of review.unresolvedQuestions) {
      console.log(`- ${label}`);
    }
    if (review.overridePath) {
      console.log(`override file: ${review.overridePath}`);
    }
  }

  console.log('');
}

async function confirmSubmit() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question('Submit this application now? [y/N] ');
    return /^y(es)?$/i.test(String(answer || '').trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  maybeRunRemote(process.argv.slice(2), parsed.flags);

  loadDashboardEnv(path.join(__dirname, '..'));

  const { getDb } = require('../lib/db');
  const { applyOne, planAutoApply, prepareOne, run } = require('../lib/auto-applier');
  const { getApplicationPrep } = require('../lib/application-prep');
  const { listAutoApplyAttempts, summarizeAutoApplyAttempts } = require('../lib/auto-apply-receipts');

  const { flags, positionals } = parsed;
  const command = positionals[0] || 'run';
  const dryRun = Boolean(flags['dry-run']);
  const asJson = Boolean(flags.json);
  const actor = String(flags.actor || flags.source || 'manual');
  const jobId = flags.job ? String(flags.job) : null;
  const limit = parseInteger(flags.limit, null);
  const minScore = parseInteger(flags['min-score'], null);
  const maxScore = parseInteger(flags['max-score'], null);
  const days = parseInteger(flags.days, null);
  const platforms = parseCsv(flags.platforms || flags.platform);
  const scoreOrder = String(flags['score-order'] || (flags['high-score-first'] ? 'desc' : 'asc'));
  const yes = Boolean(flags.yes);

  const db = getDb();
  const config = loadAutoApplyConfig();

  let payload;
  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;

    case 'plan':
      payload = await planAutoApply(db, config, {
        jobId,
        retryFailed: Boolean(flags['retry-failed']),
        minScore,
        maxScore,
        platforms,
        includeSkipped: true,
        scoreOrder,
        refreshReadiness: Boolean(flags.refresh),
      });
      if (asJson) payload = { summary: summarizePlan(payload), rows: payload };
      else console.log(JSON.stringify(summarizePlan(payload), null, 2));
      break;

    case 'prepare':
      if (jobId) {
        payload = await prepareOne(db, config, jobId, { actor, dryRun, force: Boolean(flags.force) });
      } else {
        payload = await run(db, config, dryRun, {
          actor,
          mode: 'prepare',
          limit,
          minScore,
          maxScore,
          platforms,
          scoreOrder,
        });
      }
      break;

    case 'assist': {
      let targetJobId = jobId;
      if (!targetJobId) {
        const planRows = await planAutoApply(db, config, {
          retryFailed: Boolean(flags['retry-failed']),
          minScore,
          maxScore,
          platforms,
          includeSkipped: false,
          scoreOrder,
          refreshReadiness: true,
        });
        const nextCandidate = planRows.find((row) => row.canSubmit && !row.skipReason);
        if (!nextCandidate) throw new Error('No eligible pending jobs found for guided auto-apply');
        targetJobId = nextCandidate.jobId;
      }

      const prepResult = await prepareOne(db, config, targetJobId, {
        actor,
        dryRun,
        force: true,
      });
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(targetJobId);
      const prep = getApplicationPrep(db, targetJobId);
      const review = buildAssistReview(job, prep);

      if (asJson) {
        payload = {
          stage: review.submitEligible ? 'ready_for_review' : 'manual_review_required',
          review,
          prepResult,
        };
        if (!review.submitEligible || !yes) break;

        const submitResult = await applyOne(db, config, targetJobId, dryRun, { actor });
        payload = {
          stage: submitResult.success ? 'submitted' : 'submit_failed',
          review,
          prepResult,
          submitResult,
        };
        break;
      }

      printAssistReview(review);
      if (!review.submitEligible) {
        payload = {
          stage: 'manual_review_required',
          review,
          prepResult,
        };
        break;
      }

      const shouldSubmit = yes ? true : await confirmSubmit();
      if (!shouldSubmit) {
        payload = {
          stage: 'ready_for_review',
          review,
          prepResult,
        };
        break;
      }

      const submitResult = await applyOne(db, config, targetJobId, dryRun, { actor });
      payload = {
        stage: submitResult.success ? 'submitted' : 'submit_failed',
        review,
        prepResult,
        submitResult,
      };
      break;
    }

    case 'run':
      payload = await run(db, config, dryRun, {
        actor,
        mode: 'submit',
        limit,
        minScore,
        maxScore,
        platforms,
        retryFailed: Boolean(flags['retry-failed']),
        scoreOrder,
      });
      break;

    case 'submit':
      if (!jobId) throw new Error('submit requires --job=<job-id>');
      payload = await applyOne(db, config, jobId, dryRun, {
        actor,
        allowRetry: Boolean(flags['retry-failed']),
      });
      break;

    case 'retry':
      payload = await run(db, config, dryRun, {
        actor,
        mode: 'submit',
        retryFailed: true,
        limit,
        minScore,
        maxScore,
        platforms,
        scoreOrder,
      });
      break;

    case 'show': {
      const rows = listAutoApplyAttempts(db, {
        limit: limit || 25,
        status: flags.status ? String(flags.status) : null,
        platform: flags.platform ? String(flags.platform) : null,
        mode: flags.mode ? String(flags.mode) : null,
        minScore,
        maxScore,
        days,
        actor: flags.actor ? String(flags.actor) : null,
        failureClass: flags['failure-class'] ? String(flags['failure-class']) : null,
        jobId,
      });
      payload = {
        summary: summarizeAutoApplyAttempts(rows),
        rows: rows.map((row) => ({
          attempt_id: row.attempt_id,
          when: row.attempted_at,
          company: row.company,
          title: row.title,
          score: row.score ?? '',
          platform: row.platform || '',
          status: row.status,
          mode: row.dry_run ? 'dry-run' : row.mode,
          actor: row.actor || '',
          failure_class: row.failure_class || '',
          resume: row.resume_filename || '',
        })),
      };
      break;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }

  printOutput(payload, asJson);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
