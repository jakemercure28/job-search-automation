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
const os = require('os');

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

const { dbPath, baseDir } = require('../config/paths');
const Database = require('better-sqlite3');
const { launchBrowser, saveScreenshot, newPage, fillField, findSubmitButton, stageResume } = require('../lib/ats-appliers/browser');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('../lib/ats-appliers/page-checks');
const { fetchGreenhouseCode } = require('../lib/gmail-code');
const log = require('../lib/logger')('apply-submit');

// Keywords that signal the AI resume is a better fit
const AI_TITLE_KW = /\b(ai|ml|mlops|machine learning|llm|nlp|voice|speech|data science)\b/i;
const AI_DESC_KW  = /ai[\-\s]first|ai mindset|machine learning|mlops|large language model|\bllm\b|generative ai|ai\/ml|neural|deep learning|voice ai|speech.{0,20}(model|ai)|ai platform/i;

function pickResume(job) {
  const isAi = AI_TITLE_KW.test(job.title || '') || AI_DESC_KW.test((job.description || '').slice(0, 1500));
  return path.join(baseDir, isAi ? 'resume-ai.pdf' : 'resume.pdf');
}

function parseGreenhouseApplyTarget(job) {
  const url = job.url || '';
  const standard = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (standard) {
    return { boardToken: standard[1], jobId: standard[2] };
  }

  // Custom domains often carry Greenhouse IDs as ?gh_jid=<id>.
  const ghJid = url.match(/[?&]gh_jid=(\d+)/);
  if (ghJid) {
    const boardToken = (job.company || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
    if (!boardToken) return null;
    return { boardToken, jobId: ghJid[1] };
  }

  return null;
}

async function submitGreenhouse(page, job, applicant, answers, tmpResume) {
  const parsed = parseGreenhouseApplyTarget(job);
  if (!parsed) throw new Error(`Cannot parse Greenhouse URL: ${job.url}`);
  const { boardToken, jobId } = parsed;
  const applyUrl = `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;

  log.info('Navigating to Greenhouse apply page', { url: applyUrl });
  await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const pageIssue = detectApplicationPageIssue('greenhouse', await snapshotApplicationPage(page), {
    sourceUrl: applyUrl,
    jobId,
  });
  if (pageIssue) throw new Error(pageIssue);

  // Standard fields
  await fillFieldSafe(page, '#first_name', applicant.firstName);
  await fillFieldSafe(page, '#last_name', applicant.lastName);
  await fillFieldSafe(page, '#email', applicant.email);
  await fillFieldSafe(page, '#phone', applicant.phone);

  // Country — Greenhouse new board uses a React autocomplete text input (#country)
  const countryInput = await page.$('#country, input[id*="country"], select[id*="country"]');
  if (countryInput) {
    const tag = await countryInput.evaluate(e => e.tagName.toLowerCase());
    if (tag === 'select') {
      await countryInput.select('United States');
    } else {
      // React autocomplete: clear, type, then pick the matching option
      await countryInput.click({ clickCount: 3 });
      await countryInput.type('United States', { delay: 40 });
      await new Promise(r => setTimeout(r, 800));
      const picked = await page.evaluate(() => {
        const items = document.querySelectorAll('[role="option"], li[class*="option"]');
        for (const item of items) {
          if (item.innerText.trim().toLowerCase().includes('united states')) {
            item.click(); return true;
          }
        }
        return false;
      });
      if (!picked) log.warn('Could not select United States from country dropdown');
      else log.info('Selected country: United States');
    }
    await new Promise(r => setTimeout(r, 400));
  } else {
    log.warn('Country field not found');
  }

  // Location / City — filled later, just before submit, to prevent other interactions from clearing it

  // LinkedIn URL (standard field on many Greenhouse forms)
  const linkedinInput = await page.$('input[id*="linkedin"], input[name*="linkedin"], #linkedin');
  if (linkedinInput && applicant.linkedin) {
    await linkedinInput.click({ clickCount: 3 });
    await linkedinInput.type(applicant.linkedin, { delay: 20 });
    log.info('Filled LinkedIn URL');
  }

  // Education section (school, degree, field, year). Populate via env vars.
  if (process.env.APPLICANT_SCHOOL) {
    await fillGreenhouseEducation(page, {
      school: process.env.APPLICANT_SCHOOL,
      field: process.env.APPLICANT_FIELD_OF_STUDY || '',
      year: process.env.APPLICANT_GRAD_YEAR ? Number(process.env.APPLICANT_GRAD_YEAR) : undefined,
    });
  }

  // EEO demographic fields. Defaults to "decline to self-identify" across the board.
  // Override via APPLICANT_EEO_* env vars if you want specific answers submitted.
  await fillGreenhouseEEO(page, {
    gender: process.env.APPLICANT_EEO_GENDER || 'decline to self-identify',
    genderIdentity: process.env.APPLICANT_EEO_GENDER_IDENTITY || 'decline to answer',
    pronouns: process.env.APPLICANT_EEO_PRONOUNS || '',
    orientation: process.env.APPLICANT_EEO_ORIENTATION || 'decline to answer',
    hispanic: process.env.APPLICANT_EEO_HISPANIC || 'decline to answer',
    race: process.env.APPLICANT_EEO_RACE || 'decline to answer',
    veteran: process.env.APPLICANT_EEO_VETERAN || 'decline to answer',
    disability: process.env.APPLICANT_EEO_DISABILITY || "don't wish to answer",
  });

  // Resume upload
  const resumeInput = await page.$('#resume, input[type="file"][id*="resume"]');
  if (resumeInput) {
    await resumeInput.uploadFile(tmpResume);
    await new Promise(r => setTimeout(r, 1000));
  } else {
    throw new Error('Resume file input not found');
  }

  // Custom answers — Greenhouse fields are identified by name attribute.
  // Short single-word answers (Yes/No/etc.) are likely select dropdowns; try
  // native select first, then React custom dropdown (click container, pick option).
  for (const [fieldName, answer] of Object.entries(answers)) {
    if (!answer && answer !== 0) { log.info('Skipping empty answer', { fieldName }); continue; }
    const handled = await fillGreenhouseField(page, fieldName, answer);
    if (!handled) log.warn('Custom field not found', { fieldName });
  }

  // Second pass — re-fill any dropdown that React reset after a re-render.
  // We detect "Select..." placeholder text as a sign that the field is still empty.
  for (const [fieldName, answer] of Object.entries(answers)) {
    if (!answer && answer !== 0) continue;
    if (fieldName.endsWith('[]')) continue; // Checkboxes don't reset this way
    const isEmpty = await page.evaluate(id => {
      const el = document.getElementById(id);
      if (!el) return false;
      // Walk up to find select__control (not the input itself which has class select__input)
      const control = el.closest('[class*="select__control"]');
      if (!control) return false;
      const hasValue = control.querySelector('[class*="single-value"]');
      const placeholder = control.querySelector('[class*="placeholder"]');
      return !hasValue && !!placeholder;
    }, fieldName);
    if (isEmpty) {
      log.info('Re-filling reset dropdown', { fieldName });
      const handled = await fillGreenhouseField(page, fieldName, answer);
      if (!handled) log.warn('Re-fill failed', { fieldName });
    }
  }

  // Location / City — Google Places autocomplete on Greenhouse new board.
  // Must type a query, wait for suggestions, then click the first result.
  const locationEl = await page.$('#location, #candidate-location, input[name="location"]');
  if (locationEl && applicant.location) {
    await locationEl.click({ clickCount: 3 });
    const cityQuery = applicant.location.split(',')[0].trim();
    await locationEl.type(cityQuery, { delay: 40 });
    await new Promise(r => setTimeout(r, 1800)); // Wait for Places API suggestions
    // Click the first autocomplete suggestion (Google Places uses .pac-item or [role="option"])
    const pickedLocation = await page.evaluate((preferred) => {
      const opts = [
        ...document.querySelectorAll('.pac-item'),
        ...document.querySelectorAll('[role="option"]'),
        ...document.querySelectorAll('li[class*="suggestion"]'),
      ];
      // Prefer an option that matches the applicant's configured city
      const preferredLower = (preferred || '').toLowerCase();
      const match = preferredLower
        ? opts.find(el => el.innerText && el.innerText.toLowerCase().includes(preferredLower))
        : null;
      const target = match || opts[0];
      if (target) { target.click(); return target.innerText.trim(); }
      return null;
    }, cityQuery);
    if (pickedLocation) {
      log.info('Filled location/city via autocomplete', { selected: pickedLocation });
    } else {
      // Fallback: press ArrowDown + Enter to select first suggestion
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      log.info('Filled location/city via keyboard ArrowDown+Enter');
    }
    await new Promise(r => setTimeout(r, 400));
  }

  const submitBtn = await page.$('button[type="submit"]');
  if (!submitBtn) throw new Error('Submit button not found');

  await saveScreenshot(page, job.company, 'presubmit');
  log.info('Submitting Greenhouse form', { company: job.company });
  await submitBtn.click();
  await new Promise(r => setTimeout(r, 6000));

  // Capture page URL and any validation errors to debug failures
  const postUrl = page.url();
  log.info('Post-submit URL', { url: postUrl });

  const validationErrors = await page.evaluate(() => {
    const msgs = [];
    // Error text elements
    document.querySelectorAll('[class*="error"], [class*="invalid"], [aria-invalid="true"], .field_error').forEach(el => {
      const t = el.innerText.trim();
      if (t) msgs.push(t);
    });
    // reCAPTCHA check
    const rc = document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
    if (rc) msgs.push('reCAPTCHA present on page');
    // Any red-highlighted required fields
    document.querySelectorAll('input:invalid, select:invalid, textarea:invalid').forEach(el => {
      msgs.push(`Invalid field: ${el.name || el.id || el.type}`);
    });
    return msgs;
  });

  if (validationErrors.length > 0) {
    log.warn('Validation errors detected after submit', { errors: validationErrors });
  }

  // Handle security code flow
  const codeBoxes = await page.$$('input[maxlength="1"]');
  let usedCode = null;
  if (codeBoxes.length === 8) {
    log.info('Security code required, fetching from Gmail...');
    const code = await fetchGreenhouseCode(45000);
    if (!code) throw new Error('Security code not found in Gmail within 45s');
    usedCode = code;
    for (let i = 0; i < 8; i++) {
      await codeBoxes[i].click();
      await codeBoxes[i].type(code[i], { delay: 60 });
    }
    await new Promise(r => setTimeout(r, 500));
    const btn2 = await page.$('button[type="submit"]');
    await btn2.click();
    await new Promise(r => setTimeout(r, 8000));
  }

  return { securityCode: usedCode };
}

async function submitLever(page, job, applicant, answers, tmpResume) {
  const m = (job.url || '').match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) throw new Error(`Cannot parse Lever URL: ${job.url}`);
  const [, company, jobId] = m;
  const applyUrl = `https://jobs.lever.co/${company}/${jobId}/apply`;

  log.info('Navigating to Lever apply page', { url: applyUrl });
  await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));

  const pageIssue = detectApplicationPageIssue('lever', await snapshotApplicationPage(page), {
    sourceUrl: applyUrl,
    jobId,
  });
  if (pageIssue) throw new Error(pageIssue);

  await fillField(page, 'input[name="name"], input[placeholder*="name" i]', `${applicant.firstName} ${applicant.lastName}`);
  await fillField(page, 'input[name="email"], input[placeholder*="email" i]', applicant.email);
  await fillField(page, 'input[name="phone"], input[placeholder*="phone" i]', applicant.phone);

  const resumeInput = await page.$('input[type="file"]');
  if (resumeInput) {
    await resumeInput.uploadFile(tmpResume);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Custom answers — Lever card fields use name="cards[...][fieldN]" pattern
  // The answers JSON should map fieldName to answer text
  for (const [fieldName, answer] of Object.entries(answers)) {
    const filled = await fillField(page, `[name="${fieldName}"], [id="${fieldName}"], textarea[name*="${fieldName}"]`, answer, { delay: 20 });
    if (!filled) log.warn('Custom field not found', { fieldName });
  }

  const submitBtn = await page.$('button[type="submit"], #btn-submit, [class*="btn-submit"]');
  if (!submitBtn) throw new Error('Submit button not found');

  await saveScreenshot(page, job.company, 'presubmit');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    submitBtn.click(),
  ]);

  return {};
}

