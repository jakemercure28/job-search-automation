#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
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
    flags[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
  }

  return { flags, positionals };
}

function parseInteger(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function printUsage() {
  console.log(`Usage: node scripts/auto-apply-cli.js <command> [flags]

Commands:
  apply      Generate prep, show answers, ask for approval, then submit
  prepare    Generate prep and print the review payload without submitting
  review     Generate prep and walk unresolved answers interactively without submitting
  show       Show recent reviewed apply receipts

Common flags:
  --job=<id>           Target one job; otherwise the highest-score pending supported job is used
  --actor=<name>       Record who initiated the run (default: manual)
  --json               Emit JSON

Apply flags:
  --yes                Skip the interactive approval prompt and submit immediately
  --force              Regenerate prep even if one already exists
`);
}

function loadAutoApplyConfig() {
  const profileDir = path.resolve(process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example'));
  return require(path.join(profileDir, 'auto-apply-config'));
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

  console.log(JSON.stringify(payload, null, 2));
}

function printReview(review) {
  console.log('');
  console.log(`${review.company} | ${review.title}`);
  console.log(`job: ${review.jobId}`);
  console.log(`score: ${review.score ?? '—'} | platform: ${review.platform || '—'} | complexity: ${review.applyComplexity || '—'}`);
  console.log(`prep: ${review.prepStatus || '—'} | workflow: ${review.workflow || '—'}`);
  console.log(`apply url: ${review.applyUrl || '—'}`);
  console.log(`summary: ${review.summary || '—'}`);

  if (review.resolvedAnswers.length) {
    console.log('');
    console.log('Resolved answers:');
    for (const answer of review.resolvedAnswers) {
      console.log(`- ${answer.label}: ${answer.value}`);
    }
  }

  if (review.unresolvedFields.length) {
    console.log('');
    console.log('Unresolved fields:');
    for (const field of review.unresolvedFields) {
      console.log(`- ${field.label}${field.required ? ' (required)' : ''}`);
    }
  }

  if (review.lowConfidenceFields.length) {
    console.log('');
    console.log('Low-confidence fields left for review:');
    for (const field of review.lowConfidenceFields) {
      console.log(`- ${field.label}${field.required ? ' (required)' : ''}`);
    }
  }

  console.log('');
}

async function confirmSubmit(review) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`Submit ${review.company} | ${review.title}? [y/N] `);
    return ['y', 'yes'].includes(String(answer || '').trim().toLowerCase());
  } finally {
    rl.close();
  }
}

function buildSubmitSummary(result) {
  const verification = result?.receipt?.details?.verification || result?.details?.verification || {};
  return {
    status: result?.status || (result?.success ? 'success' : 'failed'),
    screenshotPre: verification.preSubmitScreenshot || null,
    screenshotPost: verification.postSubmitScreenshot || null,
    confirmationEmail: Boolean(verification.confirmationEmail),
    securityCode: verification.securityCode || null,
    error: result?.error || null,
    attemptId: result?.receipt?.attempt_id || null,
  };
}

function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value == null || value === '') return '';
  return String(value);
}

function uniqueReviewFields(review) {
  const seen = new Set();
  const ordered = [];

  for (const field of [...(review?.unresolvedFields || []), ...(review?.lowConfidenceFields || [])]) {
    if (!field?.name || seen.has(field.name)) continue;
    seen.add(field.name);
    ordered.push(field);
  }

  return ordered;
}

async function promptMenuSelection(rl, prompt, options) {
  while (true) {
    for (const [index, option] of options.entries()) {
      console.log(`${index + 1}. ${option.label}`);
    }

    const answer = await rl.question(prompt);
    const selected = Number.parseInt(String(answer || '').trim(), 10);
    if (Number.isInteger(selected) && selected >= 1 && selected <= options.length) {
      return options[selected - 1].value;
    }

    console.log(`Enter a number between 1 and ${options.length}.`);
  }
}

async function promptYesNo(rl, prompt, defaultYes = true) {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await rl.question(`${prompt} ${suffix} `);
  const normalized = String(answer || '').trim().toLowerCase();
  if (!normalized) return defaultYes;
  return ['y', 'yes'].includes(normalized);
}

async function promptFieldValue(rl, field, currentValue) {
  const current = formatAnswer(currentValue);

  console.log('');
  console.log(`${field.label}${field.required ? ' (required)' : ''}`);
  if (current) console.log(`Current: ${current}`);

  if (Array.isArray(field.options) && field.options.length) {
    const options = [];

    if (current) {
      options.push({ label: `Keep current: ${current}`, value: currentValue });
    }

    for (const option of field.options) {
      if (current && String(option) === current) continue;
      options.push({ label: String(option), value: option });
    }

    if (!field.required) {
      options.push({ label: 'Leave blank', value: '' });
    }

    return promptMenuSelection(rl, 'Select an option: ', options);
  }

  if (field.required) {
    while (true) {
      const prompt = current
        ? 'Enter value (press Enter to keep current): '
        : 'Enter value: ';
      const answer = await rl.question(prompt);
      if (!String(answer || '').trim()) {
        if (current) return currentValue;
        console.log('A value is required.');
        continue;
      }
      return answer;
    }
  }

  const prompt = current
    ? 'Enter value (press Enter to keep current, "-" to leave blank): '
    : 'Enter value (press Enter to leave blank): ';
  const answer = await rl.question(prompt);
  if (!String(answer || '').trim()) {
    return current || !field.required ? (current ? currentValue : '') : currentValue;
  }
  if (String(answer).trim() === '-') return '';
  return answer;
}

