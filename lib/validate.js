'use strict';

const log = require('./logger')('validate');
const REQUIRED_FIELDS = ['id', 'platform', 'title', 'company', 'url'];

function validateJob(job) {
  if (!job || typeof job !== 'object') return null;
  for (const field of REQUIRED_FIELDS) {
    if (typeof job[field] !== 'string' || !job[field]) return null;
  }
  return {
    id: job.id,
    platform: job.platform,
    title: job.title,
    company: job.company,
    url: job.url,
    postedAt: job.postedAt || '',
    description: job.description || '',
    location: job.location || '',
  };
}

function validateJobs(jobs, label) {
  const valid = jobs.map(validateJob).filter(Boolean);
  const dropped = jobs.length - valid.length;
  if (dropped > 0) {
    log.warn('Dropped malformed jobs', { source: label, count: dropped });
  }
  return valid;
}

module.exports = { validateJob, validateJobs };
