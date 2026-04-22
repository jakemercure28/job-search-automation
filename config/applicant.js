'use strict';

// Applicant identity used by the auto-applier and application prep prompts.
// All values are read from environment variables. See .env.example for the full list.
// If a field is empty, downstream code either skips that ATS field or aborts with a clear error.

function envYesNo(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return /^(1|true|yes|y)$/i.test(String(raw).trim()) ? 'Yes' : 'No';
}

module.exports = {
  firstName: process.env.APPLICANT_FIRST_NAME || '',
  lastName: process.env.APPLICANT_LAST_NAME || '',
  email: process.env.APPLICANT_EMAIL || '',
  phone: process.env.APPLICANT_PHONE || '',
  linkedin: process.env.APPLICANT_LINKEDIN || '',
  github: process.env.APPLICANT_GITHUB || '',
  location: process.env.APPLICANT_CITY || process.env.APPLICANT_LOCATION || '',
  zipCode: process.env.APPLICANT_ZIP_CODE || process.env.APPLICANT_ZIP || '',
  country: process.env.APPLICANT_COUNTRY || 'United States',
  heardAbout: process.env.APPLICANT_HEARD_ABOUT || 'LinkedIn',
  currentCompany: process.env.APPLICANT_CURRENT_COMPANY || '',
  desiredBaseSalary: process.env.APPLICANT_DESIRED_BASE_SALARY || '',
  usWorkAuthorized: envYesNo('APPLICANT_US_WORK_AUTHORIZED', 'Yes'),
  usCitizen: envYesNo('APPLICANT_US_CITIZEN', ''),
  requiresSponsorship: envYesNo('APPLICANT_REQUIRES_SPONSORSHIP', 'No'),
  residesInUs: envYesNo('APPLICANT_RESIDES_IN_US', 'Yes'),
  backgroundCheckConsent: envYesNo('APPLICANT_BACKGROUND_CHECK_CONSENT', 'Yes'),
  awsExperience: envYesNo('APPLICANT_AWS_EXPERIENCE', 'Yes'),
  kubernetesExperience: envYesNo('APPLICANT_KUBERNETES_EXPERIENCE', 'Yes'),
  clearanceEligible: envYesNo('APPLICANT_CLEARANCE_ELIGIBLE', 'No'),
  previousClearance: process.env.APPLICANT_PREVIOUS_CLEARANCE || 'None',
  exportControlsEligible: envYesNo('APPLICANT_EXPORT_CONTROLS_ELIGIBLE', 'Yes'),
  workedAtEmployerBefore: envYesNo('APPLICANT_WORKED_AT_EMPLOYER_BEFORE', 'No'),
  hasConflictOfInterest: envYesNo('APPLICANT_HAS_CONFLICT_OF_INTEREST', 'No'),
  eeoGender: process.env.APPLICANT_EEO_GENDER || 'decline to self-identify',
  eeoGenderIdentity: process.env.APPLICANT_EEO_GENDER_IDENTITY || 'decline to answer',
  eeoPronouns: process.env.APPLICANT_EEO_PRONOUNS || '',
  eeoOrientation: process.env.APPLICANT_EEO_ORIENTATION || 'decline to answer',
  eeoHispanic: process.env.APPLICANT_EEO_HISPANIC || 'decline to answer',
  eeoRace: process.env.APPLICANT_EEO_RACE || 'decline to answer',
  eeoVeteran: process.env.APPLICANT_EEO_VETERAN || 'decline to answer',
  eeoDisability: process.env.APPLICANT_EEO_DISABILITY || "don't wish to answer",
};
