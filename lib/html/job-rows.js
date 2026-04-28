'use strict';

const { AI_TITLE_KW, AI_DESC_KW } = require('../../config/constants');
const { parseCompanyTags } = require('../company-tags');
const { escapeHtml } = require('../utils');
const { COLORS, scoreColor, scoreClass, postedTimestamp, formatPosted, PIPELINE_LABELS, pipelineValue, pipelineColor, buildDashboardHref } = require('./helpers');

const ICON_EYE   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_SEND  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;
const ICON_FILE  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;
const ICON_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`;
const ICON_X     = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_DOTS  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;

const STATE_ABBR = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN',
  'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
  'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  'District of Columbia': 'DC', 'Washington DC': 'DC', 'Washington, DC': 'DC',
};

function normalizeLocation(loc) {
  if (!loc) return '';
  let s = loc.trim();

  // Remote: any variant mentioning remote/wfh/anywhere
  if (/\bremote\b|work.from.home|\bwfh\b|\banywhere\b|\bany.?location\b/i.test(s)) return 'Remote';

  // Hybrid / On-site
  if (/\bhybrid\b/i.test(s)) return 'Hybrid';
  if (/\bin.?office\b/i.test(s)) return 'On-site';

  // Multi-location: pipe-separated
  if (s.includes('|')) {
    const p = s.split('|').map(x => x.trim()).filter(Boolean);
    return p.length >= 2 ? `${p.length} locations` : normalizeLocation(p[0]);
  }

  // Multi-location: semicolon-separated
  if (s.includes(';')) {
    const p = s.split(';').map(x => x.trim()).filter(Boolean);
    if (p.length >= 3) return `${p.length} locations`;
    if (p.length === 2) s = p[0]; // take first of two
  }

  // Multi-location: slash-separated (3+ = count, 2 = keep as is)
  if (s.includes('/')) {
    const p = s.split('/').map(x => x.trim()).filter(Boolean);
    if (p.length >= 3) return `${p.length} locations`;
    // 2 parts: fall through, will be truncated if too long
  }

  // "USA - City, State" or "USA - State"
  s = s.replace(/^USA\s*[-–,|]\s*/i, '');

  // "State - City" (abbrev) → "City, State" e.g. "WA - Seattle"
  const abbrDashCity = s.match(/^([A-Z]{2})\s*[-–]\s*(.+)$/);
  if (abbrDashCity) s = `${abbrDashCity[2].trim()}, ${abbrDashCity[1]}`;

  // "StateName - City" → "City, ST" e.g. "California - Pleasanton"
  for (const [full, abbr] of Object.entries(STATE_ABBR)) {
    const m = s.match(new RegExp(`^${full}\\s*[-–]\\s*(.+)$`, 'i'));
    if (m) { s = `${m[1].trim()}, ${abbr}`; break; }
  }

  // Strip leading country: "United States, City" → "City"
  s = s.replace(/^(United States(?: of America)?|U\.S\.A?\.?|USA?)\s*[,/]\s*/i, '');

  // Strip trailing country
  s = s.replace(/[,]?\s*(USA|United States(?: of America)?|U\.S\.A?\.?)\s*$/i, '');

  // Strip parenthetical non-remote suffixes "(HQ)", "(Hybrid)" etc.
  s = s.replace(/\s*\([^)]{0,40}\)\s*$/i, '');

  // "City Office, Building/Suite" → "City" — strip " Office, …" suffix
  s = s.replace(/\s+Office\s*,.*/i, '');

  // Strip trailing " Office", " HQ", " Headquarters", " Campus"
  s = s.replace(/\s+(Office|HQ|Headquarters|Campus|Engineering HQ)\s*$/i, '');

  // Full state names → abbreviations
  for (const [full, abbr] of Object.entries(STATE_ABBR)) {
    s = s.replace(new RegExp(`\\b${full}\\b`, 'g'), abbr);
  }

  // Clean up
  s = s.trim().replace(/,\s*$/, '').replace(/\s{2,}/g, ' ');

  if (s.length > 22) s = s.slice(0, 21) + '\u2026';
  return s;
}

function extractSalary(desc) {
  if (!desc) return null;
  // Search full description — salary often appears at the bottom in compensation sections
  const text = desc;
  // Match "$X[,000] - $Y[,000]" or "$Xk - $Yk" variants (with range)
  const rangeRe = /\$\s*(\d{1,3}(?:,\d{3})*|\d+)\s*[kK]?\s*(?:[-–—]|to|up\s+to)\s*\$?\s*(\d{1,3}(?:,\d{3})*|\d+)\s*[kK]?/g;
  let best = null;
  let m;
  while ((m = rangeRe.exec(text)) !== null) {
    const raw1 = parseFloat(m[1].replace(/,/g, ''));
    const raw2 = parseFloat(m[2].replace(/,/g, ''));
    // Normalize: if looks like thousands (e.g. 150 in "$150k"), keep; if looks like full (150000), divide
    const toK = v => v >= 1000 ? Math.round(v / 1000) : v;
    const lo = toK(raw1), hi = toK(raw2);
    // Sanity check: plausible salary range ($30k–$600k)
    if (lo >= 30 && hi >= lo && hi <= 600) {
      best = `$${lo}k\u2013$${hi}k`;
      break;
    }
  }
  return best;
}

function highlightNegative(escapedText) {
  return escapedText.replace(
    /\b(falls?\s+short|missing|lacks?|lack\s+of|gaps?|not\s+familiar|unfamiliar|limited\s+experience|no\s+experience|below\s+requirements?|doesn'?t\s+have|does\s+not\s+have|underqualified|insufficient|no\s+mention)\b/gi,
    '<span class="reasoning-neg">$&</span>'
  );
}

// Format a posted_at value into a short "Mon DD" string for the date column
function fmtColDate(val) {
  const raw = formatPosted(val);
  if (!raw || raw === '\u2014') return '';
  const parts = raw.split('-');
  if (parts.length < 3) return raw;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(parts[1], 10) - 1;
  return `${months[m]} ${parseInt(parts[2], 10)}`;
}

function formatBadgeDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function getAutoApplyBadge(_job) {
  return null;
}

function detectAts(job) {
  const p = (job.platform || '').toLowerCase();
  const u = (job.url || '').toLowerCase();
  if (p.includes('greenhouse') || u.includes('greenhouse.io')) return 'greenhouse';
  if (p.includes('ashby') || u.includes('ashbyhq.com')) return 'ashby';
  if (p.includes('lever') || u.includes('lever.co')) return 'lever';
  if (p.includes('workday') || u.includes('myworkdayjobs.com')) return 'workday';
  return null;
}

function renderJobListHeader(filter, sort, level, searchOptions) {
  const scoreActive = sort !== 'date';
  const dateActive = sort === 'date';
  const dateLabel = filter === 'rejected' ? 'Date Rejected' : 'Date';
  return `<div class="job-list-header">
  <button class="sort-col-btn${scoreActive ? ' active' : ''}" onclick="location='${buildDashboardHref(filter, 'score', level, searchOptions)}'">Score ${scoreActive ? '&#8595;' : '&#8593;'}</button>
  <div class="job-list-header-cell">Title</div>
  <button class="sort-col-btn${dateActive ? ' active' : ''}" onclick="location='${buildDashboardHref(filter, 'date', level, searchOptions)}'">${dateLabel} ${dateActive ? '&#8595;' : '&#8593;'}</button>
  <div class="job-list-header-cell">Location</div>
  <div class="job-list-header-cell">Status</div>
  <div></div>
