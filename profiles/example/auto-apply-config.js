'use strict';

const applicantDefaults = require('../../config/applicant');

// Auto-apply configuration for the example profile.
// Sensitive values (email, phone, identity) are read from environment variables.
// Set AUTO_APPLY_ENABLED=false in .env to disable without touching this file.

module.exports = {
  enabled: process.env.AUTO_APPLY_ENABLED !== 'false',

  // Target successful auto-applications per day.
  // Skips and failed attempts do not consume this quota.
  dailyLimit: Number(process.env.AUTO_APPLY_DAILY_SUCCESS_LIMIT) || 3,

  // Applicant profile sourced from .env via config/applicant.js.
  // Resume is selected automatically per job: resume-ai.pdf for AI roles, resume.pdf otherwise.
  applicant: {
    firstName: applicantDefaults.firstName,
    lastName: applicantDefaults.lastName,
    email: applicantDefaults.email,
    phone: applicantDefaults.phone,
    linkedin: applicantDefaults.linkedin,
    github: applicantDefaults.github,
    location: applicantDefaults.location,
    currentCompany: process.env.APPLICANT_CURRENT_COMPANY || '',
  },

  // Companies to skip even if score >= threshold.
  // Add slugs or partial company names (case-insensitive substring match).
  blocklist: [],

  // Platforms to skip in unattended mode. Ashby is blocked by default because
  // repeated automated submits can trigger duplicate/spam warnings.
  platformBlocklist: (process.env.AUTO_APPLY_PLATFORM_BLOCKLIST || 'ashby')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
};
