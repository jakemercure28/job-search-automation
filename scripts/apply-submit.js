#!/usr/bin/env node
/**
 * scripts/apply-submit.js <job-id> <answers-json-path>
 *
 * Fill and submit a job application using Claude-generated answers.
 * Handles standard fields automatically. Custom answers come from the JSON file.
 * Used by the /apply Claude skill after answer review.
 *
 * Usage:
 *   node scripts/apply-submit.js greenhouse-123456 /tmp/apply-answers-greenhouse-123456.json
 *
 * Answers JSON format (fieldName -> answer text):
 *   { "how_did_you_hear": "...", "why_us": "..." }
 *
 * Set APPLY_HEADED=1 in env to run with a visible browser window.
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Load environment from .env and profiles/example/.env
function loadEnv() {
  const envFiles = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'profiles', 'example', '.env'),
  ];
  for (const f of envFiles) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
loadEnv();

const { dbPath } = require('../config/paths');
const Database = require('better-sqlite3');
const { launchBrowser, saveScreenshot, newPage, stageResume } = require('../lib/ats-appliers/browser');
const { pickResume } = require('../lib/apply/shared');
const { submitGreenhouse } = require('../lib/apply/greenhouse');
const { submitLever } = require('../lib/apply/lever');
const { submitAshby } = require('../lib/apply/ashby');
const log = require('../lib/logger')('apply-submit');

async function main() {
  const jobId = process.argv[2];
  const answersPath = process.argv[3];

  if (!jobId || !answersPath) {
    console.error('Usage: node scripts/apply-submit.js <job-id> <answers-json-path>');
    process.exit(1);
  }

  const db = new Database(dbPath);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  const answers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
  const platform = jobId.split('-')[0].toLowerCase();

  const applicant = {
    firstName: process.env.APPLICANT_FIRST_NAME || '',
    lastName:  process.env.APPLICANT_LAST_NAME  || '',
    email:     process.env.APPLICANT_EMAIL,
    phone:     process.env.APPLICANT_PHONE,
    linkedin:  process.env.APPLICANT_LINKEDIN   || '',
    location:  process.env.APPLICANT_CITY || process.env.APPLICANT_LOCATION || '',
  };

  if (!applicant.email) { console.error('APPLICANT_EMAIL not set'); process.exit(1); }
  if (!applicant.phone) { console.error('APPLICANT_PHONE not set'); process.exit(1); }

  const resumeAbsPath = pickResume(job);
  if (!fs.existsSync(resumeAbsPath)) {
    console.error(`Resume not found: ${resumeAbsPath}`);
    process.exit(1);
  }

  const displayNameInit = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ');
  const tmpResume = stageResume(resumeAbsPath, displayNameInit ? `${displayNameInit} Resume` : undefined);
  const headed = process.env.APPLY_HEADED === '1';
  let browser;

  try {
    browser = await launchBrowser({ headless: !headed });
    const page = await newPage(browser);

    log.info('Starting apply-submit', { company: job.company, title: job.title, platform, headed });

    let extra = {};
    if (platform === 'greenhouse') {
      extra = await submitGreenhouse(page, job, applicant, answers, tmpResume);
    } else if (platform === 'lever') {
      extra = await submitLever(page, job, applicant, answers, tmpResume);
    } else if (platform === 'ashby') {
      extra = await submitAshby(page, job, applicant, answers, tmpResume);
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    // Always take a post-submit screenshot so we can verify what happened
    const postScreenshot = await saveScreenshot(page, job.company, 'postsubmit');
    log.info('Post-submit screenshot saved', { path: postScreenshot });

    const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const successPhrases = ['thank you', 'application received', 'successfully submitted', "we've received", 'application submitted', 'we have received', 'application has been'];
    const isSuccess = successPhrases.some(p => pageText.toLowerCase().includes(p));

    if (!isSuccess) {
      throw new Error(`No success confirmation found after submit. Check screenshot: ${postScreenshot}`);
    }

    // Resume is uploaded via stageResume() with a display name based on applicant.
    const displayName = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ');
    const uploadedFilename = displayName ? `${displayName} Resume.pdf` : 'Resume.pdf';

    // Update DB
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jobs SET
        auto_applied_at   = ?,
        auto_apply_status = 'success',
        auto_apply_error  = NULL,
        status            = 'applied',
        applied_at        = CASE WHEN applied_at IS NULL THEN ? ELSE applied_at END,
        stage             = 'applied',
        updated_at        = datetime('now')
      WHERE id = ?
    `).run(now, now, job.id);

    db.prepare(`
      INSERT INTO auto_apply_log (job_id, attempted_at, status, resume_filename, security_code, dry_run)
      VALUES (?, ?, 'success', ?, ?, 0)
    `).run(job.id, now, uploadedFilename, extra.securityCode || null);

    const result = { success: true, company: job.company, title: job.title, resumeUsed: path.basename(resumeAbsPath), ...extra };
    console.log(JSON.stringify(result, null, 2));
    log.info('Application submitted successfully', { company: job.company, title: job.title, resume: path.basename(resumeAbsPath) });

  } catch (e) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE jobs SET auto_apply_status = 'failed', auto_apply_error = ?, updated_at = datetime('now') WHERE id = ?
    `).run(e.message, job.id);

    db.prepare(`
      INSERT INTO auto_apply_log (job_id, attempted_at, status, error, resume_filename, dry_run)
      VALUES (?, ?, 'failed', ?, ?, 0)
    `).run(job.id, now, e.message, path.basename(resumeAbsPath || ''));

    const result = { success: false, error: e.message, company: job.company, title: job.title };
    console.log(JSON.stringify(result, null, 2));
    log.error('Application submission failed', { company: job.company, error: e.message });
    process.exit(1);

  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(tmpResume); } catch {}
    db.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
