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

Flags:
  --job=<id>           Target one job for prep/resume/show
  --status=<status>    Filter list by job status
  --company=<text>     Filter list by company substring
  --title=<text>       Filter list by title substring
  --min-score=<n>      Filter list by minimum score
  --limit=<n>          Limit list output (default: 25)
  --force              Regenerate prep or tailored resume
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

async function main(argv = process.argv.slice(2)) {
  const { flags, positionals } = parseArgs(argv);
  const command = positionals[0] || 'list';

  if (['help', '--help', '-h'].includes(command)) {
    printUsage();
    return;
  }

  loadDashboardEnv(path.join(__dirname, '..'));

  const { getDb } = require('../lib/db');
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
