'use strict';

const { escapeHtml } = require('../utils');
const { COLORS } = require('./helpers');

function renderPaginatedTable(tableId, emptyCols, rowsHtml, totalRows, prevLabel, nextLabel, pagerFn) {
  return `
    <table class="calibration-table" id="${tableId}">
      ${rowsHtml}
    </table>
    ${totalRows > 20 ? `
    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <button class="btn btn-sm btn-archive" onclick="${pagerFn}(-1)" id="${tableId}-prev" disabled>${prevLabel}</button>
      <span style="font-size:12px;color:var(--text-muted)" id="${tableId}-page-info"></span>
      <button class="btn btn-sm btn-archive" onclick="${pagerFn}(1)" id="${tableId}-next">${nextLabel}</button>
    </div>
    <script>
    (function(){
      var PAGE_SIZE=20, page=0;
      var rows=document.querySelectorAll('#${tableId} tbody tr');
      var total=rows.length, pages=Math.ceil(total/PAGE_SIZE);
      function show(){
        rows.forEach(function(r,i){r.style.display=(i>=page*PAGE_SIZE&&i<(page+1)*PAGE_SIZE)?'':'none';});
        document.getElementById('${tableId}-prev').disabled=page===0;
        document.getElementById('${tableId}-next').disabled=page>=pages-1;
        document.getElementById('${tableId}-page-info').textContent='Page '+(page+1)+' of '+pages;
      }
      window.${pagerFn}=function(d){page=Math.max(0,Math.min(pages-1,page+d));show();};
      show();
    })();
    </script>` : ''}`;
}

