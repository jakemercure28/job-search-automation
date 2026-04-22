'use strict';

const COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  muted: '#94a3b8',
  red: '#ef4444',
  accent: '#a855f7',
  blue: '#3b82f6',
  purple: '#a855f7',
  slateDark: '#475569',
  slateLight: '#64748b',
};

function scoreColor(score) {
  if (score == null) return 'transparent';
  if (score >= 9) return '#e9d5ff';  // Near-white lavender — excellent
  if (score >= 7) return '#a855f7';  // Bright violet — good
  if (score >= 5) return '#5b21b6';  // Mid purple — borderline
  return '#2e1065';                  // Very dark purple — weak
}

function scoreClass(score) {
  if (score == null) return 'score-null';
  if (score >= 8) return 'score-high';
  if (score >= 6) return 'score-mid';
  return 'score-low';
}

function postedTimestamp(val) {
  if (!val) return 0;
  if (val.match(/^\d{4}-\d{2}-\d{2}/)) return new Date(val).getTime();
  const today = new Date();
  if (/today/i.test(val)) return today.getTime();
  const m = val.match(/(\d+)\+?\s*day/i);
  if (m) {
    const d = new Date(today);
    d.setDate(d.getDate() - parseInt(m[1], 10));
    return d.getTime();
  }
  return 0;
}

function formatPosted(val) {
  if (!val) return '\u2014';
  if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.slice(0, 10);
  const today = new Date();
  if (/today/i.test(val)) return today.toISOString().slice(0, 10);
  const m = val.match(/(\d+)\+?\s*day/i);
  if (m) {
    const d = new Date(today);
    d.setDate(d.getDate() - parseInt(m[1], 10));
    return d.toISOString().slice(0, 10);
  }
  return '\u2014';
}

const PIPELINE_LABELS = {
  '': '\u2014',
  applied: 'Applied',
  phone_screen: 'Phone Screen',
  interview: 'Interview',
  onsite: 'Onsite',
  offer: 'Offer',
  closed: 'Closed',
  rejected: 'Rejected',
};

function pipelineValue(j) {
  if (j.stage === 'closed') return 'closed';
  if (j.stage === 'rejected') return 'rejected';
  if (!['applied', 'responded'].includes(j.status)) return '';
  return j.stage || 'applied';
}

function pipelineColor(val) {
  const map = {
    '': COLORS.slateDark,
    applied: COLORS.blue,
    phone_screen: COLORS.accent,
    interview: COLORS.purple,
    onsite: COLORS.amber,
    offer: COLORS.green,
    closed: COLORS.slateLight,
    rejected: COLORS.red,
  };
  return map[val] || COLORS.slateDark;
}

// ---------------------------------------------------------------------------
// Filter tab definitions — single source of truth for rendering & validation
// ---------------------------------------------------------------------------

const FILTER_DEFS = [
  { id: 'all',          label: 'All',          countKey: 'total',        color: COLORS.slateDark },
  { id: 'not-applied',  label: 'Not Applied',  countKey: 'notApplied',   color: COLORS.slateDark },
  { id: 'applied',      label: 'Applied',      countKey: 'applied',      color: COLORS.blue },
  { id: 'interviewing', label: 'Interviewing', countKey: 'interviewing', color: COLORS.purple },
  { id: 'rejected',     label: 'Rejected',     countKey: 'rejected',     color: COLORS.red },
  { id: 'closed',       label: 'Closed',       countKey: 'closed',       color: COLORS.slateDark },
  { id: 'archived',     label: 'Archived',     countKey: 'archived',     color: COLORS.slateDark },
  { id: 'analytics',        label: 'Analytics',       hidden: true },
  { id: 'auto-applies',     label: 'Auto Applies',    hidden: true },
  { id: 'activity-log',     label: 'Activity Log',    hidden: true },
  { id: 'market-research',  label: 'Market Research', hidden: true },
];

function countBadge(count, color) {
  if (!count) return '';
  return ` <span style="background:${color};color:#fff;border-radius:10px;padding:1px 6px;font-size:11px;font-weight:700;margin-left:4px">${count}</span>`;
}

function buildDashboardHref(filter, sort, level, searchOptions = {}) {
  const params = new URLSearchParams({
    filter: filter || 'all',
    sort: sort || 'score',
  });

  if (level === '1') params.set('level', '1');

  const q = typeof searchOptions.q === 'string' ? searchOptions.q.trim() : '';
  if (q) params.set('q', q);

  const rawMinScore = Number.parseInt(String(searchOptions.minScore ?? '1'), 10);
  const minScore = Number.isInteger(rawMinScore) ? Math.min(Math.max(rawMinScore, 1), 9) : 1;
  if (minScore > 1) params.set('minScore', String(minScore));

  const rawPage = Number.parseInt(String(searchOptions.page ?? ''), 10);
  if (Number.isInteger(rawPage) && rawPage > 1) params.set('page', String(rawPage));

  return `/?${params.toString()}`;
}

module.exports = { COLORS, scoreColor, scoreClass, postedTimestamp, formatPosted, PIPELINE_LABELS, pipelineValue, pipelineColor, FILTER_DEFS, countBadge, buildDashboardHref };
