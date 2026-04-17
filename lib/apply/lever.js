'use strict';

const { saveScreenshot, fillField } = require('../ats-appliers/browser');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('../ats-appliers/page-checks');
const log = require('../logger')('apply-submit');

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

module.exports = { submitLever };