async function runInteractiveReview(prepared, job, actor, refreshPrepared, saveAnswers, asJson) {
  if (asJson) return { prepared, aborted: false };

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let current = prepared;

  try {
    while (!current.review.submitEligible) {
      const fields = uniqueReviewFields(current.review);
      if (!fields.length) break;

      console.log('');
      console.log('Interactive review');

      const updates = {};
      for (const field of fields) {
        const currentValue = current.prep?.answers?.[field.name];
        updates[field.name] = await promptFieldValue(rl, field, currentValue);
      }

      saveAnswers(job, current.review.applyUrl, updates, fields);
      current = await refreshPrepared();
      printReview(current.review);

      if (current.review.submitEligible) break;

      const continueReview = await promptYesNo(rl, 'Some fields still need review. Continue?', true);
      if (!continueReview) {
        return { prepared: current, aborted: true };
      }
    }

    return { prepared: current, aborted: false };
  } finally {
    rl.close();
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.remote || parsed.flags['remote-repo'] || parsed.flags['remote-node'] || parsed.flags['remote-exec']) {
    throw new Error('Remote apply execution has been removed. Run the reviewed apply CLI on the local MacBook checkout.');
  }

  loadDashboardEnv(path.join(__dirname, '..'));

  const { getDb } = require('../lib/db');
  const { prepareOne, submitOne, findNextApplyJob } = require('../lib/auto-applier');
  const { listAutoApplyAttempts } = require('../lib/auto-apply-receipts');
  const { upsertApplicationOverrides } = require('../lib/application-overrides');

  const { flags, positionals } = parsed;
  const command = positionals[0] || 'apply';
  const asJson = Boolean(flags.json);
  const actor = String(flags.actor || flags.source || 'manual');
  const explicitJobId = flags.job ? String(flags.job) : null;

  if (['help', '--help', '-h'].includes(command)) {
    printUsage();
    return;
  }

  const db = getDb();
  const config = loadAutoApplyConfig();
  const selectedJob = explicitJobId
    ? db.prepare('SELECT * FROM jobs WHERE id = ?').get(explicitJobId)
    : findNextApplyJob(db, config);

  if ((command === 'apply' || command === 'prepare' || command === 'review') && !selectedJob) {
    throw new Error('No eligible pending supported jobs found');
  }

  switch (command) {
    case 'prepare': {
      const result = await prepareOne(db, config, selectedJob.id, {
        actor,
        force: Boolean(flags.force),
      });
      if (!asJson) printReview(result.review);
      printOutput(result, asJson);
      return;
    }

    case 'review': {
      let prepared = await prepareOne(db, config, selectedJob.id, {
        actor,
        force: Boolean(flags.force),
      });
      if (!asJson) printReview(prepared.review);

      if (!prepared.success) {
        printOutput(prepared, asJson);
        process.exit(1);
      }

      const reviewed = await runInteractiveReview(
        prepared,
        selectedJob,
        actor,
        () => prepareOne(db, config, selectedJob.id, { actor, force: true }),
        (job, applyUrl, updates, fields) => upsertApplicationOverrides(job, applyUrl, updates, fields),
        asJson
      );
      prepared = reviewed.prepared;
      printOutput(prepared, asJson);
      if (reviewed.aborted && !prepared.review.submitEligible) process.exit(1);
      return;
    }

    case 'apply': {
      let prepared = await prepareOne(db, config, selectedJob.id, {
        actor,
        force: Boolean(flags.force),
      });
      if (!asJson) printReview(prepared.review);

      if (!prepared.success) {
        printOutput(prepared, asJson);
        process.exit(1);
      }

      if (!prepared.review.submitEligible) {
        if (asJson) {
          const result = {
            success: false,
            status: 'failed',
            error: 'Manual review required before submit. Run `review` or fill the missing answers and rerun apply.',
            review: prepared.review,
            receipt: prepared.receipt,
          };
          printOutput(result, asJson);
          process.exit(1);
        }

        const reviewed = await runInteractiveReview(
          prepared,
          selectedJob,
          actor,
          () => prepareOne(db, config, selectedJob.id, { actor, force: true }),
          (job, applyUrl, updates, fields) => upsertApplicationOverrides(job, applyUrl, updates, fields),
          asJson
        );
        prepared = reviewed.prepared;

        if (!prepared.review.submitEligible) {
          const result = {
            success: false,
            status: reviewed.aborted ? 'aborted' : 'failed',
            error: 'Manual review required before submit. Review the remaining answers and rerun apply.',
            review: prepared.review,
            receipt: prepared.receipt,
          };
          printOutput(result, asJson);
          process.exit(1);
        }
      }

      const approved = flags.yes ? true : await confirmSubmit(prepared.review);
      if (!approved) {
        const result = {
          success: false,
          status: 'aborted',
          review: prepared.review,
          message: 'Submission aborted before submit.',
          receipt: prepared.receipt,
        };
        printOutput(result, asJson);
        return;
      }

      const submitted = await submitOne(db, config, selectedJob.id, { actor });
      const payload = {
        ...submitted,
        verification: buildSubmitSummary(submitted),
      };
      printOutput(payload, asJson);
      if (!submitted.success) process.exit(1);
      return;
    }

    case 'show': {
      const limit = parseInteger(flags.limit, 25) || 25;
      const rows = listAutoApplyAttempts(db, {
        limit,
        jobId: explicitJobId,
        status: flags.status ? String(flags.status) : null,
        mode: 'submit',
        actor: flags.actor ? String(flags.actor) : null,
      }).map((row) => ({
        attempt_id: row.attempt_id,
        when: row.attempted_at,
        company: row.company,
        title: row.title,
        status: row.status,
        actor: row.actor || '',
        email_confirmed: row.details?.verification?.confirmationEmail ? 'yes' : 'no',
        post_screenshot: row.details?.verification?.postSubmitScreenshot || '',
        error: row.display_error || row.error || '',
      }));
      printOutput(rows, asJson);
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