async function submitAshby(page, job, applicant, answers, tmpResume) {
  const m = (job.url || '').match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) throw new Error(`Cannot parse Ashby URL: ${job.url}`);
  const [, company, jobId] = m;
  const applyUrl = `https://jobs.ashbyhq.com/${company}/${jobId}/application`;

  log.info('Navigating to Ashby apply page', { url: applyUrl });
  await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const pageIssue = detectApplicationPageIssue('ashby', await snapshotApplicationPage(page), {
    sourceUrl: applyUrl,
    jobId,
  });
  if (pageIssue) throw new Error(pageIssue);

  await fillField(page, 'input[name="_systemfield_name"]', `${applicant.firstName} ${applicant.lastName}`);
  await fillField(page, 'input[name="_systemfield_email"]', applicant.email);
  await fillField(page, 'input[type="tel"]', applicant.phone);

  const resumeInput = await page.$('input[id="_systemfield_resume"], input[type="file"]');
  if (resumeInput) {
    await resumeInput.uploadFile(tmpResume);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Custom answers
  for (const [fieldName, answer] of Object.entries(answers)) {
    const filled = await fillField(page, `[name="${fieldName}"], [id="${fieldName}"], textarea[name*="${fieldName}"]`, answer, { delay: 20 });
    if (!filled) {
      // Ashby sometimes uses aria-label or data attributes — try by label text
      const filled2 = await page.evaluate((fn, ans) => {
        const textareas = document.querySelectorAll('textarea');
        for (const ta of textareas) {
          const label = ta.closest('[class*="field"]')?.querySelector('label');
          if (label && label.innerText.toLowerCase().includes(fn.toLowerCase())) {
            ta.focus();
            ta.value = ans;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }
        return false;
      }, fieldName, answer);
      if (!filled2) log.warn('Custom field not found by name or label', { fieldName });
    }
  }

  const submitBtn = await findSubmitButton(page);
  if (!submitBtn) throw new Error('Submit button not found');

  await saveScreenshot(page, job.company, 'presubmit');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    submitBtn.click(),
  ]);

  return {};
}

