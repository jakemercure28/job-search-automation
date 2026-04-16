'use strict';

// Applicant identity used by the auto-applier and application prep prompts.
// All values are read from environment variables. See .env.example for the full list.
// If a field is empty, downstream code either skips that ATS field or aborts with a clear error.

module.exports = {
  firstName: process.env.APPLICANT_FIRST_NAME || '',
  lastName: process.env.APPLICANT_LAST_NAME || '',
  email: process.env.APPLICANT_EMAIL || '',
  phone: process.env.APPLICANT_PHONE || '',
  linkedin: process.env.APPLICANT_LINKEDIN || '',
  github: process.env.APPLICANT_GITHUB || '',
  location: process.env.APPLICANT_CITY || process.env.APPLICANT_LOCATION || '',
};
