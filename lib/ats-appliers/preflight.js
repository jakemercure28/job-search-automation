'use strict';

const fs = require('fs');
const path = require('path');

// Shared pre-flight validation for all ATS appliers (greenhouse, lever, ashby).
// Returns { ok: true, resumeAbsPath } on success, or { ok: false, error } on failure.
function preflightApplicant(applicant) {
  if (!applicant.email) return { ok: false, error: 'APPLICANT_EMAIL not set in .env' };
  if (!applicant.phone) return { ok: false, error: 'APPLICANT_PHONE not set in .env' };

  const resumeAbsPath = path.resolve(process.cwd(), applicant.resumePath);
  if (!fs.existsSync(resumeAbsPath)) {
    return { ok: false, error: `Resume not found: ${resumeAbsPath}` };
  }

  return { ok: true, resumeAbsPath };
}

module.exports = { preflightApplicant };