function renderActivityLog(data) {
  if (!data) return '<div class="empty">No activity log data available.</div>';
  const { recentEvents } = data;
  const EVENT_LABELS = {
    stage_change: 'Pipeline',
    outreach: 'Outreach',
    status_change: 'Status',
  };
  const STAGE_DISPLAY = { applied: 'Applied', phone_screen: 'Phone Screen', interview: 'Interview', onsite: 'Onsite', offer: 'Offer', rejected: 'Rejected', reached_out: 'Reached Out', archived: 'Archived' };
  const eventRows = (recentEvents || []).map(e => {
    const from = STAGE_DISPLAY[e.from_value] || e.from_value || '\u2014';
    const to = STAGE_DISPLAY[e.to_value] || e.to_value || '\u2014';
    const date = e.created_at ? new Date(e.created_at.endsWith('Z') ? e.created_at : e.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    return `
      <tr>
        <td style="color:${COLORS.muted};font-size:11px;white-space:nowrap;font-family:var(--font-mono)">${date}</td>
        <td><span style="background:rgba(168,85,247,0.1);color:#a855f7;padding:2px 6px;border-radius:4px;font-size:11px">${EVENT_LABELS[e.event_type] || e.event_type}</span></td>
        <td>${escapeHtml(e.company)}</td>
        <td>${from} &rarr; ${to}</td>
      </tr>`;
  }).join('');

  return `
<div class="analytics-wrap">
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Activity Log</h2>
    <p class="analytics-hint"><span style="font-family:var(--font-mono)">${(recentEvents || []).length}</span> total events</p>
    ${renderPaginatedTable(
      'events-table',
      4,
      `<thead><tr><th>Time</th><th>Type</th><th>Company</th><th>Change</th></tr></thead><tbody>${eventRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No events yet</td></tr>'}</tbody>`,
      (recentEvents || []).length,
      '&larr; Newer',
      'Older &rarr;',
      'pageEvents'
    )}
  </div>
</div>`;
}

function getLatestRealAutoApplyOutcomes(rows) {
  const latestByJob = new Map();

  for (const row of rows || []) {
    if (row.dry_run) continue;

    const jobKey = row.job_id || `${row.company || ''}::${row.title || ''}`;
    const existing = latestByJob.get(jobKey);

    if (!existing || row.attempted_at > existing.attempted_at) {
      latestByJob.set(jobKey, row);
    }
  }

  return Array.from(latestByJob.values());
}

function renderAutoApplyLog(data) {
  if (!data) return '<div class="empty">No apply receipt data available.</div>';
  const rows = data.autoApplyAttempts || data.autoApplyLog || [];
  const latestRealRows = getLatestRealAutoApplyOutcomes(rows);
  const dryRows = rows.filter(r => r.dry_run);
  const succeeded = latestRealRows.filter(r => r.status === 'success').length;
  const failed = latestRealRows.filter(r => r.status === 'failed').length;

  const applyRows = rows.map(r => {
    const date = r.attempted_at ? new Date(r.attempted_at.endsWith('Z') ? r.attempted_at : r.attempted_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const statusIcon = r.dry_run
      ? `<span style="background:#374151;color:#9ca3af;font-size:10px;padding:2px 6px;border-radius:3px;font-family:var(--font-mono);letter-spacing:0.04em">DRY RUN</span>`
      : r.status === 'success'
        ? `<span style="color:#4ade80;font-weight:700">&#10003;</span>`
        : `<span style="color:#f87171;font-weight:700">&#10007;</span>`;
    const scoreColor = r.score >= 8 ? '#d8b4fe' : r.score >= 6 ? '#a855f7' : '#6d28d9';
    const codeCell = r.security_code
      ? `<span style="font-family:var(--font-mono);font-size:11px">${escapeHtml(r.security_code)}</span>`
      : `<span style="color:var(--text-muted)">\u2014</span>`;
    const errorCell = r.error
      ? `<span style="color:#f87171;font-size:11px" title="${escapeHtml(r.error)}">${escapeHtml((r.error || '').slice(0, 45))}${r.error.length > 45 ? '\u2026' : ''}</span>`
      : `<span style="color:var(--text-muted)">\u2014</span>`;
    const resumeCell = r.resume_filename
      ? `<span style="font-family:var(--font-mono);font-size:11px">${escapeHtml(r.resume_filename)}</span>`
      : `<span style="color:var(--text-muted)">\u2014</span>`;
    return `
      <tr>
        <td style="color:${COLORS.muted};font-size:11px;white-space:nowrap;font-family:var(--font-mono)">${date}</td>
        <td><span style="background:${scoreColor};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-family:var(--font-mono)">${r.score || '?'}</span></td>
        <td>${escapeHtml(r.company)}</td>
        <td style="font-size:12px">${escapeHtml((r.title || '').slice(0, 40))}${(r.title || '').length > 40 ? '\u2026' : ''}</td>
        <td>${resumeCell}</td>
        <td style="text-align:center">${statusIcon}</td>
        <td>${codeCell}</td>
        <td>${errorCell}</td>
      </tr>`;
  }).join('');

  return `
<div class="analytics-wrap">
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Apply Receipt Log</h2>
    <p class="analytics-hint"><span style="font-family:var(--font-mono)">${latestRealRows.length}</span> jobs &mdash; <span style="color:#4ade80;font-family:var(--font-mono)">${succeeded}</span> succeeded, <span style="color:#f87171;font-family:var(--font-mono)">${failed}</span> failed${dryRows.length > 0 ? ` &nbsp;<span style="color:var(--text-muted);font-size:11px">(+ ${dryRows.length} dry run${dryRows.length !== 1 ? 's' : ''})</span>` : ''}</p>
    ${renderPaginatedTable(
      'apply-log-table',
      8,
      `<thead><tr><th>Date</th><th>Score</th><th>Company</th><th>Role</th><th>Resume</th><th>Status</th><th>Code</th><th>Error</th></tr></thead><tbody>${applyRows || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No apply receipts yet</td></tr>'}</tbody>`,
      rows.length,
      '&larr; Newer',
      'Older &rarr;',
      'pageApplyLog'
    )}
  </div>
