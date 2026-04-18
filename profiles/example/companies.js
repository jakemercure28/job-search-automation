'use strict';

// Example target-company config for the example profile.
// Each array lists company slugs on a specific ATS platform. The scraper fetches
// job boards for each slug and filters by SEARCH_TERMS.
//
// The slugs below are a small demo set. To target real companies, replace
// these with the actual slugs visible in each platform's public job-board URL.
// For example, a Greenhouse board at boards.greenhouse.io/stripe has slug 'stripe'.

const MAX_AGE_DAYS = 20;

const SEARCH_TERMS = [
  'backend',
  'platform engineer',
  'infrastructure engineer',
  'site reliability',
  'sre',
  'cloud engineer',
  'devops',
];

// Greenhouse boards: https://boards.greenhouse.io/<slug>
const GREENHOUSE_COMPANIES = [
  'stripe',
  'airbnb',
  'coinbase',
  'dropbox',
  // hashicorp removed — IBM acquisition, board defunct as of Apr 2026
  'datadog',
  'anthropic',
  'figma',   // moved from Lever → Greenhouse
  'vercel',  // moved from Lever → Greenhouse
];

// Lever boards: https://jobs.lever.co/<slug>
const LEVER_COMPANIES = [
  'netflix',
  // github removed — not found on Lever/Greenhouse/Ashby (likely Workday via Microsoft)
  // ramp removed — board empty/unreachable across all checked ATS as of Apr 2026
];

// Workable boards: https://apply.workable.com/<slug>
const WORKABLE_COMPANIES = [
  'remote',
  'huggingface',
  'hotjar',
];

// Ashby boards: https://jobs.ashbyhq.com/<slug>
const ASHBY_COMPANIES = [
  'openai',
  'linear',
  'mercury',
  'anyscale',
  'modal',
];

// Workday boards: https://<slug>.wd1.myworkdayjobs.com
const WORKDAY_COMPANIES = [
  // Add workday-hosted company slugs here. They often look like 'acme.wd5'.
];

// Wellfound (AngelList) is searched by role name, not company slug.
const WELLFOUND_ROLES = [
  'platform-engineer',
  'site-reliability-engineer',
  'backend-engineer',
];

// Rippling-hosted public boards.
const RIPPLING_COMPANIES = [
  // Add rippling-hosted company slugs here.
];

// Jobicy, Arbeitnow, RemoteOK, WeWorkRemotely, and Built In don't take
// per-company slugs. They're global listings filtered by SEARCH_TERMS.

module.exports = {
  MAX_AGE_DAYS,
  SEARCH_TERMS,
  GREENHOUSE_COMPANIES,
  LEVER_COMPANIES,
  WORKABLE_COMPANIES,
  ASHBY_COMPANIES,
  WORKDAY_COMPANIES,
  WELLFOUND_ROLES,
  RIPPLING_COMPANIES,
};
