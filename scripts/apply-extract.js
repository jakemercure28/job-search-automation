#!/usr/bin/env node
/**
 * scripts/apply-extract.js <job-id>
 *
 * Extract custom application questions from a job's apply page.
 * Outputs JSON to stdout. Used by the /apply Claude skill.
 *
 * Usage: node scripts/apply-extract.js greenhouse-123456
 *        node scripts/apply-extract.js ashby-abc123...
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
const { launchBrowser, saveScreenshot, newPage } = require('../lib/ats-appliers/browser');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('../lib/ats-appliers/page-checks');

// System fields we don't need to extract as "questions"
const STANDARD_NAME_PATTERNS = [
  /^_systemfield_/, /^first[_\s]?name$/i, /^last[_\s]?name$/i, /^full[_\s]?name$/i,
  /^name$/i, /^email$/i, /^phone$/i, /^resume$/i, /^cover[_\s]?letter$/i,
  /^linkedin/i, /^github/i, /^portfolio/i, /^website/i, /^location$/i,
];

function isStandardField(name, label) {
  // Custom Greenhouse question IDs (question_XXXXXXXXX) are never standard,
  // even if their label says "LinkedIn" or "Website" — they need explicit answers.
  if (/^question_\d+$/i.test(name)) return false;
  const combined = `${name} ${label}`.toLowerCase();
  if (STANDARD_NAME_PATTERNS.some(p => p.test(name))) return true;
  if (/resume|cv|cover letter|linkedin|github|portfolio|website/i.test(combined)) return true;
  return false;
}

async function extractGreenhouse(job) {
  // Use Greenhouse questions API for structured data
  const url = String(job.url || '');
  const jobIdMatch = url.match(/\/jobs\/(\d+)/) || url.match(/[?&]gh_jid=(\d+)/);
  const jobId = jobIdMatch ? jobIdMatch[1] : job.id.replace('greenhouse-', '');
  const urlMatch = url.match(/greenhouse\.io\/([^/]+)\/jobs\/\d+/);
  const company = urlMatch ? urlMatch[1] : (job.company || '').toLowerCase().replace(/\s+/g, '');
  if (!company || !jobId) return [];

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}?questions=true`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const data = await res.json();
  const questions = data.questions || [];

  const custom = [];
  for (const q of questions) {
    for (const field of (q.fields || [])) {
      if (isStandardField(field.name, q.label || '')) continue;
      custom.push({
        label: q.label || field.name,
        name: field.name,
        type: field.type || 'input_text',
        required: !!q.required,
        options: (field.values || []).map(v => v.label || v.name || String(v)),
      });
    }
  }
  return custom;
}

function buildGreenhouseApplyUrl(job) {
  const match = (job.url || '').match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (!match) return job.url;
  const [, boardToken, jobId] = match;
  return `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;
}

async function extractFromDom(page, job) {
  await new Promise(r => setTimeout(r, 2000));

  // Extract all labeled form fields from the DOM
  const fields = await page.evaluate(() => {
    const results = [];
    const labels = document.querySelectorAll('label');

    for (const label of labels) {
      const forId = label.htmlFor;
      let input = null;

      if (forId) {
        input = document.getElementById(forId);
      }
      if (!input) {
        input = label.querySelector('input, textarea, select');
      }
      if (!input) {
        const next = label.nextElementSibling;
        if (next && ['INPUT', 'TEXTAREA', 'SELECT'].includes(next.tagName)) {
          input = next;
        }
      }
      if (!input) continue;

      const labelText = label.innerText.trim().replace(/\s+/g, ' ');
      const name = input.name || input.id || '';
      const type = input.tagName === 'TEXTAREA' ? 'textarea'
        : input.tagName === 'SELECT' ? 'select'
        : (input.type || 'text');
      const required = input.required || label.querySelector('[aria-required="true"]') !== null;

      const options = type === 'select'
        ? Array.from(input.options).map(o => o.text).filter(t => t && t !== '--')
        : [];

      results.push({ labelText, name, type, required, options });
    }
    return results;
  });

  return fields;
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node scripts/apply-extract.js <job-id>');
    process.exit(1);
  }

  const db = new Database(dbPath);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exit(1);
  }

  console.error(`Extracting questions for: ${job.company} — ${job.title}`);
  console.error(`Apply URL: ${job.url}`);

  const lowerPlatform = String(job.platform || '').toLowerCase();
  const lowerUrl = String(job.url || '').toLowerCase();
  const platform = lowerPlatform.includes('greenhouse') || lowerUrl.includes('greenhouse')
    ? 'greenhouse'
    : jobId.split('-')[0].toLowerCase();
  let customFields = [];
  let pageIssue = null;
  let shouldFallbackToDom = true;

  if (platform === 'greenhouse') {
    try {
      customFields = await extractGreenhouse(job);
      console.error(`Greenhouse API returned ${customFields.length} custom fields`);
      shouldFallbackToDom = false;
    } catch (e) {
      console.error(`Greenhouse API failed: ${e.message}, falling back to DOM`);
      customFields = null;
    }
  }

  // For Lever, Ashby, or Greenhouse API fallback: use DOM inspection
  if (platform === 'greenhouse' && Array.isArray(customFields) && customFields.length === 0) {
    let browser;
    try {
      browser = await launchBrowser();
      const page = await newPage(browser);
      const applyUrl = buildGreenhouseApplyUrl(job);
      console.error(`Validating Greenhouse page: ${applyUrl}`);
      await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));
      const snapshot = await snapshotApplicationPage(page);
      pageIssue = detectApplicationPageIssue('greenhouse', snapshot, {
        sourceUrl: applyUrl,
        jobId: job.id.replace(/^greenhouse-/, ''),
      });
      if (pageIssue) {
        console.error(`Page issue detected: ${pageIssue}`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  if (shouldFallbackToDom || customFields === null) {
    let applyUrl = job.url;
    if (platform === 'greenhouse') {
      applyUrl = buildGreenhouseApplyUrl(job);
    } else if (platform === 'lever') {
      const m = job.url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
      if (m) applyUrl = `https://jobs.lever.co/${m[1]}/${m[2]}/apply`;
    } else if (platform === 'ashby') {
      const m = job.url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
      if (m) applyUrl = `https://jobs.ashbyhq.com/${m[1]}/${m[2]}/application`;
    }

    let browser;
    try {
      browser = await launchBrowser();
      const page = await newPage(browser);
      console.error(`Navigating to: ${applyUrl}`);
      await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      const screenshotFile = await saveScreenshot(page, job.company, 'extract');
      console.error(`Screenshot saved: ${screenshotFile}`);

      const snapshot = await snapshotApplicationPage(page);
      pageIssue = detectApplicationPageIssue(platform, snapshot, {
        sourceUrl: applyUrl,
        jobId: platform === 'greenhouse' ? job.id.replace(/^greenhouse-/, '') : job.id,
      });
      if (pageIssue) {
        console.error(`Page issue detected: ${pageIssue}`);
        customFields = [];
      } else {
        const allFields = await extractFromDom(page, job);
        customFields = allFields.filter(f => !isStandardField(f.name, f.labelText));
        console.error(`DOM extracted ${allFields.length} total fields, ${customFields.length} custom`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  // Output structured result
  const result = {
    jobId: job.id,
    company: job.company,
    title: job.title,
    platform,
    applyUrl: job.url,
    customFields,
    pageIssue,
  };

  console.log(JSON.stringify(result, null, 2));
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