</div>`;
}

function renderAutoApplies(data) {
  if (!data) return '<div class="empty">No apply receipt data available.</div>';

  const rows = data.autoApplyAttempts || [];
  const summary = data.autoApplySummary || { total: rows.length, submitted: 0, prepared: 0, failed: 0, dryRun: 0, retryNeeded: 0 };
  const filters = data.autoApplyFilters || {};
  const failureCounts = {
    manualReview: rows.filter((row) => row.failure_class === 'manual-review-needed').length,
    closedPage: rows.filter((row) => row.failure_class === 'closed-page').length,
    providerThrottled: rows.filter((row) => row.failure_class === 'provider-throttled').length,
  };

  const filterValue = (value) => escapeHtml(String(value || ''));
  const scoreValue = Number.isInteger(filters.minScore) ? String(filters.minScore) : '';
  const daysValue = Number.isInteger(filters.days) ? String(filters.days) : '';

  const cards = [
    ['Prepared', summary.prepared, '#64748b'],
    ['Submitted', summary.submitted, '#22c55e'],
    ['Failed', summary.failed, '#ef4444'],
    ['Dry Run', summary.dryRun, '#94a3b8'],
    ['Retry Needed', summary.retryNeeded, '#f59e0b'],
  ].map(([label, value, color]) => `
    <div style="background:rgba(15,23,42,0.85);border:1px solid var(--border);border-radius:10px;padding:14px 16px;min-width:120px">
      <div style="color:${COLORS.muted};font-size:11px;text-transform:uppercase;letter-spacing:0.08em">${label}</div>
      <div style="color:${color};font-size:24px;font-family:var(--font-mono);margin-top:4px">${value}</div>
    </div>
  `).join('');
  const queueQuality = [
    ['Manual Review', failureCounts.manualReview, '#f59e0b', 'manual-review-needed'],
    ['Closed Page', failureCounts.closedPage, '#64748b', 'closed-page'],
    ['Provider Throttled', failureCounts.providerThrottled, '#ef4444', 'provider-throttled'],
  ].map(([label, value, color, failureClass]) => `
    <a href="/?filter=auto-applies&autoFailureClass=${encodeURIComponent(failureClass)}" style="display:block;text-decoration:none;background:rgba(15,23,42,0.6);border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:160px">
      <div style="color:${COLORS.muted};font-size:11px;text-transform:uppercase;letter-spacing:0.08em">${label}</div>
      <div style="color:${color};font-size:22px;font-family:var(--font-mono);margin-top:4px">${value}</div>
    </a>
  `).join('');

  const attemptRows = rows.map((row) => {
    const date = row.attempted_at ? new Date(row.attempted_at.endsWith('Z') ? row.attempted_at : `${row.attempted_at}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const statusColor = row.status === 'success'
      ? '#22c55e'
      : row.status === 'prepared'
        ? '#64748b'
        : '#ef4444';
    const modeLabel = row.dry_run ? 'dry-run' : row.mode || 'submit';
    const artifactLinks = [
      row.artifact_links?.resume ? `<a href="${row.artifact_links.resume}" target="_blank" rel="noreferrer">PDF</a>` : null,
      row.artifact_links?.pre ? `<a href="${row.artifact_links.pre}" target="_blank" rel="noreferrer">Pre</a>` : null,
      row.artifact_links?.post ? `<a href="${row.artifact_links.post}" target="_blank" rel="noreferrer">Post</a>` : null,
    ].filter(Boolean).join(' · ') || '<span style="color:var(--text-muted)">—</span>';
    return `
      <tr>
        <td style="white-space:nowrap;color:${COLORS.muted};font-size:11px;font-family:var(--font-mono)">${date}</td>
        <td>${escapeHtml(row.company)}</td>
        <td style="font-size:12px">${escapeHtml((row.title || '').slice(0, 44))}${(row.title || '').length > 44 ? '…' : ''}</td>
        <td><span style="background:${row.score >= 8 ? '#d8b4fe' : row.score >= 6 ? '#a855f7' : '#6d28d9'};color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;font-family:var(--font-mono)">${row.score || '?'}</span></td>
        <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(row.platform || '—')}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(modeLabel)}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(row.resume_filename || '—')}</td>
        <td style="font-size:11px">${artifactLinks}</td>
        <td><span style="color:${statusColor};font-family:var(--font-mono);font-size:11px">${escapeHtml(row.status)}</span>${row.failure_class ? `<div style="color:${COLORS.muted};font-size:10px;margin-top:2px">${escapeHtml(row.failure_class)}</div>` : ''}</td>
        <td>${row.error ? `<button class="btn btn-sm btn-archive" onclick="openAutoApplyAttempt(${Number(row.attempt_id)})">Details</button>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      </tr>`;
  }).join('');

  return `