async function fillGreenhouseEducation(page, edu) {
  // Education section may be collapsed — click Add if present
  const addBtn = await page.$('button[aria-label*="education" i], button[data-action*="education" i]');
  if (addBtn) { await addBtn.click(); await new Promise(r => setTimeout(r, 800)); }

  // School autocomplete
  const schoolInput = await page.$('input[id*="school"], input[placeholder*="school" i], input[name*="school" i]');
  if (schoolInput) {
    await schoolInput.click({ clickCount: 3 });
    await schoolInput.type(edu.school, { delay: 40 });
    await new Promise(r => setTimeout(r, 1000));
    const picked = await page.evaluate((school) => {
      const items = document.querySelectorAll('[role="option"], li[class*="option"], [class*="autocomplete"] li');
      for (const item of items) {
        if (item.innerText.toLowerCase().includes(school.toLowerCase())) { item.click(); return true; }
      }
      return false;
    }, edu.school);
    if (!picked) log.warn('School autocomplete option not found', { school: edu.school });
    await new Promise(r => setTimeout(r, 500));
  }

  // Degree select
  const degreeSelect = await page.$('select[id*="degree"], select[name*="degree"]');
  if (degreeSelect) {
    const opts = await degreeSelect.evaluate(sel => Array.from(sel.options).map(o => o.text));
    const match = opts.find(o => o.toLowerCase().includes('bachelor'));
    if (match) await degreeSelect.select(match);
  }

  // Field of study
  const disciplineInput = await page.$('input[id*="discipline"], input[name*="discipline"], input[placeholder*="field of study" i]');
  if (disciplineInput) {
    await disciplineInput.click({ clickCount: 3 });
    await disciplineInput.type(edu.field, { delay: 30 });
  }

  // Graduation year
  const yearInput = await page.$('input[id*="grad"], input[name*="grad"], select[id*="grad"]');
  if (yearInput) {
    const tag = await yearInput.evaluate(e => e.tagName.toLowerCase());
    if (tag === 'select') await yearInput.select(String(edu.year));
    else { await yearInput.click({ clickCount: 3 }); await yearInput.type(String(edu.year), { delay: 30 }); }
  }

  log.info('Filled education section', edu);
}

