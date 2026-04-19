'use strict';

const {
  extractLinks,
  hasTerm,
  getReadableEmailText,
  parseMatchableUrl,
  normalizeText,
} = require('./parser');

function getActiveAppliedJobs(db) {
  return db.prepare(`
    SELECT id, company, title, url, stage, status, applied_at
    FROM jobs
    WHERE applied_at IS NOT NULL
      AND COALESCE(stage, '') NOT IN ('rejected')
  `).all();
}

function matchByUrl(message, jobs) {
  const links = extractLinks(`${message.raw || ''}\n${message.subject || ''}`);
  if (!links.length) return null;

  const parsedLinks = links.map(parseMatchableUrl).filter(Boolean);
  if (!parsedLinks.length) return null;

  const candidates = jobs.filter((job) => {
    const parsedJobUrl = parseMatchableUrl(job.url);
    if (!parsedJobUrl) return false;

    return parsedLinks.some((link) => {
      if (parsedJobUrl.host !== link.host) return false;
      if (parsedJobUrl.jobId && link.jobId && parsedJobUrl.jobId === link.jobId) return true;
      if (parsedJobUrl.uuid && link.uuid && parsedJobUrl.uuid === link.uuid) return true;
      return parsedJobUrl.path && link.path && parsedJobUrl.path === link.path;
    });
  });

  if (candidates.length !== 1) return null;
  return {
    job: candidates[0],
    confidence: 'strong',
    reason: 'url_match',
  };
}

function matchByCompanyAndTitle(message, jobs) {
  const text = getReadableEmailText(message);
  const companies = new Map();

  for (const job of jobs) {
    if (!hasTerm(text, job.company)) continue;
    const key = normalizeText(job.company);
    const bucket = companies.get(key) || [];
    bucket.push(job);
    companies.set(key, bucket);
  }

  if (!companies.size) {
    return { job: null, confidence: 'none', reason: 'no_company_match' };
  }

  if (companies.size > 1) {
    return { job: null, confidence: 'none', reason: 'multiple_company_matches' };
  }

  const [companyJobs] = companies.values();
  if (companyJobs.length === 1) {
    return {
      job: companyJobs[0],
      confidence: 'medium',
      reason: 'single_active_company_job',
    };
  }

  const titleMatches = companyJobs.filter((job) => hasTerm(text, job.title));
  if (titleMatches.length === 1) {
    return {
      job: titleMatches[0],
      confidence: 'strong',
      reason: 'company_title_match',
    };
  }

  if (titleMatches.length > 1) {
    return { job: null, confidence: 'none', reason: 'multiple_title_matches' };
  }

  return { job: null, confidence: 'none', reason: 'ambiguous_company_match' };
}

function matchRejectionEmail(db, message) {
  const jobs = getActiveAppliedJobs(db);
  const urlMatch = matchByUrl(message, jobs);
  if (urlMatch) return urlMatch;
  return matchByCompanyAndTitle(message, jobs);
}

module.exports = {
  getActiveAppliedJobs,
  matchByUrl,
  matchByCompanyAndTitle,
  matchRejectionEmail,
};
