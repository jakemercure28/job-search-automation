'use strict';

const { stripHtml } = require('./utils');

const WORKABLE_ENDPOINTS = [
  {
    name: 'public-account',
    url: (slug) => `https://www.workable.com/api/accounts/${slug}?details=true`,
    options: () => ({ headers: { Accept: 'application/json' } }),
  },
  {
    name: 'widget-account',
    url: (slug) => `https://apply.workable.com/api/v1/widget/accounts/${slug}`,
    options: () => ({ headers: { Accept: 'application/json' } }),
  },
  {
    name: 'v3-account-jobs',
    url: (slug) => `https://apply.workable.com/api/v3/accounts/${slug}/jobs`,
    options: () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
    }),
  },
];

function readableLocation(location) {
  if (!location) return '';
  if (typeof location === 'string') return location;
  if (Array.isArray(location)) return location.map(readableLocation).filter(Boolean).join('; ');
  if (typeof location === 'object') {
    return [
      location.city,
      location.region,
      location.state,
      location.country,
      location.name,
    ].filter(Boolean).join(', ');
  }
  return '';
}

function looksLikeWorkableJob(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value.title || value.full_title) &&
    (value.shortcode || value.code || value.id || value.url || value.application_url)
  );
}

function collectJobObjects(value, jobs = [], seen = new Set()) {
  if (!value || typeof value !== 'object') return jobs;
  if (Array.isArray(value)) {
    if (value.some(looksLikeWorkableJob)) {
      for (const item of value) {
        if (!looksLikeWorkableJob(item)) continue;
        const key = item.shortcode || item.code || item.id || item.url || JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(item);
      }
      return jobs;
    }
    for (const item of value) collectJobObjects(item, jobs, seen);
    return jobs;
  }

  for (const nested of Object.values(value)) collectJobObjects(nested, jobs, seen);
  return jobs;
}

function accountName(data, slug) {
  return data?.name ||
    data?.company?.name ||
    data?.account?.name ||
    data?.account?.company_name ||
    slug;
}

function normalizeWorkableJobs(data, slug) {
  const company = accountName(data, slug);
  return collectJobObjects(data).map((job) => {
    const shortcode = job.shortcode || job.code || job.id;
    const url = job.url || job.application_url || job.apply_url ||
      (shortcode ? `https://apply.workable.com/j/${shortcode}` : `https://apply.workable.com/${slug}`);
    const description = [
      job.description,
      job.description_html,
      job.full_description,
      job.requirements,
    ].filter(Boolean).join('\n\n');

    return {
      id: `workable-${slug}-${shortcode || String(url).split('/').filter(Boolean).pop()}`,
      platform: 'Workable',
      title: job.title || job.full_title || '',
      company: job.company || company,
      url,
      postedAt: job.created_at || job.published_at || job.published || job.updated_at || '',
      description: stripHtml(description || ''),
      location: readableLocation(job.location || job.locations || job.city || job.country || ''),
    };
  });
}

async function fetchJsonWithStatus(url, options, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, options);
    let data = null;
    if (res && res.ok) {
      try { data = await res.json(); } catch {}
    }
    return {
      ok: Boolean(res?.ok),
      status: res?.status || 0,
      url: res?.url || url,
      data,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e.message,
      url,
      data: null,
    };
  }
}

async function fetchWorkableAccountJobs(slug, { fetch: fetchImpl = fetch } = {}) {
  const attempts = [];

  for (const endpoint of WORKABLE_ENDPOINTS) {
    const url = endpoint.url(slug);
    const result = await fetchJsonWithStatus(url, endpoint.options(slug), fetchImpl);
    const jobs = result.ok ? normalizeWorkableJobs(result.data, slug) : [];
    attempts.push({
      endpoint: endpoint.name,
      url,
      status: result.status,
      ok: result.ok,
      count: jobs.length,
      error: result.error || null,
    });

    if (result.ok) {
      return {
        result: jobs.length > 0 ? 'ok' : 'empty',
        count: jobs.length,
        jobs,
        attempts,
      };
    }
  }

  const blocked = attempts.find((attempt) => attempt.status === 429);
  if (blocked) {
    return {
      result: 'blocked',
      count: 0,
      jobs: [],
      note: `HTTP 429 at ${blocked.endpoint}`,
      attempts,
    };
  }

  const last = attempts[attempts.length - 1] || {};
  return {
    result: 'broken',
    count: 0,
    jobs: [],
    note: `HTTP ${last.status || last.error || 0}`,
    attempts,
  };
}

module.exports = {
  WORKABLE_ENDPOINTS,
  fetchWorkableAccountJobs,
  normalizeWorkableJobs,
};
