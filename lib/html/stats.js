'use strict';

function renderStats(globalStats) {
  return '';
}

function renderInsightContent(globalStats) {
  const {
    todayAutoApplied = 0,
    todayRejected = 0,
    todayClosed = 0,
    todayApplied = 0,
    dailyTarget = 5,
  } = globalStats;
  const appliedColor = todayApplied >= dailyTarget ? '#10b981' : todayApplied >= Math.ceil(dailyTarget / 2) ? '#888' : '#555';
  return `<div class="insight-stats">
  <span class="stat-item"><span class="stat-n">${todayAutoApplied}</span><span class="stat-lbl">Auto-Applied</span></span>
  <span class="stat-dot">&middot;</span>
  <span class="stat-item"><span class="stat-n">${todayRejected}</span><span class="stat-lbl">Rejected</span></span>
  <span class="stat-dot">&middot;</span>
  <span class="stat-item"><span class="stat-n">${todayClosed}</span><span class="stat-lbl">Closed</span></span>
  <span class="stat-dot">&middot;</span>
  <span class="stat-item"><span class="stat-n" style="color:${appliedColor}">${todayApplied}</span><span class="stat-lbl">Applied</span></span>
</div>`;
}

module.exports = { renderStats, renderInsightContent };
