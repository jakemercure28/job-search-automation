'use strict';

const fs = require('fs');
const path = require('path');
const { launchBrowser, saveScreenshot, getIncompleteRequiredFields, newPage, fillField, findSubmitButton, stageResume, hasDuplicateSubmissionMessage, hasAbuseWarningMessage } = require('./browser');
const { waitForApplicationConfirmation } = require('../gmail-code');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('./page-checks');
const { preflightApplicant } = require('./preflight');
const log = require('../logger')('auto-apply');

async function fillConsentCheckboxes(page) {
  return page.evaluate(() => {
    const selectors = [
      'input[name="_systemfield_data_consent_ack"]',
      'input[type="checkbox"]',
    ];

    for (const selector of selectors) {
      const inputs = document.querySelectorAll(selector);
      for (const input of inputs) {
        const container = input.closest('label, [class*="field"], [class*="checkbox"]') || input.parentElement;
        const text = (container?.innerText || '').toLowerCase();
        if (!/consent|privacy|agree|acknowledge/.test(text) && selector !== 'input[name="_systemfield_data_consent_ack"]') continue;
        if (!input.checked) input.click();
      }
    }

    return true;
  });
}

async function fillAshbyCustomAnswer(page, question, answer) {
  const fieldName = String(question?.name || '');
  const fieldType = String(question?.type || 'text');
  const answers = Array.isArray(answer) ? answer : [answer];

  if (!fieldName || !answers.length) return false;

  if (fieldType === 'text' || fieldType === 'textarea') {
    const selector = `textarea[name="${fieldName}"], textarea[id="${fieldName}"], input[name="${fieldName}"], input[id="${fieldName}"]`;
    const filled = await fillField(page, selector, String(answers[0]), { delay: 20 });
    if (filled) return true;

    return page.evaluate((name, label, value) => {
      const fields = Array.from(document.querySelectorAll('input, textarea'));
      const target = fields.find((el) => {
        const group = el.closest('[class*="field"], [class*="question"], [class*="form"], [role="group"]');
        const text = [el.name, el.id, group?.innerText || ''].join(' ').toLowerCase();
        return text.includes(name.toLowerCase()) || text.includes(label.toLowerCase());
      });
      if (!target) return false;
      target.focus();
      target.value = value;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, fieldName, String(question?.label || ''), String(answers[0]));
  }

  if (fieldType === 'select') {
    const selected = await page.evaluate((name, label, desiredValue) => {
      const desired = String(desiredValue || '').trim().toLowerCase();
      const select = document.querySelector(`select[name="${name}"], select[id="${name}"]`);
      if (select) {
        const option = Array.from(select.options).find((candidate) => {
          const text = candidate.textContent.trim().toLowerCase();
          return text === desired || text.includes(desired) || desired.includes(text);
        });
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      const inputs = Array.from(document.querySelectorAll(`input[name="${name}"]`));
      for (const input of inputs) {
        const container = input.closest('label, [class*="field"], [class*="question"], [role="group"]') || input.parentElement;
        const text = (container?.innerText || '').toLowerCase();
        if (text.includes(desired) || desired.includes(text)) {
          input.click();
          return true;
        }
      }

      const groups = Array.from(document.querySelectorAll('[class*="field"], [class*="question"], [role="group"]'));
      for (const group of groups) {
        const text = (group.innerText || '').toLowerCase();
        if (!text.includes(label.toLowerCase())) continue;
        const candidate = Array.from(group.querySelectorAll('label, button, [role="option"]')).find((node) => {
          const optionText = (node.innerText || '').trim().toLowerCase();
          return optionText === desired || optionText.includes(desired) || desired.includes(optionText);
        });
        if (candidate) {
          candidate.click();
          return true;
        }
      }

      return false;
    }, fieldName, String(question?.label || ''), String(answers[0]));
    if (selected) return true;
  }

  if (fieldType === 'multi_select') {
    return page.evaluate((name, values) => {
      const wanted = values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      const inputs = Array.from(document.querySelectorAll(`input[name="${name}"]`));
      let matched = false;
      for (const input of inputs) {
        const container = input.closest('label, [class*="field"], [class*="question"], [role="group"]') || input.parentElement;
        const text = (container?.innerText || '').toLowerCase();
        if (wanted.some((value) => text.includes(value) || value.includes(text))) {
          input.click();
          matched = true;
        }
      }
      return matched;
    }, fieldName, answers);
  }

  return false;
}

/**
 * Submit an Ashby application via headless Chrome.
 *
 * Ashby system field selectors (discovered via DOM inspection):
 *   Name:   input[name="_systemfield_name"]
 *   Email:  input[name="_systemfield_email"]
 *   Location: input[name="_systemfield_location"]
 *   Phone:  input[type="tel"]
 *   Resume: input[id="_systemfield_resume"] or input[type="file"]
 *   Submit: button[type="submit"] whose text includes "Submit" (not "Upload File")
 *
 * @param {object} job        - job row from DB
 * @param {object} applicant  - { firstName, lastName, email, phone, resumePath }
 * @param {boolean} dryRun    - if true, log what would happen without submitting
 * @param {object} [answers]  - { fieldName: answerText } for custom question fields
 * @param {Array} [questions] - normalized question metadata from application prep
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function applyAshby(job, applicant, dryRun = false, answers = {}, questions = []) {
  const m = job.url && job.url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) {
    return { success: false, error: `Cannot parse Ashby URL: ${job.url}` };
  }
  const [, company, jobId] = m;
  const applyUrl = `https://jobs.ashbyhq.com/${company}/${jobId}/application`;

  if (dryRun) {
    log.info('[DRY RUN] Would apply to Ashby job', {
      company: job.company, title: job.title,
      ashbyCompany: company, jobId,
      resume: applicant.resumePath,
      customAnswers: Object.keys(answers).length,
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

    log.info('Opening Ashby apply page', { company: job.company, url: applyUrl });
    await page.goto(applyUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Extra wait for React to render the form
    await new Promise(r => setTimeout(r, 2000));

    const pageIssue = detectApplicationPageIssue('ashby', await snapshotApplicationPage(page), {
      sourceUrl: applyUrl,
      jobId,
    });
    if (pageIssue) {
      return { success: false, error: pageIssue };
    }

    // Ashby system fields use _systemfield_ name prefix
    await fillField(page, 'input[name="_systemfield_name"]', `${applicant.firstName} ${applicant.lastName}`);
    await fillField(page, 'input[name="_systemfield_email"]', applicant.email);
    if (applicant.location) {
      await fillField(page, 'input[name="_systemfield_location"]', applicant.location);
    }
    await fillField(page, 'input[type="tel"]', applicant.phone);
    await fillConsentCheckboxes(page);

    // Upload resume
    const resumeInput = await page.$('input[id="_systemfield_resume"], input[type="file"]');
    if (resumeInput) {
      await resumeInput.uploadFile(tmpResume);
      log.info('Resume uploaded', { path: resumeAbsPath });
      await new Promise(r => setTimeout(r, 2000));
    } else {
      log.warn('Resume file input not found', { company: job.company });
    }

    // Fill custom question answers if provided
    for (const question of questions) {
      const answerText = answers[question.name];
      if (answerText == null || answerText === '') continue;
      const filled = await fillAshbyCustomAnswer(page, question, answerText);
      if (!filled) log.warn('Custom field not found', { fieldName: question.name, label: question.label });
    }

    // Find the real submit button (not "Upload file", "Yes", "No" toggles)
    const submitBtn = await findSubmitButton(page);
    if (!submitBtn) {
      return { success: false, error: 'Submit button not found on page' };
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
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      submitBtn.click(),
    ]);
    await new Promise(r => setTimeout(r, 4000));
    const postScreenshot = await saveScreenshot(page, job, 'postsubmit');

    const pageText = await page.evaluate(() => document.body.innerText);
    const successPhrases = ['thank you', 'application received', 'successfully submitted', "we've received", 'application submitted'];
    const isSuccess = successPhrases.some(p => pageText.toLowerCase().includes(p));
    const isDuplicate = hasDuplicateSubmissionMessage(pageText);
    const isAbuseWarning = hasAbuseWarningMessage(pageText);

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
      log.info('Existing application confirmed on Ashby', { company: job.company, title: job.title });
    }

    const confirmationEmail = await waitForApplicationConfirmation(job, { startedAt: submissionStartedAt });
    if (!confirmationEmail) {
      return { success: false, error: `No application confirmation email found after submit. Check screenshot: ${postScreenshot}` };
    }

    log.info('Applied via Ashby (headless)', { company: job.company, title: job.title });
    return { success: true };

  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (browser) await browser.close();
    try { fs.unlinkSync(tmpResume); } catch {}
  }
}

module.exports = { applyAshby };