<div class="analytics-wrap">
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Apply Receipts</h2>
    <p class="analytics-hint"><span style="font-family:var(--font-mono)">${summary.total}</span> historical attempts in view. Receipts include the PDF used, screenshots, actor, and failure class.</p>
    <form method="GET" action="/" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin:14px 0 18px">
      <input type="hidden" name="filter" value="auto-applies" />
      <input type="hidden" name="sort" value="score" />
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:${COLORS.muted}">Status
        <select name="autoStatus" style="min-width:120px">
          <option value="">All</option>
          <option value="success"${filters.status === 'success' ? ' selected' : ''}>Success</option>
          <option value="prepared"${filters.status === 'prepared' ? ' selected' : ''}>Prepared</option>
          <option value="failed"${filters.status === 'failed' ? ' selected' : ''}>Failed</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:${COLORS.muted}">Platform
        <select name="autoPlatform" style="min-width:120px">
          <option value="">All</option>
          <option value="greenhouse"${filters.platform === 'greenhouse' ? ' selected' : ''}>Greenhouse</option>
          <option value="lever"${filters.platform === 'lever' ? ' selected' : ''}>Lever</option>
          <option value="ashby"${filters.platform === 'ashby' ? ' selected' : ''}>Ashby</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:${COLORS.muted}">Mode
        <select name="autoMode" style="min-width:120px">
          <option value="">All</option>
          <option value="real"${filters.mode === 'real' ? ' selected' : ''}>Real</option>
          <option value="dry-run"${filters.mode === 'dry-run' ? ' selected' : ''}>Dry Run</option>
          <option value="prepare"${filters.mode === 'prepare' ? ' selected' : ''}>Prepare</option>
          <option value="submit"${filters.mode === 'submit' ? ' selected' : ''}>Submit</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:${COLORS.muted}">Failure Class
        <select name="autoFailureClass" style="min-width:180px">
          <option value="">All</option>
          <option value="manual-review-needed"${filters.failureClass === 'manual-review-needed' ? ' selected' : ''}>Manual Review Needed</option>
          <option value="closed-page"${filters.failureClass === 'closed-page' ? ' selected' : ''}>Closed Page</option>
          <option value="provider-throttled"${filters.failureClass === 'provider-throttled' ? ' selected' : ''}>Provider Throttled</option>
          <option value="validation"${filters.failureClass === 'validation' ? ' selected' : ''}>Validation</option>
          <option value="duplicate"${filters.failureClass === 'duplicate' ? ' selected' : ''}>Duplicate</option>
          <option value="abuse-warning"${filters.failureClass === 'abuse-warning' ? ' selected' : ''}>Abuse Warning</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:${COLORS.muted}">Min Score
        <input type="number" min="1" max="9" name="autoMinScore" value="${filterValue(scoreValue)}" style="width:88px" />
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:${COLORS.muted}">Recent Days
        <input type="number" min="1" max="365" name="autoDays" value="${filterValue(daysValue)}" style="width:96px" />
      </label>
      <button class="btn" type="submit" style="background:${COLORS.accent};color:#fff">Apply Filters</button>
      <a class="btn" href="/?filter=auto-applies" style="background:${COLORS.slateDark};color:${COLORS.muted}">Reset</a>
    </form>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">${cards}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">${queueQuality}</div>
    ${renderPaginatedTable(
      'auto-applies-table',
      10,
      `<thead><tr><th>Time</th><th>Company</th><th>Role</th><th>Score</th><th>Platform</th><th>Mode</th><th>PDF</th><th>Artifacts</th><th>Status</th><th>Error</th></tr></thead><tbody>${attemptRows || '<tr><td colspan="10" style="text-align:center;color:var(--text-muted)">No apply receipts match these filters</td></tr>'}</tbody>`,
      rows.length,
      '&larr; Newer',
      'Older &rarr;',
      'pageAutoApplies'
    )}
  </div>