</div>`;
}

function renderJobPagination(filter, sort, level, pagination, searchOptions) {
  if (!pagination || !pagination.totalItems) return '';

  const { page, totalPages, startItem, endItem, totalItems } = pagination;
  const pageLinks = [];
  const visiblePages = new Set([1, totalPages, page - 1, page, page + 1].filter(p => p >= 1 && p <= totalPages));
  let lastPage = 0;

  for (const pageNum of [...visiblePages].sort((a, b) => a - b)) {
    if (pageNum - lastPage > 1) pageLinks.push('<span class="pagination-ellipsis">...</span>');
    pageLinks.push(
      pageNum === page
        ? `<span class="pagination-link active">${pageNum}</span>`
        : `<a class="pagination-link" href="${buildDashboardHref(filter, sort, level, { ...searchOptions, page: pageNum })}">${pageNum}</a>`
    );
    lastPage = pageNum;
  }

  const prevLink = page > 1
    ? `<a class="pagination-btn" href="${buildDashboardHref(filter, sort, level, { ...searchOptions, page: page - 1 })}">&larr; Prev</a>`
    : '<span class="pagination-btn disabled">&larr; Prev</span>';
  const nextLink = page < totalPages
    ? `<a class="pagination-btn" href="${buildDashboardHref(filter, sort, level, { ...searchOptions, page: page + 1 })}">Next &rarr;</a>`
    : '<span class="pagination-btn disabled">Next &rarr;</span>';

  return `<div class="job-pagination">
  <div class="pagination-summary">Showing ${startItem}-${endItem} of ${totalItems}</div>
  <div class="pagination-controls">
    ${prevLink}
    ${pageLinks.join('')}
    ${nextLink}
  </div>
