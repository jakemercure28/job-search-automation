'use strict';

// Delegates to the active profile's companies.js, then merges in any
// Gemini-discovered companies from suggested-companies.json (if it exists).
const path = require('path');
const fs = require('fs');

const { loadSuggested } = require('../lib/suggested-companies');

const profileDir = process.env.JOB_PROFILE_DIR
  ? path.resolve(process.env.JOB_PROFILE_DIR)
  : path.join(__dirname, '..', 'profiles', 'example');
const profileCompanies = path.join(profileDir, 'companies.js');

if (!fs.existsSync(profileCompanies)) {
  throw new Error(`No companies.js found for profile at ${profileCompanies}`);
}

const base = require(profileCompanies);
const suggested = loadSuggested(profileDir);

const addNew = (arr, extra) => extra.length ? [...new Set([...arr, ...extra])] : arr;

module.exports = {
  ...base,
  GREENHOUSE_COMPANIES: addNew(base.GREENHOUSE_COMPANIES || [], suggested.greenhouse),
  ASHBY_COMPANIES:      addNew(base.ASHBY_COMPANIES      || [], suggested.ashby),
  LEVER_COMPANIES:      addNew(base.LEVER_COMPANIES      || [], suggested.lever),
};
