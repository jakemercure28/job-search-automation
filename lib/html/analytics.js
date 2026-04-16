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
  if (!data) return '<div class="empty">No auto-apply log data available.</div>';
  const { autoApplyLog } = data;
  const rows = autoApplyLog || [];
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
    <h2 class="analytics-title">Auto-Apply Log</h2>
    <p class="analytics-hint"><span style="font-family:var(--font-mono)">${latestRealRows.length}</span> jobs &mdash; <span style="color:#4ade80;font-family:var(--font-mono)">${succeeded}</span> succeeded, <span style="color:#f87171;font-family:var(--font-mono)">${failed}</span> failed${dryRows.length > 0 ? ` &nbsp;<span style="color:var(--text-muted);font-size:11px">(+ ${dryRows.length} dry run${dryRows.length !== 1 ? 's' : ''})</span>` : ''}</p>
    ${renderPaginatedTable(
      'apply-log-table',
      8,
      `<thead><tr><th>Date</th><th>Score</th><th>Company</th><th>Role</th><th>Resume</th><th>Status</th><th>Code</th><th>Error</th></tr></thead><tbody>${applyRows || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No auto-apply attempts yet</td></tr>'}</tbody>`,
      rows.length,
      '&larr; Newer',
      'Older &rarr;',
      'pageApplyLog'
    )}
  </div>
</div>`;
}

function renderAnalytics(data) {
  if (!data) return '<div class="empty">No analytics data available.</div>';
  const { allTimeStats, funnel, scoreCalibration, rejectionInsights, scoreComparison } = data;

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

  // Score comparison section
  let comparisonHtml = '';
  if (scoreComparison && scoreComparison.length > 0) {
    const total = scoreComparison.length;
    const exact = scoreComparison.filter(r => r.gemini_score === r.claude_score).length;
    const within1 = scoreComparison.filter(r => Math.abs(r.diff) <= 1).length;
    const big = scoreComparison.filter(r => r.diff >= 3).length;
    const geminiMean = (scoreComparison.reduce((s, r) => s + r.gemini_score, 0) / total).toFixed(1);
    const claudeMean = (scoreComparison.reduce((s, r) => s + r.claude_score, 0) / total).toFixed(1);

    const compRows = scoreComparison.map(r => {
      const diff = r.claude_score - r.gemini_score;
      const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
      const diffColor = Math.abs(diff) >= 3 ? COLORS.red : Math.abs(diff) >= 2 ? '#a855f7' : COLORS.muted;
      const gCircleColor = r.gemini_score >= 8 ? '#d8b4fe' : r.gemini_score >= 6 ? '#a855f7' : '#6d28d9';
      const cCircleColor = r.claude_score >= 8 ? '#d8b4fe' : r.claude_score >= 6 ? '#a855f7' : '#6d28d9';
      return `
      <tr>
        <td>${escapeHtml(r.company)}</td>
        <td>${escapeHtml(r.title.slice(0, 45))}</td>
        <td><span class="score-circle score-${r.gemini_score >= 8 ? 'high' : r.gemini_score >= 6 ? 'mid' : 'low'}" style="background:${gCircleColor};display:inline-flex;width:24px;height:24px;border-radius:6px;font-size:11px;font-family:var(--font-mono)">${r.gemini_score}</span></td>
        <td><span class="score-circle score-${r.claude_score >= 8 ? 'high' : r.claude_score >= 6 ? 'mid' : 'low'}" style="background:${cCircleColor};display:inline-flex;width:24px;height:24px;border-radius:6px;font-size:11px;font-family:var(--font-mono)">${r.claude_score}</span></td>
        <td style="color:${diffColor};font-weight:${Math.abs(diff) >= 3 ? '700' : '400'};font-family:var(--font-mono)">${diffStr}</td>
      </tr>`;
    }).join('');

    comparisonHtml = `
  <div class="analytics-section market-section">
    <h2 class="analytics-title">Score Comparison: Claude vs Gemini</h2>
    <p class="analytics-hint"><span style="font-family:var(--font-mono)">${total}</span> jobs rescored. Gemini avg: <span style="font-family:var(--font-mono)">${geminiMean}</span> | Claude avg: <span style="font-family:var(--font-mono)">${claudeMean}</span> | Exact match: <span style="font-family:var(--font-mono)">${exact} (${Math.round(exact/total*100)}%)</span> | Within 1: <span style="font-family:var(--font-mono)">${within1} (${Math.round(within1/total*100)}%)</span> | Differ by 3+: <span style="font-family:var(--font-mono)">${big} (${Math.round(big/total*100)}%)</span></p>
    <table class="calibration-table" id="comparison-table">
      <thead><tr><th>Company</th><th>Role</th><th>Gemini</th><th>Claude</th><th>Diff</th></tr></thead>
      <tbody>${compRows}</tbody>
    </table>
    <div style="display:flex;align-items:center;gap:8px;margin-top:12px">
      <button class="btn btn-sm btn-archive" onclick="pageComparison(-1)" id="comparison-prev" disabled>&larr; Prev</button>
      <span style="font-size:12px;color:var(--text-muted)" id="comparison-page-info"></span>
      <button class="btn btn-sm btn-archive" onclick="pageComparison(1)" id="comparison-next">Next &rarr;</button>
    </div>
  </div>`;
  }

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
  ${comparisonHtml}
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

module.exports = { renderAnalytics, renderAutoApplyLog, renderActivityLog, getLatestRealAutoApplyOutcomes };