</div>`;
}

function renderJobTable(jobs, appliedByCompany, companyTags, filter, sort, level, pagination, searchOptions = {}) {
  filter = filter || 'all';
  sort = sort || 'score';
  if (!jobs.length) {
    return renderJobListHeader(filter, sort, level, searchOptions) + '<div class="empty">No jobs found for this filter.</div>';
  }

  const cards = jobs.map(j => {
    const pval = pipelineValue(j);
    const eid = escapeHtml(j.id);
    const eTitle = escapeHtml(j.title);
    const eCompany = escapeHtml(j.company);
    const eUrl = escapeHtml(j.url);
    const eLoc = j.location ? escapeHtml(j.location) : '';
    const effectiveReasoning = j.rejection_reasoning || j.reasoning || '';
    const eReasoning = effectiveReasoning
      ? highlightNegative(escapeHtml(effectiveReasoning))
      : '';
    const sc = j.score;

    const isRejected = j.stage === 'rejected';
    const rejectedFromLabel = j.rejected_from_stage
      ? (PIPELINE_LABELS[j.rejected_from_stage] || j.rejected_from_stage)
      : null;

    const coKey = j.company.toLowerCase().trim();
    const appliedCount = (appliedByCompany || {})[coKey] || 0;
    const isApplied = ['applied', 'responded'].includes(j.status);

    const tags = parseCompanyTags((companyTags || {})[coKey] || []);
    const badgeParts = [];

    for (const tag of tags) {
      badgeParts.push(`<span class="complexity-badge company-tag${tag === 'agency' ? ' tag-agency' : ''}">${escapeHtml(tag)}</span>`);
    }

    if (j.applied_at) {
      const appliedDate = formatBadgeDate(j.applied_at);
      badgeParts.push(`<span class="complexity-badge applied-date" title="Applied on ${escapeHtml(appliedDate)}">Applied ${escapeHtml(appliedDate)}</span>`);
    }

    if (!isApplied && appliedCount > 0) {
      badgeParts.push(`<span class="complexity-badge applied-co" title="${appliedCount} other app${appliedCount > 1 ? 's' : ''} at ${eCompany}">${appliedCount} applied</span>`);
    }

    const isAiResume = AI_TITLE_KW.test(j.title || '') || AI_DESC_KW.test((j.description || '').slice(0, 1500));
    if (isAiResume) {
      badgeParts.push('<span class="badge-ai" title="Lead with AI tooling">AI</span>');
    }

    if (j.apply_complexity === 'custom-url') {
      badgeParts.push('<span class="complexity-badge custom-url" title="Custom domain — auto-fill may not work">custom url</span>');
    }

    const autoBadge = getAutoApplyBadge(j);
    if (autoBadge) {
      badgeParts.push(`<span class="complexity-badge ${autoBadge.className}" title="${escapeHtml(autoBadge.title)}">${autoBadge.label}</span>`);
    }

    if (j.tailored_resume_status === 'ready') {
      badgeParts.push('<span class="complexity-badge auto-ready" title="Tailored resume generated">resume</span>');
    } else if (j.tailored_resume_status === 'failed') {
      badgeParts.push('<span class="complexity-badge auto-failed" title="Tailored resume generation failed">resume!</span>');
    }

    if (isRejected && rejectedFromLabel) {
      badgeParts.push(`<span class="complexity-badge rejected-from">From: ${escapeHtml(rejectedFromLabel)}</span>`);
    }

    if (isRejected && j.rejected_at) {
      badgeParts.push(`<span class="complexity-badge rejected-date" title="Rejected on ${escapeHtml(j.rejected_at.slice(0, 10))}">${escapeHtml(j.rejected_at.slice(0, 10))}</span>`);
    }

    const salaryText = extractSalary(j.description);
    if (salaryText) {
      badgeParts.push(`<span class="badge-salary">${salaryText}</span>`);
    }

    const atsName = detectAts(j);
    if (atsName) {
      badgeParts.push(`<span class="badge-ats badge-ats-${atsName}">${atsName}</span>`);
    }

    const badgesHtml = badgeParts.length
      ? `<span class="job-badges">${badgeParts.join('')}</span>`
      : '';

    const isHot = sc != null && sc > 8;
    const cardExtra = isHot ? ' score-hot' : '';

    const reasoningPanel = eReasoning
      ? `<div class="reasoning-panel" id="reasoning-${eid}"><div class="reasoning-panel-inner">${highlightNegative(escapeHtml(effectiveReasoning))}</div></div>`
      : '';

    const reachContent = j.reached_out_at
      ? `${ICON_CHECK}<span class="outreach-date">${escapeHtml(j.reached_out_at.slice(5,10))}</span> Reached`
      : `${ICON_SEND} Reach out`;
    const reachOnclick = j.reached_out_at
      ? `markOutreach('${eid}', true)`
      : `markOutreach('${eid}', false)`;
    const reachTitle = j.reached_out_at
      ? `Reached out ${escapeHtml(j.reached_out_at.slice(0,10))} — click to clear`
      : 'Mark outreach';

    const colDateValue = isRejected ? (j.rejected_at || j.updated_at) : j.posted_at;
    const colDate = fmtColDate(colDateValue);

    return `
    <div class="job-card${cardExtra}" data-id="${eid}" data-status="${escapeHtml(j.status)}" data-posted-ts="${postedTimestamp(j.posted_at)}" data-applied-ts="${postedTimestamp(j.applied_at)}" style="--score-color:${scoreColor(sc)}">
      <div class="job-col-score">
        <span class="score-circle ${scoreClass(sc)}">${sc ?? '?'}</span>
      </div>
      <div class="job-col-info">
        <div class="job-title"><a href="${eUrl}" target="_blank">${eTitle}</a></div>
        <div class="job-company"><span class="job-company-name">${eCompany}</span>${badgesHtml}</div>
      </div>
      <div class="job-col-date">${colDate}</div>
      <div class="job-col-location" title="${eLoc}">${normalizeLocation(j.location ? j.location : '')}</div>
      <div class="job-col-status">
        <select class="pipeline-select" onchange="setPipeline('${eid}', this.value, this)" style="color:${pipelineColor(pval)}">
          <option value="" ${pval===''?'selected':''} style="color:${COLORS.slateDark}">\u2014</option>
          <option value="applied" ${pval==='applied'?'selected':''} style="color:${COLORS.blue}">Applied</option>
          <option value="phone_screen" ${pval==='phone_screen'?'selected':''} style="color:${COLORS.accent}">Phone Screen</option>
          <option value="interview" ${pval==='interview'?'selected':''} style="color:${COLORS.purple}">Interview</option>
          <option value="onsite" ${pval==='onsite'?'selected':''} style="color:${COLORS.amber}">Onsite</option>
          <option value="offer" ${pval==='offer'?'selected':''} style="color:${COLORS.green}">Offer</option>
          <option value="closed" ${pval==='closed'?'selected':''} style="color:${COLORS.slateLight}">Closed</option>
          <option value="rejected" ${pval==='rejected'?'selected':''} style="color:${COLORS.red}">Rejected</option>
        </select>
      </div>
      <div class="job-col-actions">
        <button class="btn-dots" onclick="toggleJobMenu('${eid}', this)" title="Actions">${ICON_DOTS}</button>
        <div class="job-actions-menu" id="jmenu-${eid}">
          <button class="job-action-item" onclick="toggleReasoning('${eid}', this); closeJobMenu('${eid}')"${!eReasoning ? ' disabled' : ''}>${ICON_EYE} Reasoning</button>
          <a class="job-action-item" href="/job-application-prep?id=${eid}" target="_blank" rel="noreferrer" onclick="closeJobMenu('${eid}')">${ICON_FILE} Manual Apply Prep</a>
          <button class="job-action-item" id="tailor-resume-btn-${eid}" onclick="tailorResume('${eid}', this); closeJobMenu('${eid}')">${ICON_FILE} Tailor Resume</button>
          ${j.tailored_resume_status === 'ready' ? `<a class="job-action-item" href="/tailored-resume?id=${eid}" target="_blank" rel="noreferrer" onclick="closeJobMenu('${eid}')">${ICON_EYE} View Tailored Resume</a>` : ''}
          <button class="job-action-item" id="outreach-btn-${eid}" onclick="${reachOnclick}" title="${reachTitle}">${reachContent}</button>
          <button class="job-action-item" onclick="openApplyImage('${eid}','${eTitle.replace(/'/g,"\\'")}','${eCompany.replace(/'/g,"\\'")}'); closeJobMenu('${eid}')">${ICON_IMAGE} View Apply Image</button>
          <button class="job-action-item" onclick="openJobDescription('${eid}','${eTitle.replace(/'/g,"\\'")}','${eCompany.replace(/'/g,"\\'")}'); closeJobMenu('${eid}')">${ICON_FILE} View JD</button>
          <button class="job-action-item danger" onclick="archiveJob('${eid}', this)">${ICON_X} Archive</button>
        </div>
      </div>
      ${reasoningPanel}
    </div>`;
  }).join('');

  return renderJobListHeader(filter, sort, level, searchOptions)
    + `<div class="job-list filter-${escapeHtml(filter)}" id="job-tbody">${cards}</div>`
    + renderJobPagination(filter, sort, level, pagination, searchOptions);
}

module.exports = { renderJobTable, renderJobListHeader };
