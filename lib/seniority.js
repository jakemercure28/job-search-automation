'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Seniority classification — shared between market research and filters
// ---------------------------------------------------------------------------

const YEAR_PATTERNS = [
  /(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp|professional|relevant|hands-on|working|industry|related)/i,
  /(?:experience|exp)[\s:]+(\d+)\+?\s*(?:years?|yrs?)/i,
  /(\d+)\+?\s*(?:years?|yrs?)\s+(?:in|with|of)/i,
  /minimum\s+(?:of\s+)?(\d+)\s*(?:years?|yrs?)/i,
];

function parseYearsFromDescription(desc) {
  if (!desc) return null;
  let maxYears = null;
  for (const p of YEAR_PATTERNS) {
    const matches = [...desc.matchAll(new RegExp(p.source, p.flags + 'g'))];
    for (const m of matches) {
      const y = parseInt(m[1], 10);
      if (y > 0 && y <= 30) {
        if (maxYears === null || y > maxYears) maxYears = y;
      }
    }
  }
  return maxYears;
}

function levelFromTitle(title) {
  if (!title) return 'mid';
  const t = title.toLowerCase();
  if (/\b(junior|jr\.?|entry[- ]level|associate|intern)\b/.test(t)) return 'junior';
  if (/\b(staff|principal|distinguished|fellow|architect)\b/.test(t)) return 'staff';
  if (/\b(lead|manager|director|head|vp)\b/.test(t)) return 'staff';
  if (/\b(senior|sr\.?|iii)\b/.test(t)) return 'senior';
  return 'mid';
}

function levelFromYears(years) {
  if (years <= 2) return 'junior';
  if (years <= 4) return 'mid';
  if (years <= 7) return 'senior';
  return 'staff';
}

function classifySeniority(title, description) {
  const titleLevel = levelFromTitle(title);
  const years = parseYearsFromDescription(description);
  if (years !== null) return { level: levelFromYears(years), years, source: 'jd' };
  return { level: titleLevel, years: null, source: 'title' };
}

/** Returns true if the job is accessible at ~4 YOE */
function isAccessible(title, description) {
  const { level, years } = classifySeniority(title, description);
  if (years !== null) return years <= 4;
  return level === 'junior' || level === 'mid';
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_PATTERN = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`, 'gi');

function computeApplicantYoe(profileDir) {
  const expDir = path.join(profileDir, 'experience');
  let earliestMs = null;
  try {
    const files = fs.readdirSync(expDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const text = fs.readFileSync(path.join(expDir, file), 'utf8');
      for (const m of text.matchAll(MONTH_PATTERN)) {
        const month = MONTHS.indexOf(m[1].toLowerCase());
        const year = parseInt(m[2], 10);
        const ms = Date.UTC(year, month, 1);
        if (earliestMs === null || ms < earliestMs) earliestMs = ms;
      }
    }
  } catch (_) {
    return null;
  }
  if (earliestMs === null) return null;
  return Math.floor((Date.now() - earliestMs) / (365.25 * 24 * 3600 * 1000));
}

module.exports = { parseYearsFromDescription, levelFromYears, classifySeniority, isAccessible, computeApplicantYoe };
