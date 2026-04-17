'use strict';

const { saveScreenshot, fillField, findSubmitButton } = require('../ats-appliers/browser');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('../ats-appliers/page-checks');
const log = require('../logger')('apply-submit');

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

module.exports = { submitAshby };
