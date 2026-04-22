'use strict';

const SEARCHABLE_JOB_FIELDS = [
  'title',
  'company',
  'location',
  'description',
  'reasoning',
  'rejection_reasoning',
  'status',
  'stage',
  'apply_complexity',
  'platform',
];

function normalizeDashboardQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeDashboardSearchOptions(searchOptions) {
  const q = normalizeDashboardQuery(searchOptions?.q);
  const rawMinScore = Number.parseInt(String(searchOptions?.minScore ?? '1'), 10);
  const minScore = Number.isInteger(rawMinScore)
    ? Math.min(Math.max(rawMinScore, 1), 9)
    : 1;
  return { q, minScore };
}

function buildJobSearchText(job) {
  return SEARCHABLE_JOB_FIELDS
    .map((field) => job?.[field])
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function jobMatchesNormalizedSearch(job, normalizedQuery) {
  if (!normalizedQuery) return true;
  return buildJobSearchText(job).includes(normalizedQuery);
}

function parseDashboardSearchOptions(url) {
  return normalizeDashboardSearchOptions({
    q: url.searchParams.get('q'),
    minScore: url.searchParams.get('minScore'),
  });
}

function jobMatchesSearch(job, q) {
  return jobMatchesNormalizedSearch(job, normalizeDashboardQuery(q).toLowerCase());
}

function applyDashboardSearch(jobs, searchOptions) {
  const { q, minScore } = normalizeDashboardSearchOptions(searchOptions);
  const normalizedQuery = q.toLowerCase();

  return jobs.filter((job) => {
    const score = Number(job.score ?? 0);
    if (score < minScore) return false;
    return jobMatchesNormalizedSearch(job, normalizedQuery);
  });
}

module.exports = {
  normalizeDashboardQuery,
  normalizeDashboardSearchOptions,
  parseDashboardSearchOptions,
  jobMatchesSearch,
  applyDashboardSearch,
};