async function fillGreenhouseEEO(page, eeo) {
  // Scan all <select> elements, match by label text keyword, pick option by keyword.
  // fieldMap is ordered so "gender identity" is checked before "gender".
  const fieldMap = [
    { labelKeys: ['gender identity'],    optKey: eeo.genderIdentity || 'man' },
    { labelKeys: ['gender'],             optKey: eeo.gender         || 'male' },
    { labelKeys: ['pronoun'],            optKey: eeo.pronouns       || 'he/him' },
    { labelKeys: ['sexual orientation'], optKey: eeo.orientation    || 'straight' },
    { labelKeys: ['hispanic', 'latino'], optKey: eeo.hispanic       || 'not hispanic' },
    { labelKeys: ['race', 'ethnicity'],  optKey: eeo.race           || 'white' },
    { labelKeys: ['veteran'],            optKey: eeo.veteran        || 'not a protected veteran' },
    { labelKeys: ['disability'],         optKey: eeo.disability     || "don't have" },
  ];

  const selects = await page.$$('select');
  for (const sel of selects) {
    const labelText = await sel.evaluate(el => {
      const id = el.id;
      if (id) { const lbl = document.querySelector(`label[for="${id}"]`); if (lbl) return lbl.innerText.trim().toLowerCase(); }
      const parent = el.closest('label, [class*="field"], [class*="form-group"]');
      if (parent) { const lbl = parent.querySelector('label'); if (lbl) return lbl.innerText.trim().toLowerCase(); }
      return '';
    });
    if (!labelText) continue;

    const rule = fieldMap.find(r => r.labelKeys.some(k => labelText.includes(k)));
    if (!rule) continue;

    const selected = await sel.evaluate((el, optKey) => {
      const match = Array.from(el.options).find(o => o.text.toLowerCase().includes(optKey.toLowerCase()));
      if (match) { el.value = match.value; el.dispatchEvent(new Event('change', { bubbles: true })); return match.text; }
      return null;
    }, rule.optKey);

    if (selected) log.info('Filled EEO field', { label: labelText, selected });
    else log.warn('EEO option not found', { label: labelText, seeking: rule.optKey });
  }
}

