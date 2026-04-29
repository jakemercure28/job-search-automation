'use strict';

const { escapeHtml } = require('../utils');
const { buildDashboardHref } = require('./helpers');

function renderFilters(filter, sort, globalStats, level, searchOptions = {}) {
  const levelActive = level === '1';
  const levelHref = buildDashboardHref(filter, sort, levelActive ? null : '1', searchOptions);
  const scoreHref = buildDashboardHref(filter, 'score', level, searchOptions);
  const dateHref = buildDashboardHref(filter, 'date', level, searchOptions);
  const q = typeof searchOptions.q === 'string' ? searchOptions.q.trim() : '';
  const rawMinScore = Number.parseInt(String(searchOptions.minScore ?? '1'), 10);
  const minScore = Number.isInteger(rawMinScore) ? Math.min(Math.max(rawMinScore, 1), 9) : 1;

  const myLevelCount = globalStats.myLevel || 0;
  const levelBadge = myLevelCount
    ? ` <span class="level-badge">${myLevelCount}</span>`
    : '';

  const secFilters = [
    { id: 'rejected', label: 'Rejected', key: 'rejected' },
    { id: 'closed',   label: 'Closed',   key: 'closed' },
    { id: 'archived', label: 'Archived', key: 'archived' },
  ].map(({ id, label, key }) => {
    const active = filter === id;
    const count = globalStats[key] || 0;
    const linkSort = id === 'rejected' ? 'date' : sort;
    return `<a href="${buildDashboardHref(id, linkSort, level, searchOptions)}" class="menu-item${active ? ' active' : ''}">${label}${count ? ` <span class="menu-count">${count}</span>` : ''}</a>`;
  }).join('');

  return `
<div class="header-sub">
  <div class="dd-wrap">
    <button class="icon-btn" id="nav-menu-btn" onclick="toggleNavMenu()" title="Navigation">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div id="nav-menu" class="nav-dropdown">
      <a href="${buildDashboardHref('analytics', sort, null, searchOptions)}" class="menu-item${filter === 'analytics' ? ' active' : ''}">Stats</a>
      <a href="${buildDashboardHref('auto-applies', sort, null, searchOptions)}" class="menu-item${filter === 'auto-applies' ? ' active' : ''}">Apply Receipts</a>
      <a href="${buildDashboardHref('activity-log', sort, null, searchOptions)}" class="menu-item${filter === 'activity-log' ? ' active' : ''}">Event Log</a>
      <a href="${buildDashboardHref('market-research', sort, null, searchOptions)}" class="menu-item${filter === 'market-research' ? ' active' : ''}">Market Research</a>
      <a href="/help" class="menu-item">Help</a>
      <div class="menu-divider"></div>
      <a href="/resume" class="menu-item">Resume</a>
      <a href="/resume?variant=ai" class="menu-item">AI Resume</a>
      <a href="/resume?variant=devops" class="menu-item">DevOps Resume</a>
      <div class="menu-divider"></div>
      ${secFilters}
    </div>
  </div>
  <span class="filter-divider"></span>
  <div class="dd-wrap">
    <button class="icon-btn${levelActive ? ' active' : ''}" id="filter-panel-btn" onclick="toggleFilterPanel()" title="Filters">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
    </button>
    <div id="filter-panel" class="filter-dropdown">
      <div class="filter-panel-row">
        <button class="filter-panel-btn${levelActive ? ' active' : ''}" onclick="location='${levelHref}'">My Level${levelBadge}</button>
      </div>
      <div class="filter-panel-row filter-panel-row-stack">
        <label class="filter-panel-label">Sort</label>
        <div class="filter-panel-group">
          <button class="filter-panel-btn${sort !== 'date' ? ' active' : ''}" onclick="location='${scoreHref}'">Score</button>
          <button class="filter-panel-btn${sort === 'date' ? ' active' : ''}" onclick="location='${dateHref}'">Date</button>
        </div>
      </div>
      <div class="filter-panel-row">
        <label class="filter-panel-label">Min Score</label>
        <input type="range" id="score-filter" min="1" max="9" value="${minScore}" oninput="applyFilters()">
        <span id="score-val" class="score-val">${minScore}</span>
      </div>
    </div>
  </div>
  <input class="search-box" type="text" placeholder="Search\u2026" value="${escapeHtml(q)}" oninput="applyFilters()" />
</div>`;
}

module.exports = { renderFilters };