</div>`;
}

function renderAnalytics(data) {
  if (!data) return '<div class="empty">No analytics data available.</div>';
  const { allTimeStats, funnel, scoreCalibration, rejectionInsights } = data;

  // Funnel bars
  const STAGE_LABELS = { applied: 'Applied', phone_screen: 'Phone Screen', interview: 'Interview', onsite: 'Onsite', offer: 'Offer' };
  const maxCount = Math.max(...Object.values(funnel), 1);
  const funnelRows = Object.entries(STAGE_LABELS).map(([stage, label]) => {
    const count = funnel[stage] || 0;
    const pct = Math.round((count / maxCount) * 100);
    const convRate = funnel.applied ? Math.round((count / funnel.applied) * 100) : 0;
    return `
    <div class="funnel-row">
      <div class="funnel-label">${label}</div>
      <div class="funnel-bar-wrap">
        <div class="funnel-bar" style="width:${pct}%;background:#a855f7"></div>
      </div>
      <div class="funnel-count" style="font-family:var(--font-mono)">${count} <span class="funnel-rate">${stage !== 'applied' ? `(${convRate}% of applied)` : ''}</span></div>
    </div>`;
  }).join('');

  // Score calibration table
  const calibRows = (scoreCalibration || []).reverse().map(row => {
    const advanceRate = row.applied > 0 ? Math.round((row.advanced / row.applied) * 100) : 0;
    const circleColor = row.score >= 8 ? '#d8b4fe' : row.score >= 6 ? '#a855f7' : '#6d28d9';
    const rateColor = advanceRate >= 20 ? '#d8b4fe' : advanceRate >= 10 ? '#a855f7' : COLORS.muted;
    return `
    <tr>
      <td><span class="score-circle score-${row.score >= 8 ? 'high' : row.score >= 6 ? 'mid' : 'low'}" style="background:${circleColor};display:inline-flex;width:28px;height:28px;border-radius:6px;font-family:var(--font-mono)">${row.score}</span></td>
      <td style="font-family:var(--font-mono)">${row.total}</td>
      <td style="font-family:var(--font-mono)">${row.applied}</td>
      <td style="font-family:var(--font-mono)">${row.advanced}</td>
      <td style="font-family:var(--font-mono)">${row.rejected}</td>
      <td style="color:${rateColor};font-family:var(--font-mono)">${row.applied > 0 ? advanceRate + '%' : '\u2014'}</td>
    </tr>`;
  }).join('');

  // Rejection insights table
  const rejectionRows = (rejectionInsights || []).map(r => {
    const ageColor = r.posting_age > 30 ? COLORS.red : r.posting_age > 14 ? '#a855f7' : '#d8b4fe';
    const daysColor = r.days_to_reject < 3 ? COLORS.red : COLORS.muted;
    const circleColor = r.score >= 8 ? '#d8b4fe' : r.score >= 6 ? '#a855f7' : '#6d28d9';
    return `
    <tr>
      <td>${escapeHtml(r.company)}</td>
      <td>${escapeHtml(r.title)}</td>
      <td><span class="score-circle score-${r.score >= 8 ? 'high' : r.score >= 6 ? 'mid' : 'low'}" style="background:${circleColor};display:inline-flex;width:24px;height:24px;border-radius:6px;font-size:11px;font-family:var(--font-mono)">${r.score || '?'}</span></td>
      <td>${r.rejected_from || 'applied'}</td>
      <td style="color:${daysColor};font-family:var(--font-mono)">${r.days_to_reject != null ? r.days_to_reject + 'd' : '?'}</td>
      <td style="color:${ageColor};font-weight:${r.posting_age > 30 ? '700' : '400'};font-family:var(--font-mono)">${r.posting_age != null ? r.posting_age + 'd' : '?'}</td>
    </tr>`;
  }).join('');

  const avgDaysToReject = rejectionInsights?.length
    ? (rejectionInsights.filter(r => r.days_to_reject != null).reduce((s, r) => s + r.days_to_reject, 0) / rejectionInsights.filter(r => r.days_to_reject != null).length).toFixed(1)
    : null;
  const avgPostingAge = rejectionInsights?.length
    ? (rejectionInsights.filter(r => r.posting_age != null).reduce((s, r) => s + r.posting_age, 0) / rejectionInsights.filter(r => r.posting_age != null).length).toFixed(1)
    : null;

  const allTimeHtml = allTimeStats ? `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">All-Time Stats</h2>
    <div class="alltime-stats">
      <div class="alltime-stat"><div class="alltime-num">${allTimeStats.applied}</div><div class="alltime-label">Applied</div></div>
      <div class="alltime-stat"><div class="alltime-num">${allTimeStats.rejected}</div><div class="alltime-label">Rejected</div></div>
      <div class="alltime-stat"><div class="alltime-num">${allTimeStats.phoneScreens}</div><div class="alltime-label">Phone Screens</div></div>
      <div class="alltime-stat"><div class="alltime-num">${allTimeStats.interviewing}</div><div class="alltime-label">Interviews</div></div>
      <div class="alltime-stat"><div class="alltime-num">${allTimeStats.offers}</div><div class="alltime-label">Offers</div></div>
      <div class="alltime-stat"><div class="alltime-num">${allTimeStats.pending}</div><div class="alltime-label">Pending Review</div></div>
    </div>
  </div>` : '';
  return `
