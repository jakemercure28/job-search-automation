'use strict';

const {
  extractLinks,
  hasTerm,
  getReadableEmailText,
  parseMatchableUrl,
  normalizeText,
} = require('./parser');
const log = require('../logger')('email-match');

const TRAILING_COMPANY_SUFFIXES = [
  'data',
];

function companyTerms(company) {
  const normalized = normalizeText(company);
  const terms = new Set([company]);
  const compact = normalized.replace(/\s+/g, '');

  for (const suffix of TRAILING_COMPANY_SUFFIXES) {
    if (compact.endsWith(suffix) && compact.length > suffix.length + 4) {
      terms.add(compact.slice(0, -suffix.length));
    }
  }

  return [...terms];
}

function hasCompanyTerm(text, company) {
  return companyTerms(company).some((term) => hasTerm(text, term));
}

function getAppliedJobs(db, where = '') {
  return db.prepare(`
    SELECT id, company, title, url, stage, status, applied_at
    FROM jobs
    WHERE applied_at IS NOT NULL
      ${where}
  `).all();
}

function getActiveAppliedJobs(db) {
  return getAppliedJobs(db, "AND COALESCE(stage, '') NOT IN ('rejected')");
}

function getRejectedAppliedJobs(db) {
  return getAppliedJobs(db, "AND COALESCE(stage, '') = 'rejected'");
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
    if (!hasCompanyTerm(text, job.company)) continue;
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
  if (urlMatch) {
    log.info('Match found', {
      method: urlMatch.reason,
      confidence: urlMatch.confidence,
      jobId: urlMatch.job?.id,
      company: urlMatch.job?.company,
      subject: (message.subject || '').slice(0, 80),
    });
    return urlMatch;
  }

  const result = matchByCompanyAndTitle(message, jobs);
  if (result.job) {
    log.info('Match found', {
      method: result.reason,
      confidence: result.confidence,
      jobId: result.job?.id,
      company: result.job?.company,
      subject: (message.subject || '').slice(0, 80),
    });
  } else if (result.reason === 'no_company_match') {
    const rejectedJobs = getRejectedAppliedJobs(db);
    const rejectedUrlMatch = matchByUrl(message, rejectedJobs);
    if (rejectedUrlMatch) {
      log.info('Match found', {
        method: rejectedUrlMatch.reason,
        confidence: rejectedUrlMatch.confidence,
        jobId: rejectedUrlMatch.job?.id,
        company: rejectedUrlMatch.job?.company,
        subject: (message.subject || '').slice(0, 80),
      });
      return rejectedUrlMatch;
    }

    const rejectedResult = matchByCompanyAndTitle(message, rejectedJobs);
    if (rejectedResult.job) {
      log.info('Match found', {
        method: rejectedResult.reason,
        confidence: rejectedResult.confidence,
        jobId: rejectedResult.job?.id,
        company: rejectedResult.job?.company,
        subject: (message.subject || '').slice(0, 80),
      });
    }
    return rejectedResult;
  } else {
    log.debug('No match', {
      reason: result.reason,
      subject: (message.subject || '').slice(0, 80),
    });
  }
  return result;
}

module.exports = {
  companyTerms,
  getActiveAppliedJobs,
  getAppliedJobs,
  getRejectedAppliedJobs,
  matchByUrl,
  matchByCompanyAndTitle,
  matchRejectionEmail,
};
