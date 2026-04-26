'use strict';

const fs = require('fs');
const path = require('path');
const log = require('../logger')('preflight');

// Shared pre-flight validation for all ATS appliers (greenhouse, lever, ashby).
// Returns { ok: true, resumeAbsPath } on success, or { ok: false, error } on failure.
function preflightApplicant(applicant) {
  if (!applicant.email) {
    log.error('Preflight failed', { reason: 'APPLICANT_EMAIL not set in .env' });
    return { ok: false, error: 'APPLICANT_EMAIL not set in .env' };
  }
  if (!applicant.phone) {
    log.error('Preflight failed', { reason: 'APPLICANT_PHONE not set in .env' });
    return { ok: false, error: 'APPLICANT_PHONE not set in .env' };
  }

  const resumeAbsPath = path.resolve(process.cwd(), applicant.resumePath);
  if (!fs.existsSync(resumeAbsPath)) {
    log.error('Preflight failed', { reason: 'Resume not found', path: resumeAbsPath });
    return { ok: false, error: `Resume not found: ${resumeAbsPath}` };
  }

  log.info('Preflight passed', { email: applicant.email, resume: path.basename(resumeAbsPath) });
  return { ok: true, resumeAbsPath };
}

module.exports = { preflightApplicant };