<div class="analytics-wrap">
  ${allTimeHtml}
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Pipeline Funnel</h2>
    <p class="analytics-hint">How many jobs made it to each stage (rejected-at counts toward the stage they were rejected from)</p>
    <div class="funnel">${funnelRows}</div>
  </div>
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Score Calibration</h2>
    <p class="analytics-hint">Do higher scores actually predict interview advancement?</p>
    <table class="calibration-table">
      <thead><tr><th>Score</th><th>Total</th><th>Applied</th><th>Advanced</th><th>Rejected</th><th>Advance Rate</th></tr></thead>
      <tbody>${calibRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No data yet</td></tr>'}</tbody>
    </table>
  </div>
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Rejection Insights</h2>
    <p class="analytics-hint">Are stale postings wasting your time?${avgDaysToReject ? ` Avg <span style="font-family:var(--font-mono)">${avgDaysToReject}</span> days to rejection.` : ''}${avgPostingAge ? ` Avg posting age at application: <span style="font-family:var(--font-mono)">${avgPostingAge}</span> days.` : ''}</p>
    <table class="calibration-table">
      <thead><tr><th>Company</th><th>Role</th><th>Score</th><th>Rejected From</th><th>Days to Reject</th><th>Posting Age</th></tr></thead>
      <tbody>${rejectionRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No rejections yet</td></tr>'}</tbody>
    </table>
  </div>
</div>`;
}

module.exports = { renderAnalytics, renderAutoApplies, renderAutoApplyLog, renderActivityLog, getLatestRealAutoApplyOutcomes };
