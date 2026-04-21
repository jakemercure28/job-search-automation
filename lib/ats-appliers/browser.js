'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const log = require('../logger')('auto-apply');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREENSHOT_DIR = path.join(__dirname, '../../logs/screenshots');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DUPLICATE_SUBMISSION_PATTERNS = [
  /already submitted an application/i,
  /already applied/i,
  /application (has )?already been submitted/i,
];
const ABUSE_WARNING_PATTERNS = [
  /looks like spam/i,
  /possible spam/i,
  /flagged as.*spam/i,
  /suspicious activity/i,
  /too many (requests|attempts|applications)/i,
  /temporarily blocked/i,
  /automated activity/i,
  /unusual activity/i,
];

/**
 * Launch a headless (or headed) Puppeteer browser using system Chrome.
 * Pass { headless: false } to see the browser window (useful during /apply sessions).
 */
async function launchBrowser({ headless = true } = {}) {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

function slugify(value) {
  return String(value || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown';
}

/**
 * Build a screenshot file path for a given job or company label.
 * Format: logs/screenshots/{prefix-}{company[-title]}-{timestamp}.png
 */
function screenshotPath(target, prefix = '') {
  const company = typeof target === 'object' ? target.company : target;
  const title = typeof target === 'object' ? target.title : '';
  const slug = [slugify(company), title ? slugify(title).slice(0, 80) : '']
    .filter(Boolean)
    .join('-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = prefix ? `${prefix}-` : '';
  return path.join(SCREENSHOT_DIR, `${tag}${slug}-${timestamp}.png`);
}

/**
 * Take a full-page screenshot and save it. Warns but does not throw on failure.
 */
async function saveScreenshot(page, target, prefix = '') {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const p = screenshotPath(target, prefix);
    await page.screenshot({ path: p, fullPage: true });
    log.info('Screenshot saved', { path: p });
    return p;
  } catch (e) {
    log.warn('Screenshot failed', { error: e.message });
    return null;
  }
}

async function getIncompleteRequiredFields(page) {
  return page.evaluate(() => {
    function isVisible(node) {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function fieldLabel(node) {
      if (node.id) {
        const label = document.querySelector(`label[for="${node.id}"]`);
        if (label?.innerText) return label.innerText.trim();
      }
      const wrappingLabel = node.closest('label');
      if (wrappingLabel?.innerText) return wrappingLabel.innerText.trim();
      const group = node.closest('[class*="field"], [class*="form-group"], [role="group"]');
      const groupLabel = group?.querySelector('label, legend');
      if (groupLabel?.innerText) return groupLabel.innerText.trim();
      return node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.name || node.id || node.type || 'unknown field';
    }

    function isRequired(node) {
      if (node.required) return true;
      if ((node.getAttribute('aria-required') || '').toLowerCase() === 'true') return true;
      return /[*]|\brequired\b/i.test(fieldLabel(node));
    }

    function comboboxShell(node) {
      return node.closest('.select-shell')
        || node.parentElement?.closest('.select-shell')
        || node.closest('[class*="select-shell"]')
        || node.closest('.select__control')
        || node.parentElement?.closest('.select__control')
        || node.closest('[class*="select__control"]')
        || node.closest('[class*="field"], [class*="form-group"], [role="group"]');
    }

    function hasSatisfiedCombobox(node) {
      const className = String(node.className || '');
      const role = String(node.getAttribute('role') || '').toLowerCase();
      if (role !== 'combobox' && !className.includes('select__input')) return false;

      const shell = comboboxShell(node);
      if (!shell) return false;

      const renderedValue = shell.querySelector('[class*="single-value"]');
      const hasValueContainer = shell.querySelector('[class*="value-container--has-value"]');
      const placeholder = shell.querySelector('[class*="placeholder"]');
      return Boolean(
        (renderedValue && (renderedValue.innerText || '').trim())
        || hasValueContainer
        || ((node.value || '').trim() && !(placeholder && (placeholder.innerText || '').trim()))
      );
    }

    const fields = Array.from(document.querySelectorAll('input, textarea, select'));
    const missing = [];
    const seenRadioNames = new Set();

    for (const field of fields) {
      const type = (field.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      if (!isVisible(field)) continue;
      if (!isRequired(field)) continue;

      if (type === 'radio') {
        if (seenRadioNames.has(field.name)) continue;
        seenRadioNames.add(field.name);
        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(field.name)}"]`))
          .filter(isVisible);
        if (radios.length && radios.some((radio) => radio.checked)) continue;
        missing.push(fieldLabel(field));
        continue;
      }

      if (type === 'checkbox') {
        if (field.checked) continue;
        missing.push(fieldLabel(field));
        continue;
      }

      if (hasSatisfiedCombobox(field)) {
        continue;
      }

      if (type === 'file') {
        if ((field.files || []).length > 0) continue;
        missing.push(fieldLabel(field));
        continue;
      }

      if (field.tagName.toLowerCase() === 'select') {
        if ((field.value || '').trim()) continue;
        missing.push(fieldLabel(field));
        continue;
      }

      if ((field.value || '').trim()) continue;
      missing.push(fieldLabel(field));
    }

    return [...new Set(missing)].slice(0, 20);
  });
}

/**
 * Set up a new browser page with standard user agent.
 */
async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  return page;
}

/**
 * Click a field (select all) then type a value into it.
 * Returns true on success, false if the element wasn't found.
 */
async function fillField(page, selector, value, { delay = 30 } = {}) {
  const el = await page.$(selector);
  if (el) {
    await el.click({ clickCount: 3 });
    await el.type(value, { delay });
    return true;
  }
  log.warn('Field not found', { selector });
  return false;
}

/**
 * Find the real submit button on a page, skipping buttons labeled "Upload", "Yes", "No", etc.
 * Returns the first button whose visible text includes "submit" (case-insensitive) and
 * does not include "upload".
 */
async function findSubmitButton(page) {
  // First pass: typed submit buttons that say "submit" (not "upload")
  const typedBtns = await page.$$('button[type="submit"]');
  for (const btn of typedBtns) {
    const text = await btn.evaluate(el => el.innerText.trim().toLowerCase());
    if (text.includes('submit') && !text.includes('upload')) return btn;
  }

  // Second pass: any button whose label says "submit application" or "submit"
  // (Ashby uses buttons without type="submit")
  const allBtns = await page.$$('button');
  for (const btn of allBtns) {
    const text = await btn.evaluate(el => el.innerText.trim().toLowerCase());
    if ((text === 'submit' || text === 'submit application' || text.startsWith('submit')) && !text.includes('upload')) {
      return btn;
    }
  }

  // Fall back to any typed submit button
  return typedBtns[0] || null;
}

/**
 * Copy a resume file to os.tmpdir with a clean display name.
 * Returns the temp path. Caller is responsible for cleanup.
 */
function stageResume(resumeAbsPath, displayName) {
  const os = require('os');
  const filename = displayName ? `${displayName}.pdf` : 'Resume.pdf';
  const tmp = path.join(os.tmpdir(), filename);
  fs.copyFileSync(resumeAbsPath, tmp);
  return tmp;
}

function hasDuplicateSubmissionMessage(pageText) {
  return DUPLICATE_SUBMISSION_PATTERNS.some((pattern) => pattern.test(pageText || ''));
}

function hasAbuseWarningMessage(pageText) {
  return ABUSE_WARNING_PATTERNS.some((pattern) => pattern.test(pageText || ''));
}

module.exports = { launchBrowser, screenshotPath, saveScreenshot, getIncompleteRequiredFields, newPage, fillField, findSubmitButton, stageResume, hasDuplicateSubmissionMessage, hasAbuseWarningMessage, CHROME_PATH, SCREENSHOT_DIR };