async function fillGreenhouseCheckboxField(page, fieldName, answer) {
  // Multi-value multi-select: fieldName ends with [] (e.g. "question_123[]").
  // Try native input[name="fieldName"], then React-style [role="checkbox"].
  const answers = Array.isArray(answer) ? answer : [answer];

  for (const ans of answers) {
    const ansLower = ans.trim().toLowerCase();

    // Native checkboxes
    const checkboxes = await page.$$(`input[name="${fieldName}"]`);
    let checked = false;
    for (const cb of checkboxes) {
      const text = await cb.evaluate(e => {
        const lbl = e.closest('label') || document.querySelector(`label[for="${e.id}"]`);
        return lbl ? lbl.innerText.trim().toLowerCase() : (e.value || '').toLowerCase();
      });
      if (text.includes(ansLower) || ansLower.includes(text)) {
        await cb.click();
        log.info('Checked native checkbox', { fieldName, answer: ans });
        checked = true; break;
      }
    }
    if (checked) continue;

    // React-style checkboxes
    const picked = await page.evaluate((a) => {
      const aLower = a.toLowerCase();
      for (const el of document.querySelectorAll('[role="checkbox"], input[type="checkbox"]')) {
        const container = el.closest('label, [class*="checkbox"], li, [class*="option"]');
        if (!container) continue;
        const t = container.innerText.trim().toLowerCase();
        if (t.includes(aLower) || aLower.includes(t.split('\n')[0])) { el.click(); return t; }
      }
      return null;
    }, ansLower);
    if (picked) log.info('Checked React checkbox', { fieldName, answer: ans, text: picked });
    else log.warn('Checkbox option not found', { fieldName, answer: ans });
  }
  return true;
}

