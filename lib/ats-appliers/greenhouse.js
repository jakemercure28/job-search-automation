'use strict';

const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  saveScreenshot,
  getIncompleteRequiredFields,
  newPage,
  stageResume,
  hasDuplicateSubmissionMessage,
  hasAbuseWarningMessage,
  captureAssistPageMeta,
  splitExpectedMissingFields,
} = require('./browser');
const { waitForApplicationConfirmation } = require('../gmail-code');
const { detectApplicationPageIssue, snapshotApplicationPage } = require('./page-checks');
const { fetchGreenhouseCode } = require('../gmail-code');
const { preflightApplicant } = require('./preflight');
const log = require('../logger')('auto-apply');

const GREENHOUSE_SCHOOL_INPUT_SELECTOR = 'input[id*="school"], input[placeholder*="school" i], input[name*="school" i]';

// Pattern-matched answers for common Greenhouse application questions.
// Extend this list with your own company-specific or role-specific answers.
// Identity fields (linkedin, github, location) are filled from the applicant config below.
const SIMPLE_GREENHOUSE_QUESTION_RULES = [
  { pattern: /u\.s\. work authorization/i, answer: (applicant) => applicant.usWorkAuthorized || 'Yes' },
  { pattern: /authorized to work|legally authorized|work authorization/i, answer: (applicant) => applicant.usWorkAuthorized || 'Yes' },
  { pattern: /visa sponsorship|require sponsorship/i, answer: (applicant) => applicant.requiresSponsorship || 'No' },
  { pattern: /pending or future government filing|dependent on a pending or future government|support any immigration or employment authorization/i, answer: (applicant) => applicant.requiresSponsorship || 'No' },
  { pattern: /u\.s\. citizens are eligible|u\.s\. citizen|only u\.s\. citizens/i, answer: (applicant) => applicant.usCitizen || null },
  { pattern: /country/i, answer: (applicant) => applicant.country || 'United States' },
  { pattern: /current location|location/i, answer: (applicant) => applicant.location || applicant.country || 'United States' },
  { pattern: /reside in the united states|currently reside in the united states|do you currently reside in the united states/i, answer: (applicant) => applicant.residesInUs || 'Yes' },
  { pattern: /greater seattle area|seattle area/i, answer: (applicant) => /seattle/i.test(applicant.location || '') ? 'Yes' : 'No' },
  { pattern: /linkedin/i, answer: (applicant) => applicant.linkedin || null },
  { pattern: /github/i, answer: (applicant) => applicant.github || null },
  { pattern: /portfolio|website/i, answer: (applicant) => applicant.github || applicant.linkedin || null },
  { pattern: /current company|current employer|company/i, answer: (applicant) => applicant.currentCompany || null },
  { pattern: /how did you hear/i, answer: (applicant) => applicant.heardAbout || 'LinkedIn' },
  { pattern: /background check/i, answer: (applicant) => applicant.backgroundCheckConsent || 'Yes' },
  { pattern: /experience.*aws|aws cloud infrastructure/i, answer: (applicant) => applicant.awsExperience || 'Yes' },
  { pattern: /experience.*kubernetes|working with kubernetes/i, answer: (applicant) => applicant.kubernetesExperience || 'Yes' },
  { pattern: /clearance eligibility|security clearance/i, answer: (applicant) => applicant.clearanceEligible || 'No' },
  { pattern: /what clearance level have you held/i, answer: (applicant) => applicant.previousClearance || 'None' },
  { pattern: /export controls/i, answer: (applicant) => applicant.exportControlsEligible || applicant.usWorkAuthorized || 'Yes' },
  { pattern: /history with .*|ever been employed by/i, answer: (applicant) => applicant.workedAtEmployerBefore || 'No' },
  { pattern: /conflict of interest/i, answer: (applicant) => applicant.hasConflictOfInterest || 'No' },
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

function resolveGreenhouseQuestionAnswer(label, applicant, draftedAnswers, fieldName) {
  if (fieldName && draftedAnswers && Object.prototype.hasOwnProperty.call(draftedAnswers, fieldName)) {
    return draftedAnswers[fieldName];
  }
  return answerForGreenhouseQuestion(label, applicant);
}

async function fillGreenhouseEEO(page, applicant) {
  const fieldMap = [
    { labelKeys: ['gender identity'],    optKey: applicant.eeoGenderIdentity || 'decline to answer' },
    { labelKeys: ['gender'],             optKey: applicant.eeoGender || 'decline to self-identify' },
    { labelKeys: ['pronoun'],            optKey: applicant.eeoPronouns || 'decline to answer' },
    { labelKeys: ['sexual orientation'], optKey: applicant.eeoOrientation || 'decline to answer' },
    { labelKeys: ['hispanic', 'latino'], optKey: applicant.eeoHispanic || 'decline to answer' },
    { labelKeys: ['race', 'ethnicity'],  optKey: applicant.eeoRace || 'decline to answer' },
    { labelKeys: ['veteran'],            optKey: applicant.eeoVeteran || 'decline to answer' },
    { labelKeys: ['disability'],         optKey: applicant.eeoDisability || "don't wish to answer" },
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

async function fillGreenhouseEducation(page, applicant) {
  if (!applicant.school) return null;

  let schoolReview = await inspectGreenhouseEducationTarget(page);
  if (!schoolReview.target) {
    const addBtn = await page.$('button[aria-label*="education" i], button[data-action*="education" i]');
    if (addBtn) {
      await addBtn.click();
      await new Promise((r) => setTimeout(r, 800));
      schoolReview = await inspectGreenhouseEducationTarget(page);
    }
  }

  const target = schoolReview.target;
  if (!target) {
    log.warn('Greenhouse education target not found', { company: applicant.currentCompany || null });
    return { targetBefore: null, targetAfterFill: null, filledSchool: false };
  }

  const schoolInputs = await page.$$(GREENHOUSE_SCHOOL_INPUT_SELECTOR);
  const schoolInput = schoolInputs[target.domIndex];
  if (!schoolInput) {
    return { targetBefore: target, targetAfterFill: null, filledSchool: false };
  }

  const selected = await chooseGreenhouseComboboxOption(page, target.fieldName, schoolInput, applicant.school);
  await new Promise((r) => setTimeout(r, 500));

  const rowHandle = await schoolInput.evaluateHandle((input) => (
    input.closest('[data-qa*="education" i]')
      || input.closest('[class*="education"]')
      || input.closest('[id*="education"]')
      || input.closest('[class*="field"], [class*="form-group"], [role="group"], fieldset')
      || input.parentElement
  ));
  const row = rowHandle.asElement();
  const scopedRoot = row || page;

  const degreeSelect = await scopedRoot.$('select[id*="degree"], select[name*="degree"]');
  if (degreeSelect) {
    await degreeSelect.evaluate((sel) => {
      const option = Array.from(sel.options).find((candidate) => candidate.textContent.toLowerCase().includes('bachelor'));
      if (!option) return false;
      sel.value = option.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }).catch(() => false);
  }

  const disciplineInput = await scopedRoot.$('input[id*="discipline"], input[name*="discipline"], input[placeholder*="field of study" i]');
  if (disciplineInput && applicant.fieldOfStudy) {
    await disciplineInput.click({ clickCount: 3 });
    await disciplineInput.type(applicant.fieldOfStudy, { delay: 30 });
  }

  const yearInput = await scopedRoot.$('input[id*="grad"], input[name*="grad"], select[id*="grad"]');
  if (yearInput && applicant.gradYear) {
    const tag = await yearInput.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') await yearInput.select(String(applicant.gradYear)).catch(() => {});
    else {
      await yearInput.click({ clickCount: 3 });
      await yearInput.type(String(applicant.gradYear), { delay: 30 });
    }
  }

  const afterFillReview = await inspectGreenhouseEducationTarget(page);
  const afterFillTarget = afterFillReview.target;
  log.info('Greenhouse education fill review', {
    targetFieldName: target.fieldName,
    targetLabel: target.label,
    rowIndex: target.rowIndex,
    required: target.required,
    selectedBefore: target.selectedValue || null,
    selectedAfter: afterFillTarget?.selectedValue || null,
    hasSingleValueNode: Boolean(afterFillTarget?.hasSingleValueNode),
    filledSchool: selected,
  });

  if (row) await row.dispose().catch(() => {});
  await rowHandle.dispose().catch(() => {});
  return {
    targetBefore: target,
    targetAfterFill: afterFillTarget,
    filledSchool: selected,
  };
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
        await checkbox.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
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

function normalizeGreenhouseAnswer(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function greenhouseSelectionMatches(selectedValue, desiredAnswer) {
  const selected = normalizeGreenhouseAnswer(selectedValue);
  const desired = normalizeGreenhouseAnswer(desiredAnswer);
  if (!selected || !desired) return false;
  return selected === desired
    || selected.startsWith(desired)
    || desired.startsWith(selected)
    || selected.includes(desired)
    || desired.includes(selected);
}

function greenhouseComboboxSnapshotIsEmpty(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return true;
  return !normalizeGreenhouseAnswer(snapshot.selectedValue);
}

function greenhouseEducationFieldIsPresent(review = {}) {
  return Array.isArray(review?.candidates) && review.candidates.length > 0;
}

function selectGreenhouseEducationTarget(candidates = []) {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const pools = [
    candidates.filter((candidate) => candidate.visible && candidate.required),
    candidates.filter((candidate) => candidate.visible),
    candidates,
  ];

  for (const pool of pools) {
    if (!pool.length) continue;
    return [...pool].sort((left, right) => {
      if (Number(left.rowIndex) !== Number(right.rowIndex)) {
        return Number(left.rowIndex) - Number(right.rowIndex);
      }
      return Number(left.domIndex) - Number(right.domIndex);
    })[0];
  }

  return null;
}

function buildGreenhouseTextSnippet(value, limit = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
}

function classifyGreenhouseSubmitOutcome(snapshot = {}) {
  const pageText = String(snapshot.pageText || '');
  const pageUrl = snapshot.pageUrl || null;
  const pageTitle = snapshot.pageTitle || null;
  const invalidFields = Array.isArray(snapshot.invalidFields)
    ? snapshot.invalidFields.filter(Boolean)
    : [];
  const details = {
    pageUrl,
    pageTitle,
    textSnippet: buildGreenhouseTextSnippet(snapshot.textSnippet || pageText),
    invalidFields,
    stillOnForm: Boolean(snapshot.stillOnForm),
  };

  if (details.stillOnForm && invalidFields.length) return { outcome: 'validation-failure', details };
  if (snapshot.isAbuseWarning) return { outcome: 'abuse-warning', details };
  if (snapshot.isDuplicate) return { outcome: 'duplicate', details };
  if (snapshot.isSuccess) return { outcome: 'success', details };
  return { outcome: 'confirmation-missing', details };
}

async function inspectGreenhouseEducationTarget(page) {
  const candidates = await page.evaluate((selector) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function fieldLabel(node) {
      if (node.id) {
        const explicit = document.querySelector(`label[for="${node.id}"]`);
        if (explicit?.innerText) return normalize(explicit.innerText);
      }
      const wrappingLabel = node.closest('label');
      if (wrappingLabel?.innerText) return normalize(wrappingLabel.innerText);
      const group = node.closest('[class*="field"], [class*="form-group"], [role="group"], fieldset');
      const explicit = group?.querySelector('label, legend');
      return normalize(explicit?.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '');
    }

    function comboboxGroup(node) {
      return node.closest('.select__control')
        || node.closest('[class*="select__control"]')
        || node.closest('.select-shell')
        || node.closest('[class*="select-shell"]')
        || node.closest('[class*="field"], [class*="form-group"], [role="group"], fieldset');
    }

    function educationRow(node) {
      return node.closest('[data-qa*="education" i]')
        || node.closest('[class*="education"]')
        || node.closest('[id*="education"]')
        || comboboxGroup(node)
        || node.parentElement;
    }

    function isRequired(node, label) {
      if (node.required) return true;
      if ((node.getAttribute('aria-required') || '').toLowerCase() === 'true') return true;
      const row = educationRow(node);
      return /[*]|\brequired\b/i.test(`${label} ${row?.innerText || ''}`);
    }

    const inputs = Array.from(document.querySelectorAll(selector));
    return inputs.map((input, domIndex) => {
      const label = fieldLabel(input);
      const row = educationRow(input);
      const group = comboboxGroup(input) || row;
      const renderedValue = normalize(group?.querySelector('[class*="single-value"]')?.innerText);
      const placeholder = normalize(group?.querySelector('[class*="placeholder"]')?.innerText);
      const rowIndexMatch = String(input.id || input.name || '').match(/--(\d+)/);
      return {
        domIndex,
        fieldName: input.id || input.name || null,
        inputId: input.id || null,
        inputName: input.name || null,
        label,
        visible: isVisible(input),
        required: isRequired(input, label),
        selectedValue: renderedValue || null,
        typedValue: normalize(input.value || '') || null,
        hasSingleValueNode: Boolean(renderedValue),
        placeholderText: placeholder || null,
        rowIndex: rowIndexMatch ? Number(rowIndexMatch[1]) : domIndex,
      };
    });
  }, GREENHOUSE_SCHOOL_INPUT_SELECTOR);

  const target = selectGreenhouseEducationTarget(candidates);
  return { candidates, target };
}

async function greenhouseFieldIsEmpty(page, fieldName) {
  return page.evaluate((targetFieldName) => {
    const escapedName = window.CSS && typeof window.CSS.escape === 'function'
      ? window.CSS.escape(targetFieldName)
      : targetFieldName;
    const target = document.getElementById(targetFieldName)
      || document.querySelector(`[name="${escapedName}"]`);
    if (!target) return false;

    const tag = target.tagName.toLowerCase();
    if (tag === 'select') return !(target.value || '').trim();

    const role = target.getAttribute('role') || '';
    const className = String(target.className || '');
    const looksLikeCombobox = role === 'combobox'
      || Boolean(target.getAttribute('aria-controls') || target.getAttribute('aria-owns'))
      || className.includes('select__input');
    if (!looksLikeCombobox) return !(target.value || '').trim();

    const group = target.closest('.select__control')
      || target.closest('[class*="select__control"]')
      || target.closest('.select-shell')
      || target.closest('[class*="select-shell"]')
      || target.closest('[class*="field"], [class*="form-group"], [role="group"]');
    const renderedValue = group?.querySelector('[class*="single-value"]');
    return !(renderedValue?.innerText || '').trim();
  }, fieldName);
}

async function chooseGreenhouseComboboxOption(page, fieldName, input, answer) {
  const desired = normalizeGreenhouseAnswer(answer);

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace').catch(() => {});
  await input.type(String(answer), { delay: 20 });
  await page.waitForFunction((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const listboxId = target?.getAttribute('aria-controls') || target?.getAttribute('aria-owns');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    if (!listbox) return false;
    return Array.from(listbox.querySelectorAll('[role="option"]'))
      .map((node) => normalize(node.innerText))
      .some((value) => value === desiredAnswer || value.includes(desiredAnswer) || desiredAnswer.includes(value));
  }, { timeout: 3000 }, input, desired).catch(() => null);

  const activeMatchesDesired = async () => page.evaluate((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    if (!target) return false;

    const activeId = target.getAttribute('aria-activedescendant');
    const active = activeId ? document.getElementById(activeId) : null;
    const activeText = normalize(active?.innerText);
    return Boolean(
      activeText
      && (activeText === desiredAnswer || activeText.includes(desiredAnswer) || desiredAnswer.includes(activeText))
    );
  }, input, desired);

  for (let attempts = 0; attempts < 8; attempts += 1) {
    if (await activeMatchesDesired()) break;
    await page.keyboard.press('ArrowDown').catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
  }

  if (await activeMatchesDesired()) {
    await page.keyboard.press('Enter').catch(() => {});
  }

  await page.keyboard.press('Tab').catch(() => {});
  await new Promise(r => setTimeout(r, 500));

  const verifySelection = () => page.evaluate((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const group = target?.closest('.select__control')
      || target?.closest('[class*="select__control"]')
      || target?.closest('.select-shell')
      || target?.closest('[class*="select-shell"]')
      || target?.closest('[class*="field"], [class*="form-group"], [role="group"]');
    const renderedValue = normalize(group?.querySelector('[class*="single-value"]')?.innerText);
    return Boolean(
      renderedValue
      && (renderedValue === desiredAnswer
        || renderedValue.startsWith(desiredAnswer)
        || desiredAnswer.startsWith(renderedValue)
        || renderedValue.includes(desiredAnswer))
    );
  }, input, desired);

  if (await verifySelection()) {
    return true;
  }

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace').catch(() => {});
  await input.type(String(answer), { delay: 20 });
  await page.waitForFunction((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    const listboxId = target?.getAttribute('aria-controls') || target?.getAttribute('aria-owns');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    if (!listbox) return false;
    return Array.from(listbox.querySelectorAll('[role="option"]'))
      .map((node) => normalize(node.innerText))
      .some((value) => value === desiredAnswer || value.includes(desiredAnswer) || desiredAnswer.includes(value));
  }, { timeout: 3000 }, input, desired).catch(() => null);

  const picked = await page.evaluate((target, desiredAnswer) => {
    function normalize(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function collectOptions(root, acc) {
      if (!root) return;
      for (const selector of [
        '[role="option"]',
        '[id*="option"]',
        '[class*="option"]:not([class*="container"])',
        'li[class*="select"]',
        '[class*="dropdown"] li',
        '[class*="listbox"] li',
      ]) {
        for (const item of root.querySelectorAll(selector)) {
          acc.add(item);
        }
      }
    }

    if (!target) return null;

    const optionNodes = new Set();
    const listboxIds = [...new Set([
      target.getAttribute('aria-controls'),
      target.getAttribute('aria-owns'),
    ].filter(Boolean))];
    for (const id of listboxIds) {
      collectOptions(document.getElementById(id), optionNodes);
    }

    const group = target.closest('.select__control')
      || target.closest('[class*="select__control"]')
      || target.closest('.select-shell')
      || target.closest('[class*="select-shell"]')
      || target.closest('[class*="field"], [class*="form-group"], [role="group"]');
    collectOptions(group, optionNodes);

    const visibleOptions = Array.from(optionNodes)
      .filter(isVisible)
      .map((node) => ({ node, text: normalize(node.innerText) }))
      .filter((entry) => entry.text);

    const exact = visibleOptions.find((entry) => entry.text === desiredAnswer);
    const prefix = visibleOptions.find((entry) => entry.text.startsWith(desiredAnswer) || desiredAnswer.startsWith(entry.text));
    const contains = visibleOptions.find((entry) => entry.text.includes(desiredAnswer) || desiredAnswer.includes(entry.text));
    const match = exact || prefix || contains;
    if (!match) return null;

    match.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    match.node.click();
    return match.text;
  }, input, desired);

  if (!picked) {
    await page.keyboard.press('ArrowDown').catch(() => {});
    await new Promise(r => setTimeout(r, 250));
    await page.keyboard.press('Enter').catch(() => {});
  }

  await page.keyboard.press('Tab').catch(() => {});
  await new Promise(r => setTimeout(r, 500));

  return verifySelection();
}

async function greenhouseFieldHasText(page, selector) {
  return page.evaluate((targetSelector) => {
    const node = document.querySelector(targetSelector);
    return Boolean(node && (node.value || '').trim());
  }, selector);
}

async function greenhouseRequiredQuestionIsEmpty(page, field) {
  if (!field?.required) return false;

  if (field.name.endsWith('[]')) {
    return page.evaluate((fieldName) => {
      const checkboxes = Array.from(document.querySelectorAll(`input[name="${fieldName}"]`));
      return !checkboxes.some((checkbox) => checkbox.checked);
    }, field.name);
  }

  return greenhouseFieldIsEmpty(page, field.name);
}

async function collectGreenhouseMissingFields(page, applicant, questions = []) {
  const missing = [];
  let schoolTarget = null;

  if (!await greenhouseFieldHasText(page, '#first_name')) missing.push('First Name*');
  if (!await greenhouseFieldHasText(page, '#last_name')) missing.push('Last Name*');
  if (!await greenhouseFieldHasText(page, '#email')) missing.push('Email*');
  if (!await greenhouseFieldHasText(page, '#phone')) missing.push('Phone*');
  if (applicant.school) {
    const schoolReview = await inspectGreenhouseEducationTarget(page);
    schoolTarget = schoolReview.target;
    if (greenhouseEducationFieldIsPresent(schoolReview) && (!schoolTarget || greenhouseComboboxSnapshotIsEmpty(schoolTarget))) {
      missing.push(schoolTarget?.label || 'School*');
    }
  }

  for (const question of questions) {
    for (const field of (question.fields || [])) {
      if (await greenhouseRequiredQuestionIsEmpty(page, field)) {
        missing.push(question.label || field.name);
        break;
      }
    }
  }

  return { missing: [...new Set(missing)], schoolTarget };
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
  const role = await el.evaluate(node => node.getAttribute('role') || '');
  const className = await el.evaluate(node => String(node.className || ''));
  const isCombobox = role === 'combobox'
    || Boolean(await el.evaluate(node => node.getAttribute('aria-controls') || node.getAttribute('aria-owns')))
    || className.includes('select__input');

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
    if (isCombobox) {
      return chooseGreenhouseComboboxOption(page, safeFieldName, el, answer);
    }
    await el.click({ clickCount: 3 });
    await el.type(String(answer), { delay: 20 });
    return true;
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
/**
 * In assist mode, watch the open page for the Greenhouse security code boxes
 * (8 single-char inputs). When detected, fetch the code from Gmail and fill it
 * in automatically, then click Submit. Also exits early if the page transitions
 * to a success state (no code needed) or if the browser disconnects.
 *
 * Returns the code that was used, or null if none was needed / found.
 */
async function watchForSecurityCode(page, job, maxWaitMs = 10 * 60 * 1000) {
  const deadline = Date.now() + maxWaitMs;
  log.info('Assist: watching for security code or success page', { company: job.company, maxWaitMs });

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));

    try {
      const codeBoxes = await page.$$('input[maxlength="1"]');
      if (codeBoxes.length === 8) {
        log.info('Security code field detected — fetching from Gmail...', { company: job.company });
        const code = await fetchGreenhouseCode(45000);
        if (!code) {
          log.warn('Security code not found in Gmail within 45s', { company: job.company });
          return null;
        }
        log.info('Got security code, entering...', { code, company: job.company });
        for (let i = 0; i < 8; i++) {
          await codeBoxes[i].click();
          await codeBoxes[i].type(code[i], { delay: 60 });
        }
        await new Promise(r => setTimeout(r, 500));
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
        log.info('Security code submitted', { company: job.company });
        await new Promise(r => setTimeout(r, 5000));
        return code;
      }

      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const successPhrases = ['thank you', 'application received', 'successfully submitted', 'we have received', 'application has been'];
      if (successPhrases.some(p => pageText.toLowerCase().includes(p))) {
        log.info('Application confirmed without security code', { company: job.company });
        return null;
      }
      const hasCaptcha = await page.evaluate(() =>
        Boolean(document.querySelector('iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[title*="captcha" i], .g-recaptcha, [data-captcha]'))
      ).catch(() => false);
      if (hasCaptcha) {
        log.info('CAPTCHA detected — waiting for manual solve, then will resume...', { company: job.company });
      }
    } catch (e) {
      if (e.message?.includes('detached') || e.message?.includes('closed') || e.message?.includes('disconnected')) {
        log.info('Browser disconnected, stopping code watcher', { company: job.company });
        return null;
      }
      log.warn('Code watcher poll error', { error: e.message });
    }
  }

  log.warn('Code watcher timed out', { company: job.company, maxWaitMs });
  return null;
}

async function applyGreenhouse(job, applicant, options = {}) {
  const {
    mode = 'submit',
    answers: draftedAnswers = {},
    questions: draftedQuestions = [],
    unresolvedFields = [],
    lowConfidenceFields = [],
  } = options;
  const parsed = parseGreenhouseUrl(job.url, job);
  if (!parsed) {
    return { success: false, error: `Cannot parse Greenhouse URL: ${job.url}` };
  }
  const { boardToken, jobId } = parsed;
  const applyUrl = `https://job-boards.greenhouse.io/${boardToken}/jobs/${jobId}`;

  const pre = preflightApplicant(applicant);
  if (!pre.ok) return { success: false, error: pre.error };
  const { resumeAbsPath } = pre;

  const tmpResume = stageResume(resumeAbsPath);
  let browser;
  let keepBrowserOpen = false;
  try {
    browser = await launchBrowser({ headless: mode !== 'assist' });
    const page = await newPage(browser);
    const filledFields = [];

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
    filledFields.push('First name');
    await typeInto(page, '#last_name', applicant.lastName);
    filledFields.push('Last name');
    await typeInto(page, '#email', applicant.email);
    filledFields.push('Email');

    // Phone: uses intl-tel-input — type number directly, US is default country
    await typeInto(page, '#phone', applicant.phone);
    filledFields.push('Phone');

    const linkedinInput = await page.$('input[id*="linkedin"], input[name*="linkedin"], #linkedin');
    if (linkedinInput && applicant.linkedin) {
      await linkedinInput.click({ clickCount: 3 });
      await linkedinInput.type(applicant.linkedin, { delay: 20 });
      filledFields.push('LinkedIn');
    }

    // Upload resume before custom selects. Greenhouse can rerender the form after
    // parsing the resume, which otherwise wipes already-selected dropdown values.
    const resumeInput = await page.$('#resume, input[type="file"][id*="resume"]');
    if (resumeInput) {
      await resumeInput.uploadFile(tmpResume);
      log.info('Resume uploaded');
      await new Promise(r => setTimeout(r, 1000));
      filledFields.push('Resume');
    } else {
      return { success: false, error: 'Resume file input not found' };
    }

    const schoolFill = await fillGreenhouseEducation(page, applicant);
    if (schoolFill?.filledSchool) filledFields.push('School');
    await fillGreenhouseEEO(page, applicant);

    // Country: type "United States" if the field exists and is empty
    const countryInput = await page.$('#country');
    if (countryInput) {
      const countryVal = await page.evaluate(el => el.value, countryInput);
      if (!countryVal) {
        await fillGreenhouseField(page, 'country', 'United States');
        filledFields.push('Country');
      }
    }

    const questions = draftedQuestions.length
      ? draftedQuestions.map((field) => ({ label: field.label, fields: [field] }))
      : await fetchGreenhouseQuestions(boardToken, jobId);
    for (const question of questions) {
      for (const field of (question.fields || [])) {
        const answer = Object.prototype.hasOwnProperty.call(draftedAnswers, field.name) ? draftedAnswers[field.name] : null;
        if (answer == null) continue;
        const filled = await fillGreenhouseField(page, field.name, answer);
        if (filled) {
          filledFields.push(question.label || field.label || field.name);
          break;
        }
      }
    }

    for (const question of questions) {
      for (const field of (question.fields || [])) {
        const answer = Object.prototype.hasOwnProperty.call(draftedAnswers, field.name) ? draftedAnswers[field.name] : null;
        if (answer == null || field.name.endsWith('[]')) continue;

        if (await greenhouseFieldIsEmpty(page, field.name)) {
          await fillGreenhouseField(page, field.name, answer);
        }
      }
    }

    const schoolBeforePresubmit = await inspectGreenhouseEducationTarget(page);
    if (applicant.school && (!schoolBeforePresubmit.target || greenhouseComboboxSnapshotIsEmpty(schoolBeforePresubmit.target))) {
      await fillGreenhouseEducation(page, applicant);
    }

    // Submit
    const submitBtn = await page.$('button[type="submit"]');
    if (!submitBtn) {
      return { success: false, error: 'Submit button not found' };
    }

    const validation = await collectGreenhouseMissingFields(page, applicant, questions);
    const schoolPresubmitTarget = validation.schoolTarget;
    const schoolSelection = {
      targetFieldName: schoolPresubmitTarget?.fieldName || schoolFill?.targetAfterFill?.fieldName || schoolFill?.targetBefore?.fieldName || null,
      targetLabel: schoolPresubmitTarget?.label || schoolFill?.targetAfterFill?.label || schoolFill?.targetBefore?.label || null,
      rowIndex: schoolPresubmitTarget?.rowIndex ?? schoolFill?.targetAfterFill?.rowIndex ?? schoolFill?.targetBefore?.rowIndex ?? null,
      required: Boolean(schoolPresubmitTarget?.required ?? schoolFill?.targetAfterFill?.required ?? schoolFill?.targetBefore?.required),
      selectedAfterFill: schoolFill?.targetAfterFill?.selectedValue || null,
      selectedBeforeSubmit: schoolPresubmitTarget?.selectedValue || null,
      hasSingleValueNodeAfterFill: Boolean(schoolFill?.targetAfterFill?.hasSingleValueNode),
      hasSingleValueNodeBeforeSubmit: Boolean(schoolPresubmitTarget?.hasSingleValueNode),
      schoolClearedAfterFill: Boolean(
        normalizeGreenhouseAnswer(schoolFill?.targetAfterFill?.selectedValue)
        && !normalizeGreenhouseAnswer(schoolPresubmitTarget?.selectedValue)
      ),
    };

    log.info('Greenhouse presubmit education review', schoolSelection);
    if (schoolSelection.schoolClearedAfterFill) {
      log.warn('Greenhouse school selection cleared before submit', schoolSelection);
    }

    if (validation.missing.length) {
      const expectedMissing = [...unresolvedFields, ...lowConfidenceFields];
      const missingSummary = splitExpectedMissingFields(validation.missing, expectedMissing);
      if (!missingSummary.blocking.length && (mode === 'assist' || mode === 'dry-run')) {
        const preScreenshot = await saveScreenshot(page, job, mode === 'assist' ? 'assist-presubmit' : 'presubmit-dry-run');
        const pageMeta = await captureAssistPageMeta(page);
        if (mode === 'assist') {
          keepBrowserOpen = true;
          await browser.disconnect();
          browser = null;
        }
        return {
          success: true,
          status: 'prepared',
          preImagePath: preScreenshot,
          details: {
            applyUrl,
            filledFields,
            unresolvedFields,
            lowConfidenceFields,
            expectedMissingFields: missingSummary.expectedMissing,
            schoolSelection,
            ...pageMeta,
            validationOnly: mode === 'dry-run',
          },
        };
      }
      const incompleteScreenshot = await saveScreenshot(page, job, 'incomplete');
      const incompleteResult = {
        success: false,
        incompleteImagePath: incompleteScreenshot,
        details: {
          applyUrl,
          filledFields,
          unresolvedFields,
          lowConfidenceFields,
          schoolSelection,
          blockingMissingFields: missingSummary.blocking,
          expectedMissingFields: missingSummary.expectedMissing,
          ...(await captureAssistPageMeta(page)),
        },
        error: `Required fields still empty before submit: ${missingSummary.blocking.join(', ')}. Check screenshot: ${incompleteScreenshot}`,
      };
      if (mode === 'assist') {
        keepBrowserOpen = true;
        log.info('Assist mode: keeping browser open, watching for user submit + security code', { missing: missingSummary.blocking });
        await watchForSecurityCode(page, job);
      }
      return incompleteResult;
    }

    const preScreenshot = await saveScreenshot(page, job, mode === 'assist' ? 'assist-presubmit' : mode === 'dry-run' ? 'presubmit-dry-run' : 'presubmit');
    if (mode === 'assist' || mode === 'dry-run') {
      log.info('Greenhouse guided review ready', {
        company: job.company,
        title: job.title,
        targetFieldName: schoolSelection.targetFieldName,
        rowIndex: schoolSelection.rowIndex,
        mode,
      });
      const pageMeta = await captureAssistPageMeta(page);
      if (mode === 'assist') {
        keepBrowserOpen = true;
        await watchForSecurityCode(page, job);
        await browser.disconnect();
        browser = null;
      }
      return {
        success: true,
        status: 'prepared',
        preImagePath: preScreenshot,
        details: {
          applyUrl,
          filledFields,
          unresolvedFields,
          lowConfidenceFields,
          validationOnly: mode === 'dry-run',
          schoolSelection,
          ...pageMeta,
        },
      };
    }

    const submissionStartedAt = Date.now();
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
        return {
          success: false,
          preImagePath: preScreenshot,
          error: 'Security code not found in Gmail within 45s',
        };
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

    const invalidFields = await getIncompleteRequiredFields(page);
    const pageText = await page.evaluate(() => document.body.innerText);
    const successPhrases = ['thank you', 'application received', 'successfully submitted', 'we have received', 'application has been'];
    const isSuccess = successPhrases.some(p => pageText.toLowerCase().includes(p));
    const isDuplicate = hasDuplicateSubmissionMessage(pageText);
    const isAbuseWarning = hasAbuseWarningMessage(pageText);
    const postSubmitMeta = await page.evaluate(() => {
      function snippet(value, limit = 220) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`;
      }

      function isVisible(node) {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      const visibleInputs = Array.from(document.querySelectorAll('input, textarea, select')).filter(isVisible).length;
      const visibleSubmit = Array.from(document.querySelectorAll('button[type="submit"], button'))
        .filter(isVisible)
        .some((button) => /submit/i.test(button.innerText || ''));
      return {
        pageTitle: document.title || null,
        textSnippet: snippet(document.body?.innerText || ''),
        stillOnForm: Boolean(document.querySelector('form')) && (visibleInputs > 3 || visibleSubmit),
      };
    });

    // Also check if code boxes are gone and no error is shown
    const codeBoxesStillThere = (await page.$$('input[maxlength="1"]')).length === 8;
    const errorText = await page.$('text=Incorrect security code, [class*="error"]').catch(() => null);

    if (errorText || codeBoxesStillThere) {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        error: 'Security code rejected or still showing',
      };
    }

    if (isAbuseWarning) {
      return {
        success: false,
        haltRun: true,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: {
            pageUrl: page.url(),
            pageTitle: postSubmitMeta.pageTitle,
            textSnippet: postSubmitMeta.textSnippet,
          },
        },
        error: `Abuse warning detected after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    const submitOutcome = classifyGreenhouseSubmitOutcome({
      pageText,
      pageUrl: page.url(),
      pageTitle: postSubmitMeta.pageTitle,
      textSnippet: postSubmitMeta.textSnippet,
      invalidFields,
      stillOnForm: postSubmitMeta.stillOnForm,
      isSuccess,
      isDuplicate,
      isAbuseWarning,
    });

    if (submitOutcome.outcome === 'validation-failure') {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: submitOutcome.details,
        },
        error: `Required fields still empty after submit: ${submitOutcome.details.invalidFields.join(', ')}. Check screenshot: ${postScreenshot}`,
      };
    }

    if (submitOutcome.outcome === 'confirmation-missing') {
      const { pageUrl, pageTitle, textSnippet } = submitOutcome.details;
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: submitOutcome.details,
        },
        error: `No success confirmation found after submit. Page URL: ${pageUrl || 'unknown'}. Title: ${pageTitle || 'unknown'}. Snippet: ${textSnippet || 'n/a'}. Check screenshot: ${postScreenshot}`,
      };
    }

    if (isDuplicate) {
      log.info('Existing application confirmed on Greenhouse', { company: job.company, title: job.title });
    }

    const confirmationEmail = await waitForApplicationConfirmation(job, { startedAt: submissionStartedAt });
    if (!confirmationEmail) {
      return {
        success: false,
        preImagePath: preScreenshot,
        postImagePath: postScreenshot,
        details: {
          schoolSelection,
          postSubmit: submitOutcome.details,
        },
        error: `No application confirmation email found after submit. Check screenshot: ${postScreenshot}`,
      };
    }

    log.info('Applied via Greenhouse', { company: job.company, title: job.title, hadSecurityCode: !!usedCode });
    return {
      success: true,
      securityCode: usedCode,
      preImagePath: preScreenshot,
      postImagePath: postScreenshot,
      details: {
        schoolSelection,
        postSubmit: submitOutcome.details,
      },
    };

  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    if (browser && !keepBrowserOpen) await browser.close();
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

module.exports = {
  applyGreenhouse,
  answerForGreenhouseQuestion,
  buildGreenhouseTextSnippet,
  classifyGreenhouseSubmitOutcome,
  greenhouseEducationFieldIsPresent,
  greenhouseComboboxSnapshotIsEmpty,
  greenhouseSelectionMatches,
  resolveGreenhouseQuestionAnswer,
  selectGreenhouseEducationTarget,
};
