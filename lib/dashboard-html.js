'use strict';

const { escapeHtml } = require('./utils');
const { COLORS } = require('./html/helpers');
const { renderStats, renderInsightContent } = require('./html/stats');
const { renderFilters } = require('./html/filters');
const { renderJobTable } = require('./html/job-rows');
const { renderModals } = require('./html/modals');
const { renderAnalytics, renderAutoApplies, renderAutoApplyLog, renderActivityLog } = require('./html/analytics');
const { renderMarketResearch } = require('./html/market-research');
const { buildDashboardHref } = require('./html/helpers');

function renderDashboard({ jobs, pagination, filter, sort, level, searchOptions, dailyDigest, dailyCounts, globalStats, appliedByCompany, apiUsage, scraperHealth, companyTags, analyticsData, marketResearchData, slugHealth, jdHealth }) {
  const { total } = globalStats;

  const scraperChips = renderScraperHealth(scraperHealth);
  const hasInsight = dailyDigest || scraperChips || true; // always render drawer (shows full stats)

  let bodyHtml;
  if (filter === 'analytics') {
    bodyHtml = renderAnalytics(analyticsData);
  } else if (filter === 'auto-applies') {
    bodyHtml = renderAutoApplies(analyticsData);
  } else if (filter === 'activity-log') {
    bodyHtml = renderActivityLog(analyticsData);
  } else if (filter === 'market-research') {
    bodyHtml = renderMarketResearch(marketResearchData?.cache, marketResearchData?.jobCount || 0, marketResearchData?.allJobs, marketResearchData?.applicantYoe);
  } else {
    bodyHtml = renderJobTable(jobs, appliedByCompany, companyTags, filter, sort, level, pagination, searchOptions);
  }

  const apiIndicator = apiUsage
    ? `<div class="api-indicator" style="font-size:11px;color:${apiUsage.used > apiUsage.limit * 0.8 ? COLORS.red : COLORS.muted};margin-left:8px;opacity:0.8">API: ${apiUsage.used}/${apiUsage.limit}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M30 50 L35 38 L40 50 L52 55 L40 60 L35 72 L30 60 L18 55 Z' fill='%23a855f7'/%3E%3Cpath d='M68 22 L71 14 L74 22 L82 25 L74 28 L71 36 L68 28 L60 25 Z' fill='%23c084fc'/%3E%3Cpath d='M72 65 L76 55 L80 65 L90 69 L80 73 L76 83 L72 73 L62 69 Z' fill='%238b5cf6'/%3E%3C/svg%3E">
<title>Job Search Dashboard</title>
<link rel="stylesheet" href="/public/dashboard.css?v=12">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>
<header>
  <div class="header-bar">
    <div></div>
    <nav class="seg-control">
      ${[
        { id: 'all',          label: 'All',          key: 'total' },
        { id: 'not-applied',  label: 'Pending',      key: 'notApplied' },
        { id: 'applied',      label: 'Applied',      key: 'applied' },
        { id: 'interviewing', label: 'Interviewing', key: 'interviewing' },
      ].map(({ id, label, key }) => {
        const active = filter === id;
        const count = globalStats[key] || 0;
        return `<button class="seg-opt${active ? ' active' : ''}" onclick="location='${buildDashboardHref(id, sort, level, searchOptions)}'">
          ${label}<span class="seg-count">${count}</span>
        </button>`;
      }).join('')}
    </nav>
    <div class="header-right">
      <button class="insights-btn" id="insights-btn" onclick="toggleInsights()" title="Daily insights">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
      </button>
      <span class="sec-divider"></span>
      ${apiIndicator || ''}
      <span class="live-badge"><span class="pulse"></span>Live</span>
    </div>
  </div>
  ${renderFilters(filter, sort, globalStats, level, searchOptions)}
</header>
<div id="insight-overlay" class="insight-overlay" onclick="toggleInsights()"></div>
<div id="insight-drawer" class="insight-drawer">
  <div class="insight-drawer-inner">
    <div class="insight-row">
      <div class="insight-left">
        <div class="insight-label">Daily Insight</div>
        ${dailyDigest ? `<p class="insight-text">${escapeHtml(dailyDigest)}</p>` : ''}
        ${renderInsightContent(globalStats)}
        ${scraperChips || ''}
      </div>
      ${dailyCounts && dailyCounts.length ? `<div class="insight-chart-wrap"><canvas id="digest-chart"></canvas></div>` : ''}
    </div>
  </div>
</div>
<div class="page-wrap">
${(() => {
  if (!jdHealth) return '';
  const { critical = [], warn = [], timestamp } = jdHealth;
  if (!critical.length && !warn.length) return '';
  const isCritical = critical.length > 0;
  const bg = isCritical ? '#3b1818' : '#2d1f00';
  const border = isCritical ? '#7f1d1d' : '#78350f';
  const color = isCritical ? '#fca5a5' : '#fbbf24';
  const affected = [...critical, ...warn];
  const label = isCritical
    ? `${critical.length} job${critical.length > 1 ? 's' : ''} with missing/empty JD${warn.length ? `, ${warn.length} short` : ''}`
    : `${warn.length} job${warn.length > 1 ? 's' : ''} with short JD`;
  const preview = affected.slice(0, 5).map(j => `${escapeHtml(j.company)} / ${escapeHtml(j.title)} (${j.len} chars)`).join(', ');
  const more = affected.length > 5 ? `, +${affected.length - 5} more` : '';
  const ts = timestamp ? `<span style="color:#888;margin-left:4px">Checked: ${new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>` : '';
  return `<div style="background:${bg};border:1px solid ${border};padding:8px 16px;margin:8px 16px;border-radius:6px;font-size:13px;color:${color};display:flex;align-items:center;gap:8px">
  <span style="font-size:16px">&#9888;</span>
  <span><strong>${label}</strong> — scores may be wrong. ${preview}${more}. Re-run: <code style="background:#1a1a2e;padding:1px 4px;border-radius:3px">node check-descriptions.js</code>${ts}</span>
</div>`;
})()}
${(() => {
  if (!slugHealth?.broken?.length || slugHealth._dismissed) return '';
  // Only show real failures (404/422), not transient issues (timeouts, 429, 500)
  const real = slugHealth.broken.filter(b => /HTTP (4(?:0[0-9]|22))/.test(b.note));
  if (!real.length) return '';
  return `<div id="slug-banner" style="background:#3b1818;border:1px solid #7f1d1d;padding:8px 16px;margin:8px 16px;border-radius:6px;font-size:13px;color:#fca5a5;display:flex;align-items:center;gap:8px">
  <span style="font-size:16px">&#9888;</span>
  <span style="flex:1"><strong>${real.length} broken ATS slug${real.length > 1 ? 's' : ''}</strong>
  (${real.map(b => b.slug).slice(0, 5).join(', ')}${real.length > 5 ? ', ...' : ''})
  &mdash; run <code style="background:#1a1a2e;padding:1px 4px;border-radius:3px">npm run validate-slugs</code>
  <span style="color:#888;margin-left:4px">Checked: ${new Date(slugHealth.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span>
  <button onclick="fetch('/dismiss-slug-banner',{method:'POST'}).then(()=>document.getElementById('slug-banner').remove())" style="background:none;border:none;color:#fca5a5;cursor:pointer;font-size:16px;padding:0 0 0 8px;opacity:0.7;line-height:1" title="Dismiss">&#10005;</button>
</div>`;
})()}
${bodyHtml}
</div>
<div class="toast" id="toast"></div>
${renderModals()}
<script src="/public/dashboard.js?v=3"></script>
<script>
fetch('/public/bookmarklet.js').then(r=>r.text()).then(js=>{
  document.getElementById('bookmarklet-link').href=js.trim();
});
</script>
<script>
(function() {
  var data = ${JSON.stringify(dailyCounts || [])};
  if (!data.length || !document.getElementById('digest-chart')) return;
  var ctx = document.getElementById('digest-chart').getContext('2d');
  window._insightChart = new Chart(ctx, {
    data: {
      labels: data.map(function(d) { return d.label; }),
      datasets: [
        {
          type: 'bar',
          label: 'Applied',
          data: data.map(function(d) { return d.count; }),
          backgroundColor: 'rgba(99, 102, 241, 0.5)',
          borderColor: '#6366f1',
          borderWidth: 1,
          borderRadius: 4,
          order: 2,
        },
        {
          type: 'line',
          label: 'Target',
          data: data.map(function(d) { return d.target; }),
          borderColor: 'rgba(34, 197, 94, 0.5)',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { titleFont: { family: 'Inter' }, bodyFont: { family: 'Inter' } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10, family: 'Inter' } } },
        y: { display: true, beginAtZero: true, ticks: { color: '#64748b', font: { size: 10, family: 'Inter' }, stepSize: 5 }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Scraper health section (shown in digest panel)
// ---------------------------------------------------------------------------

function renderScraperHealth(scraperHealth) {
  if (!scraperHealth) return '';
  const chips = scraperHealth.length
    ? scraperHealth.map(s => `<span class="scraper-chip">${escapeHtml(s.platform)}: ${s.count}</span>`).join('')
    : '<span class="scraper-chip muted">No jobs added to your queue yet today</span>';
  return `<div class="scraper-health"><span class="scraper-health-label">Added to your queue today:</span>${chips}</div>`;
}

module.exports = { renderDashboard, COLORS };
