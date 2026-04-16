'use strict';

const { stripHtml, safeFetch } = require('../lib/utils');
const { detectAts } = require('../lib/atsDetector');
const { matchesSearchTerms } = require('../lib/scraper-utils');

async function scrapeRemoteOK() {
  const jobs = [];
  const url = 'https://remoteok.com/api';
  const res = await safeFetch(
    url,
    { headers: { 'User-Agent': 'job-search-bot/1.0 (personal use)' } },
    'remoteok'
  );
  if (!res) return jobs;

  let data;
  try { data = await res.json(); } catch { return jobs; }

  // First element is a legal notice object, skip it
  for (const job of Array.isArray(data) ? data.slice(1) : []) {
    const title = job.position || '';
    if (!matchesSearchTerms(title)) continue;

    // Prefer the canonical ATS URL (apply_url) over the RemoteOK aggregator link
    const ats = detectAts(job.apply_url);
    const canonicalUrl = ats ? job.apply_url : (job.url || `https://remoteok.com/remote-jobs/${job.slug}`);

    jobs.push({
      id: `remoteok-${job.id}`,
      platform: ats ? ats.platform : 'RemoteOK',
      title,
      company: job.company || '',
      url: canonicalUrl,
      postedAt: job.date || new Date().toISOString(),
      description: stripHtml(job.description || ''),
      location: 'Remote',
    });
  }

  return jobs;
}

module.exports = { scrapeRemoteOK };
