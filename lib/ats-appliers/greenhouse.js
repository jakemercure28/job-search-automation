'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser, saveScreenshot, getIncompleteRequiredFields, newPage, stageResume, hasDuplicateSubmissionMessage, hasAbuseWarningMessage } = require('./browser');
const { waitForApplicationConfirmation } = require('../gmail-code');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('./page-checks');
const { fetchGreenhouseCode } = require('../gmail-code');
const { preflightApplicant } = require('./preflight');
const log = require('../logger')('auto-apply');

// Pattern-matched answers for common Greenhouse application questions.
// Extend this list with your own company-specific or role-specific answers.
// Identity fields (linkedin, github, location) are filled from the applicant config below.
const SIMPLE_GREENHOUSE_QUESTION_RULES = [
  { pattern: /visa sponsorship|require sponsorship/i, answer: () => 'No' },
  { pattern: /u\.s\. work authorization/i, answer: () => 'Yes' },
  { pattern: /authorized to work|legally authorized|work authorization/i, answer: () => 'Yes' },
  { pattern: /country/i, answer: () => 'United States' },
  { pattern: /current location|location/i, answer: (applicant) => applicant.location || 'United States' },
  { pattern: /linkedin/i, answer: (applicant) => applicant.linkedin || null },
  { pattern: /github/i, answer: (applicant) => applicant.github || null },
  { pattern: /portfolio|website/i, answer: (applicant) => applicant.github || applicant.linkedin || null },
  { pattern: /current company|current employer|company/i, answer: (applicant) => applicant.currentCompany || null },
  { pattern: /how did you hear/i, answer: () => 'LinkedIn' },
];

/**
 * Extract Greenhouse board token and numeric job ID from a job URL or record.
 */
function parseGreenhouseUrl(url, job) {
  // Standard board URL: boards.greenhouse.io or job-boards.greenhouse.io
  const m = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) return { boardToken: m[1], jobId: m[2] };

  // Custom domain with ?gh_jid= param
  const ghJid = url.match(/[?&]gh_jid=(\d+)/);
  if (ghJid) {
    const jobId = ghJid[1];
    const boardToken = (job.company || '').toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
    return { boardToken, jobId };
  }

  return null;
}

