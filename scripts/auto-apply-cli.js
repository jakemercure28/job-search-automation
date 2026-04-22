#!/usr/bin/env node
'use strict';

const path = require('path');
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

function loadAutoApplyConfig() {
  const profileDir = path.resolve(process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example'));
  return require(path.join(profileDir, 'auto-apply-config'));
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  maybeRunRemote(process.argv.slice(2), parsed.flags);

  loadDashboardEnv(path.join(__dirname, '..'));

  const { getDb } = require('../lib/db');
  const { applyOne, planAutoApply, prepareOne, run } = require('../lib/auto-applier');
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

  const db = getDb();
  const config = loadAutoApplyConfig();

  let payload;
  switch (command) {
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