async function fillGreenhouseField(page, fieldName, answer) {
  // Greenhouse new job board uses id="" not name="" on question fields.
  // Multi-select questions are custom React dropdowns (input[type=text] that
  // opens an option list on click). Text/textarea questions use the same id.

  // Multi-value multi-select fields have names ending with []
  if (fieldName.endsWith('[]')) {
    return fillGreenhouseCheckboxField(page, fieldName, answer);
  }

  const safeFieldName = String(fieldName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const el = await page.$(`[id="${safeFieldName}"]`);
  if (!el) {
    log.warn('Field not found by id', { fieldName });
    return false;
  }

  const tag  = await el.evaluate(e => e.tagName.toLowerCase());
  const type = await el.evaluate(e => (e.type || '').toLowerCase());

  // Textarea — just type
  if (tag === 'textarea') {
    await el.click({ clickCount: 3 });
    await el.type(answer, { delay: 20 });
    log.info('Filled textarea', { fieldName });
    return true;
  }

  // Text input: could be a plain text field OR a React dropdown trigger.
  // Try clicking to open a dropdown first; if options appear, pick one.
  if (tag === 'input' && type === 'text') {
    await el.click();
    // ArrowDown forces react-select dropdowns open even if click alone doesn't trigger them
    await page.keyboard.press('ArrowDown');
    await new Promise(r => setTimeout(r, 800));

    // Look for dropdown options that appeared.
    // Match strategy: exact first, then starts-with. This lets us pass "Yes" or "No"
    // in the answers JSON even when the option label is long (e.g. "No — full text...").
    const picked = await page.evaluate((ans) => {
      const selectors = [
        '[role="option"]',
        '[class*="option"]:not([class*="container"])',
        'li[class*="select"]',
        '[class*="dropdown"] li',
        '[class*="listbox"] li',
      ];
      const ansLower = ans.trim().toLowerCase();
      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (!items.length) continue;
        // Exact match pass
        for (const item of items) {
          if (item.innerText.trim().toLowerCase() === ansLower) {
            item.click();
            return { found: true, via: sel };
          }
        }
        // Starts-with match (handles long option labels that start with "Yes" or "No")
        for (const item of items) {
          if (item.innerText.trim().toLowerCase().startsWith(ansLower)) {
            item.click();
            return { found: true, via: `${sel} (prefix)` };
          }
        }
      }
      return { found: false };
    }, answer);

    if (picked.found) {
      log.info('Selected dropdown option', { fieldName, answer, via: picked.via });
      await new Promise(r => setTimeout(r, 700));
      return true;
    }

    // No dropdown appeared — treat as plain text input
    await el.click({ clickCount: 3 });
    await el.type(answer, { delay: 20 });
    log.info('Filled text input', { fieldName });
    return true;
  }

  // Checkbox inputs (e.g. GDPR demographic consent)
  if (tag === 'input' && type === 'checkbox') {
    const shouldCheck = typeof answer === 'boolean'
      ? answer
      : ['true', 'yes', '1', 'checked', 'agree', 'i agree'].includes(String(answer).trim().toLowerCase());

    if (!shouldCheck) return true;

    const isChecked = await el.evaluate((node) => node.checked);
    if (!isChecked) await el.click();
    log.info('Checked checkbox input', { fieldName });
    return true;
  }

  // Radio buttons (fallback)
  const safeAnswer = String(answer).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const radio = await page.$(`input[type="radio"][id="${safeFieldName}"][value="${safeAnswer}"]`);
  if (radio) { await radio.click(); return true; }

  return false;
}

async function fillFieldSafe(page, selector, value) {
  const el = await page.$(selector);
  if (!el) { log.warn('Field not found', { selector }); return; }
  await el.click({ clickCount: 3 });
  await el.type(value, { delay: 30 });
}

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
