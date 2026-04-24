'use strict';

// Delegates to the active profile's companies.js.
// Defaults to profiles/example when no JOB_PROFILE_DIR is set.
const path = require('path');
const fs = require('fs');

const profileDir = process.env.JOB_PROFILE_DIR
  ? path.resolve(process.env.JOB_PROFILE_DIR)
  : path.join(__dirname, '..', 'profiles', 'example');
const profileCompanies = path.join(profileDir, 'companies.js');

if (fs.existsSync(profileCompanies)) {
  module.exports = require(profileCompanies);
} else {
  throw new Error(`No companies.js found for profile at ${profileCompanies}`);
}
