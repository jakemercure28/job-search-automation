'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser, saveScreenshot, getIncompleteRequiredFields, newPage, fillField, stageResume, hasDuplicateSubmissionMessage, hasAbuseWarningMessage } = require('./browser');
const { waitForApplicationConfirmation } = require('../gmail-code');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('./page-checks');
const { preflightApplicant } = require('./preflight');
const log = require('../logger')('auto-apply');

async function fillLeverLabeledField(page, labels, value) {
  if (!value) return false;
  return page.evaluate((labelHints, fieldValue) => {
    function normalize(text) {
      return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function labelFor(node) {
      if (node.id) {
        const explicit = document.querySelector(`label[for="${node.id}"]`);
        if (explicit?.innerText) return explicit.innerText.trim();
      }
      const wrappingLabel = node.closest('label');
      if (wrappingLabel?.innerText) return wrappingLabel.innerText.trim();
      const group = node.closest('.application-field, .application-question, [class*="field"], [class*="question"], [class*="form"]');
      const explicit = group?.querySelector('label, legend');
      return explicit?.innerText?.trim() || '';
    }

    const hints = labelHints.map(normalize);
    const fields = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((node) => isVisible(node) && !['hidden', 'file', 'submit', 'button'].includes((node.type || '').toLowerCase()));

    const target = fields.find((node) => {
      const haystack = normalize([
        labelFor(node),
        node.name || '',
        node.id || '',
        node.getAttribute('placeholder') || '',
        node.getAttribute('aria-label') || '',
      ].join(' '));
      return hints.some((hint) => haystack.includes(hint));
    });

    if (!target) return false;

    if (target.tagName.toLowerCase() === 'select') {
      const desired = normalize(fieldValue);
      const option = Array.from(target.options).find((candidate) => normalize(candidate.textContent).includes(desired) || desired.includes(normalize(candidate.textContent)));
      target.value = option ? option.value : target.value;
    } else {
      target.focus();
      target.value = fieldValue;
    }

    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, labels, value);
}

async function findLeverFieldSelector(page, labels) {
  return page.evaluate((labelHints) => {
    function normalize(text) {
      return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function labelFor(node) {
      if (node.id) {
        const explicit = document.querySelector(`label[for="${node.id}"]`);
        if (explicit?.innerText) return explicit.innerText.trim();
      }
      const wrappingLabel = node.closest('label');
      if (wrappingLabel?.innerText) return wrappingLabel.innerText.trim();
      const group = node.closest('.application-field, .application-question, [class*="field"], [class*="question"], [class*="form"]');
      const explicit = group?.querySelector('label, legend');
      return explicit?.innerText?.trim() || '';
    }

    const hints = labelHints.map(normalize);
    const fields = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((node) => isVisible(node) && !['hidden', 'file', 'submit', 'button'].includes((node.type || '').toLowerCase()));

    const target = fields.find((node) => {
      const haystack = normalize([
        labelFor(node),
        node.name || '',
        node.id || '',
        node.getAttribute('placeholder') || '',
        node.getAttribute('aria-label') || '',
      ].join(' '));
      return hints.some((hint) => haystack.includes(hint));
    });

    if (!target) return null;
    if (target.id) return { selector: `#${CSS.escape(target.id)}`, tag: target.tagName.toLowerCase() };
    if (target.name) return { selector: `[name="${String(target.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`, tag: target.tagName.toLowerCase() };
    const placeholder = target.getAttribute('placeholder');
    if (placeholder) return { selector: `[placeholder="${String(placeholder).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`, tag: target.tagName.toLowerCase() };
    return null;
  }, labels);
}

async function fillLeverAutocompleteField(page, labels, value) {
  if (!value) return false;
  const found = await findLeverFieldSelector(page, labels);
  if (!found?.selector) return false;
  const input = await page.$(found.selector);
  if (!input) return false;
  await input.click({ clickCount: 3 });
  await input.type(value, { delay: 20 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.press('ArrowDown').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  return true;
}

/**
 * Extract Lever company slug and job UUID from a job URL.
 */
function parseLeverUrl(url) {
  const m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  return { company: m[1], jobId: m[2] };
}

/**
 * Submit a Lever application via headless Chrome.
 *
 * @param {object} job        - job row from DB
 * @param {object} applicant  - { firstName, lastName, email, phone, resumePath }
 * @param {boolean} dryRun    - if true, log what would happen without submitting
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function applyLever(job, applicant, dryRun = false) {
  const parsed = parseLeverUrl(job.url);
  if (!parsed) {
    return { success: false, error: `Cannot parse Lever URL: ${job.url}` };
  }
  const { company, jobId } = parsed;
  const applyUrl = `https://jobs.lever.co/${company}/${jobId}/apply`;

  if (dryRun) {
    log.info('[DRY RUN] Would apply to Lever job', {
      company: job.company, title: job.title,
      leverCompany: company, jobId,
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

    log.info('Opening Lever apply page', { company: job.company, url: applyUrl });
    await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    const pageIssue = detectApplicationPageIssue('lever', await snapshotApplicationPage(page), {
      sourceUrl: applyUrl,
      jobId,
    });
    if (pageIssue) {
      return { success: false, error: pageIssue };
    }

    // Lever uses labeled form groups — fill by placeholder or name attribute
    await fillField(page, 'input[name="name"], input[placeholder*="name" i]', `${applicant.firstName} ${applicant.lastName}`);
    await fillField(page, 'input[name="email"], input[placeholder*="email" i]', applicant.email);
    await fillField(page, 'input[name="phone"], input[placeholder*="phone" i]', applicant.phone);
    await fillLeverLabeledField(page, ['linkedin'], applicant.linkedin);
    await fillLeverAutocompleteField(page, ['current location', 'location'], applicant.location);
    await fillLeverLabeledField(page, ['current company', 'company'], applicant.currentCompany);

    // Upload resume — Lever has a file drop zone
    const resumeInput = await page.$('input[type="file"]');
    if (resumeInput) {
      await resumeInput.uploadFile(tmpResume);
      log.info('Resume uploaded', { path: resumeAbsPath });
      await new Promise(r => setTimeout(r, 2000));
    } else {
      log.warn('Resume file input not found', { company: job.company });
    }

    // Submit — Lever uses either type="submit" or a button with id="btn-submit"
    const submitBtn = await page.$('button[type="submit"], #btn-submit, [class*="btn-submit"]');
    if (!submitBtn) {
      return { success: false, error: 'Submit button not found on page' };
    }

    const incompleteFields = await getIncompleteRequiredFields(page);
    if (incompleteFields.length) {
      const incompleteScreenshot = await saveScreenshot(page, job, 'incomplete');
      return {
        success: false,
        incompleteImagePath: incompleteScreenshot,
        error: `Required fields still empty before submit: ${incompleteFields.join(', ')}. Check screenshot: ${incompleteScreenshot}`,
      };
    }

    const submissionStartedAt = Date.now();
    const preScreenshot = await saveScreenshot(page, job, 'presubmit');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      submitBtn.click(),
    ]);
    await new Promise(r => setTimeout(r, 4000));
    const postScreenshot = await saveScreenshot(page, job, 'postsubmit');

    const pageText = await page.evaluate(() => document.body.innerText);
    const successPhrases = ['thank you', 'application received', 'successfully submitted', "we've received"];
    const isSuccess = successPhrases.some(p => pageText.toLowerCase().includes(p));
    const isDuplicate = hasDuplicateSubmissionMessage(pageText);
    const isAbuseWarning = hasAbuseWarningMessage(pageText);

    if (isAbuseWarning) {
      return {
        success: false,
        haltRun: true,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        error: `Abuse warning detected after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    if (!isSuccess && !isDuplicate) {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        error: `No success confirmation found after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    if (isDuplicate) {
      log.info('Existing application confirmed on Lever', { company: job.company, title: job.title });
    }

    const confirmationEmail = await waitForApplicationConfirmation(job, { startedAt: submissionStartedAt });
    if (!confirmationEmail) {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        error: `No application confirmation email found after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    log.info('Applied via Lever (headless)', { company: job.company, title: job.title });
    return { success: true, preImagePath: preScreenshot, postImagePath: postScreenshot };

  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(tmpResume); } catch {}
  }
}

module.exports = { applyLever };
