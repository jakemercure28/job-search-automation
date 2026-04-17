'use strict';

function normalizeDashboardQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parseDashboardSearchOptions(url) {
  const q = normalizeDashboardQuery(url.searchParams.get('q'));
  const rawMinScore = Number.parseInt(url.searchParams.get('minScore') || '1', 10);
  const minScore = Number.isInteger(rawMinScore)
    ? Math.min(Math.max(rawMinScore, 1), 9)
    : 1;
  return { q, minScore };
}

function jobMatchesSearch(job, q) {
  if (!q) return true;
  const haystack = [
    job.title,
    job.company,
    job.location,
    job.description,
    job.reasoning,
    job.claude_reasoning,
    job.rejection_reasoning,
    job.status,
    job.stage,
    job.apply_complexity,
    job.platform,
  ].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function applyDashboardSearch(jobs, searchOptions) {
  const q = normalizeDashboardQuery(searchOptions?.q);
  const rawMinScore = Number.parseInt(String(searchOptions?.minScore ?? '1'), 10);
  const minScore = Number.isInteger(rawMinScore)
    ? Math.min(Math.max(rawMinScore, 1), 9)
    : 1;

  return jobs.filter((job) => {
    const score = Number(job.score ?? job.claude_score ?? 0);
    if (score < minScore) return false;
    return jobMatchesSearch(job, q);
  });
}

module.exports = {
  normalizeDashboardQuery,
  parseDashboardSearchOptions,
  jobMatchesSearch,
  applyDashboardSearch,
};