async function fetchGreenhouseQuestions(boardToken, jobId) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}?questions=true`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.questions) ? data.questions : [];
  } catch {
    return [];
  }
}

function answerForGreenhouseQuestion(label, applicant) {
  const text = String(label || '').trim();
  const rule = SIMPLE_GREENHOUSE_QUESTION_RULES.find(({ pattern }) => pattern.test(text));
  if (!rule) return null;
  return typeof rule.answer === 'function' ? rule.answer(applicant) : rule.answer;
}

async function fillGreenhouseEEO(page) {
  const fieldMap = [
    { labelKeys: ['gender identity'],    optKey: 'man' },
    { labelKeys: ['gender'],             optKey: 'male' },
    { labelKeys: ['pronoun'],            optKey: 'he/him' },
    { labelKeys: ['sexual orientation'], optKey: 'straight' },
    { labelKeys: ['hispanic', 'latino'], optKey: 'not hispanic' },
    { labelKeys: ['race', 'ethnicity'],  optKey: 'white' },
    { labelKeys: ['veteran'],            optKey: 'not a protected veteran' },
    { labelKeys: ['disability'],         optKey: "don't have" },
  ];

  const selects = await page.$$('select');
  for (const sel of selects) {
    const labelText = await sel.evaluate(el => {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) return lbl.innerText.trim().toLowerCase();
      }
      const parent = el.closest('label, [class*="field"], [class*="form-group"]');
      if (parent) {
        const lbl = parent.querySelector('label');
        if (lbl) return lbl.innerText.trim().toLowerCase();
      }
      return '';
    });
    if (!labelText) continue;

    const rule = fieldMap.find(entry => entry.labelKeys.some(key => labelText.includes(key)));
    if (!rule) continue;

    await sel.evaluate((el, optKey) => {
      const match = Array.from(el.options).find(option => option.text.toLowerCase().includes(optKey.toLowerCase()));
      if (!match) return false;
      el.value = match.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, rule.optKey);
  }
}

async function fillGreenhouseCheckboxField(page, fieldName, answer) {
  const answers = Array.isArray(answer) ? answer : [answer];

  for (const rawAnswer of answers) {
    const desired = String(rawAnswer || '').trim().toLowerCase();
    const checkboxes = await page.$$(`input[name="${fieldName}"]`);
    for (const checkbox of checkboxes) {
      const text = await checkbox.evaluate(el => {
        const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
        return label ? label.innerText.trim().toLowerCase() : (el.value || '').toLowerCase();
      });
      if (text.includes(desired) || desired.includes(text)) {
        await checkbox.click();
        break;
      }
    }
  }

  return true;
}

async function fillGreenhouseChoiceField(page, fieldName, answer) {
  const choices = await page.$$(`input[name="${fieldName}"]`);
  const desired = String(answer || '').trim().toLowerCase();

  for (const choice of choices) {
    const labelText = await choice.evaluate((el) => {
      const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
      return label ? label.innerText.trim().toLowerCase() : (el.value || '').toLowerCase();
    });
    if (!labelText) continue;
    if (labelText.includes(desired) || desired.includes(labelText)) {
      await choice.click();
      return true;
    }
  }

  return false;
}

async function fillGreenhouseField(page, fieldName, answer) {
  if (fieldName.endsWith('[]')) {
    return fillGreenhouseCheckboxField(page, fieldName, answer);
  }

  const safeFieldName = String(fieldName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let el = await page.$(`[id="${safeFieldName}"]`);
  if (!el) {
    el = await page.$(`[name="${safeFieldName}"]`);
  }
  if (!el) {
    const choiceFilled = await fillGreenhouseChoiceField(page, safeFieldName, answer);
    if (choiceFilled) return true;
  }
  if (!el) return false;

  const tag = await el.evaluate(node => node.tagName.toLowerCase());
  const type = await el.evaluate(node => (node.type || '').toLowerCase());

  async function chooseComboboxOption() {
    await new Promise(r => setTimeout(r, 800));

    const picked = await page.evaluate((desired) => {
      const answerText = desired.trim().toLowerCase();
      const selectors = [
        '[role="option"]',
        '[class*="option"]:not([class*="container"])',
        'li[class*="select"]',
        '[class*="dropdown"] li',
        '[class*="listbox"] li',
      ];

      for (const selector of selectors) {
        const items = document.querySelectorAll(selector);
        if (!items.length) continue;

        for (const item of items) {
          const text = item.innerText.trim().toLowerCase();
          if (text === answerText || text.startsWith(answerText) || answerText.startsWith(text)) {
            item.click();
            return true;
          }
        }
      }

      return false;
    }, String(answer));

    if (picked) {
      await page.keyboard.press('Tab').catch(() => {});
      await new Promise(r => setTimeout(r, 500));
      return true;
    }

    await page.keyboard.press('ArrowDown').catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await page.keyboard.press('Tab').catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    return true;
  }

  if (tag === 'textarea') {
    await el.click({ clickCount: 3 });
    await el.type(String(answer), { delay: 20 });
    return true;
  }

  if (tag === 'select') {
    const selected = await el.evaluate((node, desiredAnswer) => {
      const desired = String(desiredAnswer || '').trim().toLowerCase();
      const option = Array.from(node.options).find((candidate) => {
        const text = candidate.textContent.trim().toLowerCase();
        return text === desired || text.includes(desired) || desired.includes(text);
      });
      if (!option) return false;
      node.value = option.value;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, String(answer));
    return selected;
  }

  if (tag === 'input' && type === 'text') {
    await el.click({ clickCount: 3 });
    await el.type(String(answer), { delay: 20 });
    return chooseComboboxOption();
  }

  if (tag === 'input' && type === 'checkbox') {
    const shouldCheck = ['true', 'yes', '1', 'checked', 'agree', 'i agree'].includes(String(answer).trim().toLowerCase());
    if (!shouldCheck) return true;
    const isChecked = await el.evaluate(node => node.checked);
    if (!isChecked) await el.click();
    return true;
  }

  return false;
}

/**
 * Submit a Greenhouse application via headless Chrome.
 * Opens the job board URL, fills in the standard fields, uploads resume, submits.
 *
 * @param {object} job        - job row from DB
 * @param {object} applicant  - { firstName, lastName, email, phone, resumePath }
 * @param {boolean} dryRun    - if true, log what would happen without submitting
 * @returns {Promise<{ success: boolean, error?: string, securityCode?: string }>}
 */
async function applyGreenhouse(job, applicant, dryRun = false, draftedAnswers = {}) {
  const parsed = parseGreenhouseUrl(job.url, job);
  if (!parsed) {
    return { success: false, error: `Cannot parse Greenhouse URL: ${job.url}` };
  }
  const { boardToken, jobId } = parsed;
  const applyUrl = `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;

  if (dryRun) {
    log.info('[DRY RUN] Would apply to Greenhouse job', {
      company: job.company, title: job.title, boardToken, jobId,
      resume: applicant.resumePath,
    });
    return { success: true };
  }

  const pre = preflightApplicant(applicant);
  if (!pre.ok) return { success: false, error: pre.error };
  const { resumeAbsPath } = pre;

  const tmpResume = stageResume(resumeAbsPath);
  let browser;
  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    log.info('Opening Greenhouse job page', { company: job.company, url: applyUrl });
    await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extra wait for React to fully render the form
    await new Promise(r => setTimeout(r, 2000));

    const pageIssue = detectApplicationPageIssue('greenhouse', await snapshotApplicationPage(page), {
      sourceUrl: applyUrl,
      jobId,
    });
    if (pageIssue) {
      return { success: false, error: pageIssue };
    }

    // Greenhouse new job board uses element IDs directly
    await typeInto(page, '#first_name', applicant.firstName);
    await typeInto(page, '#last_name', applicant.lastName);
    await typeInto(page, '#email', applicant.email);

    // Phone: uses intl-tel-input — type number directly, US is default country
    await typeInto(page, '#phone', applicant.phone);

    // Country: type "United States" if the field exists and is empty
    const countryInput = await page.$('#country');
    if (countryInput) {
      const countryVal = await page.evaluate(el => el.value, countryInput);
      if (!countryVal) {
        await fillGreenhouseField(page, 'country', 'United States');
      }
    }

    const linkedinInput = await page.$('input[id*="linkedin"], input[name*="linkedin"], #linkedin');
    if (linkedinInput && applicant.linkedin) {
      await linkedinInput.click({ clickCount: 3 });
      await linkedinInput.type(applicant.linkedin, { delay: 20 });
    }

    await fillGreenhouseEEO(page);

    const questions = await fetchGreenhouseQuestions(boardToken, jobId);
    for (const question of questions) {
      for (const field of (question.fields || [])) {
        const answer = answerForGreenhouseQuestion(question.label, applicant) ?? draftedAnswers[field.name];
        if (answer == null) continue;
        const filled = await fillGreenhouseField(page, field.name, answer);
        if (filled) break;
      }
    }

    // Upload resume using clean filename
    const resumeInput = await page.$('#resume, input[type="file"][id*="resume"]');
    if (resumeInput) {
      await resumeInput.uploadFile(tmpResume);
      log.info('Resume uploaded');
      await new Promise(r => setTimeout(r, 1000));
    } else {
      return { success: false, error: 'Resume file input not found' };
    }

    // Submit
    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      return { success: false, error: 'Submit button not found' };
    }

    const incompleteFields = await getIncompleteRequiredFields(page);
    if (incompleteFields.length) {
      const incompleteScreenshot = await saveScreenshot(page, job, 'incomplete');
      return {
        success: false,
        error: `Required fields still empty before submit: ${incompleteFields.join(', ')}. Check screenshot: ${incompleteScreenshot}`,
      };
    }

    const submissionStartedAt = Date.now();
    await saveScreenshot(page, job, 'presubmit');
    log.info('Submitting form', { company: job.company });
    await submitBtn.click();
    await new Promise(r => setTimeout(r, 6000));

    // Check if security code boxes appeared (Greenhouse sent a verification code)
    const codeBoxes = await page.$$('input[maxlength="1"]');
    let usedCode = null;
    if (codeBoxes.length === 8) {
      log.info('Security code required — fetching from Gmail...', { company: job.company });
      const code = await fetchGreenhouseCode(45000);
      if (!code) {
        return { success: false, error: 'Security code not found in Gmail within 45s' };
      }
      usedCode = code;
      log.info('Got security code, entering...', { code });
      for (let i = 0; i < 8; i++) {
        await codeBoxes[i].click();
        await codeBoxes[i].type(code[i], { delay: 60 });
      }
      await new Promise(r => setTimeout(r, 500));
      const submitBtn2 = await page.$('button[type="submit"]');
      await submitBtn2.click();
      await new Promise(r => setTimeout(r, 8000));
    }

    const postScreenshot = await saveScreenshot(page, job, 'postsubmit');

    const pageText = await page.evaluate(() => document.body.innerText);
    const successPhrases = ['thank you', 'application received', 'successfully submitted', 'we have received', 'application has been'];
    const isSuccess = successPhrases.some(p => pageText.toLowerCase().includes(p));
    const isDuplicate = hasDuplicateSubmissionMessage(pageText);
    const isAbuseWarning = hasAbuseWarningMessage(pageText);

    // Also check if code boxes are gone and no error is shown
    const codeBoxesStillThere = (await page.$$('input[maxlength="1"]')).length === 8;
    const errorText = await page.$('text=Incorrect security code, [class*="error"]').catch(() => null);

    if (errorText || codeBoxesStillThere) {
      return { success: false, error: 'Security code rejected or still showing' };
    }

    if (isAbuseWarning) {
      return {
        success: false,
        haltRun: true,
        error: `Abuse warning detected after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    if (!isSuccess && !isDuplicate) {
      return { success: false, error: `No success confirmation found after submit. Check screenshot: ${postScreenshot}` };
    }

    if (isDuplicate) {
      log.info('Existing application confirmed on Greenhouse', { company: job.company, title: job.title });
    }

    const confirmationEmail = await waitForApplicationConfirmation(job, { startedAt: submissionStartedAt });
    if (!confirmationEmail) {
      return { success: false, error: `No application confirmation email found after submit. Check screenshot: ${postScreenshot}` };
    }

    log.info('Applied via Greenhouse', { company: job.company, title: job.title, hadSecurityCode: !!usedCode });
    return { success: true, securityCode: usedCode };

  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(tmpResume); } catch {}
  }
}

async function typeInto(page, selector, value) {
  const el = await page.$(selector);
  if (!el) { log.warn('Field not found', { selector }); return false; }
  await el.click({ clickCount: 3 });
  await el.type(value, { delay: 30 });
  return true;
}

module.exports = { applyGreenhouse };
