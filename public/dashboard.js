'use strict';

const ICON_EYE   = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_SEND  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

let _currentJobId = null;

// ── Nav menu (hamburger) ────────────────────────────────────────────
function toggleNavMenu() {
  const menu = document.getElementById('nav-menu');
  const btn = document.getElementById('nav-menu-btn');
  if (!menu) return;
  const isOpen = menu.classList.toggle('open');
  if (btn) btn.classList.toggle('active', isOpen);
  if (isOpen) {
    document.getElementById('filter-panel')?.classList.remove('open');
    document.getElementById('filter-panel-btn')?.classList.remove('active');
  }
}

// ── Filter popover ───────────────────────────────────────────────────
function toggleFilterPanel() {
  const panel = document.getElementById('filter-panel');
  const btn = document.getElementById('filter-panel-btn');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (btn) btn.classList.toggle('active', isOpen);
  if (isOpen) {
    document.getElementById('nav-menu')?.classList.remove('open');
    document.getElementById('nav-menu-btn')?.classList.remove('active');
  }
}

// ── Job action menus ─────────────────────────────────────────────────
function toggleJobMenu(id, btn) {
  const menu = document.getElementById('jmenu-' + id);
  if (!menu) return;
  const wasOpen = menu.classList.contains('open');
  // Close all other open job menus
  document.querySelectorAll('.job-actions-menu.open').forEach(m => m.classList.remove('open'));
  if (!wasOpen) menu.classList.add('open');
}

function closeJobMenu(id) {
  document.getElementById('jmenu-' + id)?.classList.remove('open');
}

function toggleInsights() {
  const drawer = document.getElementById('insight-drawer');
  const overlay = document.getElementById('insight-overlay');
  const btn = document.getElementById('insights-btn');
  if (!drawer) return;
  const isOpen = drawer.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open', isOpen);
  if (btn) btn.classList.toggle('active', isOpen);
}

document.addEventListener('click', e => {
  // Insight drawer
  const drawer = document.getElementById('insight-drawer');
  const overlay = document.getElementById('insight-overlay');
  const insightsBtn = document.getElementById('insights-btn');
  if (drawer && drawer.classList.contains('open')) {
    if (!drawer.contains(e.target) && insightsBtn && !insightsBtn.contains(e.target)) {
      drawer.classList.remove('open');
      if (overlay) overlay.classList.remove('open');
      if (insightsBtn) insightsBtn.classList.remove('active');
    }
  }

  // Nav menu
  const navMenu = document.getElementById('nav-menu');
  const navBtn = document.getElementById('nav-menu-btn');
  if (navMenu && navMenu.classList.contains('open')) {
    if (!navMenu.contains(e.target) && navBtn && !navBtn.contains(e.target)) {
      navMenu.classList.remove('open');
      if (navBtn) navBtn.classList.remove('active');
    }
  }

  // Filter panel
  const filterPanel = document.getElementById('filter-panel');
  const filterBtn = document.getElementById('filter-panel-btn');
  if (filterPanel && filterPanel.classList.contains('open')) {
    if (!filterPanel.contains(e.target) && filterBtn && !filterBtn.contains(e.target)) {
      filterPanel.classList.remove('open');
      if (filterBtn) filterBtn.classList.remove('active');
    }
  }

  // Job action menus
  if (!e.target.closest('.job-col-actions')) {
    document.querySelectorAll('.job-actions-menu.open').forEach(m => m.classList.remove('open'));
  }
});

function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color || 'var(--green)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}


function toggleReasoning(id, btn) {
  const panel = document.getElementById('reasoning-' + id);
  const card = btn.closest('.job-card');
  if (!panel || !card) return;
  const isExpanded = card.classList.contains('expanded');
  if (isExpanded) {
    card.classList.remove('expanded');
    btn.innerHTML = ICON_EYE;
    btn.classList.remove('btn-cmd-why-on');
  } else {
    card.classList.add('expanded');
    btn.innerHTML = ICON_EYE;
    btn.classList.add('btn-cmd-why-on');
  }
}

const PIPELINE_COLORS = { '': '#475569', applied: '#3b82f6', phone_screen: '#a855f7', interview: '#d8b4fe', onsite: '#f59e0b', offer: '#22c55e', closed: '#64748b' };
const PIPELINE_LABELS = { '': '\u2014', applied: 'Applied', phone_screen: 'Phone Screen', interview: 'Interview', onsite: 'Onsite', offer: 'Offer', closed: 'Closed', rejected: 'Rejected' };

async function setPipeline(id, value, selectEl) {
  const res = await fetch('/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, value }),
  });
  if (res.ok) {
    if (selectEl) selectEl.style.color = PIPELINE_COLORS[value] || '#475569';
    const label = PIPELINE_LABELS[value] || value;
    showToast(label || 'Cleared', PIPELINE_COLORS[value] || '#475569');

    const notesBtn = document.getElementById('notes-btn-' + id);
    if (notesBtn && !notesBtn.textContent.includes('View')) {
      notesBtn.style.display = ['phone_screen', 'interview'].includes(value) ? '' : 'none';
    }

    if (value === 'rejected') {
      const row = selectEl && selectEl.closest('.job-card');
      await fetch('/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (row) {
        row.style.transition = 'opacity 0.3s';
        row.style.opacity = '0';
        setTimeout(() => row.remove(), 300);
      }
    }
  }
}

async function markOutreach(id, clear) {
  const res = await fetch('/mark-outreach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, clear }),
  });
  const data = await res.json();
  const btn = document.getElementById('outreach-btn-' + id);
  if (!btn) return;
  if (data.reached_out_at) {
    const d = data.reached_out_at.slice(5, 10);
    btn.innerHTML = ICON_CHECK + `<span class="outreach-date">${d}</span> Reached`;
    btn.onclick = () => markOutreach(id, true);
    btn.title = 'Reached out ' + data.reached_out_at.slice(0, 10) + ' — click to clear';
  } else {
    btn.innerHTML = ICON_SEND + ' Reach out';
    btn.onclick = () => markOutreach(id, false);
    btn.title = 'Mark outreach';
  }
}


async function archiveJob(id, btn) {
  const row = btn.closest('.job-card');
  const res = await fetch('/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (res.ok) {
    row.style.transition = 'opacity 0.3s';
    row.style.opacity = '0';
    setTimeout(() => row.remove(), 300);
    showToast('Archived', '#475569');
  }
}

function positionSortThumb() {
  const active = document.querySelector('.sort-opt.active');
  const thumb = document.getElementById('sort-thumb');
  if (!active || !thumb) return;
  thumb.style.left = active.offsetLeft + 'px';
  thumb.style.width = active.offsetWidth + 'px';
}
window.addEventListener('load', positionSortThumb);

let _applyFiltersTimer = null;

function applyFilters() {
  const searchBox = document.querySelector('.search-box');
  const scoreInput = document.getElementById('score-filter');
  const scoreVal = document.getElementById('score-val');
  if (!searchBox || !scoreInput) return;

  const q = searchBox.value.trim();
  const rawMinScore = Number.parseInt(scoreInput.value, 10);
  const minScore = Number.isInteger(rawMinScore) ? Math.min(Math.max(rawMinScore, 1), 9) : 1;
  if (scoreVal) scoreVal.textContent = String(minScore);

  window.clearTimeout(_applyFiltersTimer);
  _applyFiltersTimer = window.setTimeout(() => {
    const params = new URLSearchParams(window.location.search);
    if (q) params.set('q', q);
    else params.delete('q');

    if (minScore > 1) params.set('minScore', String(minScore));
    else params.delete('minScore');

    params.delete('page');

    const nextUrl = `/?${params.toString()}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) window.location.assign(nextUrl);
  }, 250);
}

// ---------------------------------------------------------------------------
// Company notes modal
// ---------------------------------------------------------------------------

let _currentCompany = null;

function openCompanyNotes(company) {
  _currentCompany = company;
  document.getElementById('company-notes-sub').textContent = company;
  document.getElementById('company-tags-input').value = '';
  document.getElementById('company-notes-input').value = '';
  document.getElementById('company-notes-modal').classList.add('open');
  fetch('/company-notes?company=' + encodeURIComponent(company))
    .then(r => r.json())
    .then(data => {
      document.getElementById('company-tags-input').value = data.tags || '';
      document.getElementById('company-notes-input').value = data.notes || '';
    })
    .catch(() => {});
}

function closeCompanyNotes() {
  document.getElementById('company-notes-modal').classList.remove('open');
  _currentCompany = null;
}

function saveCompanyNotes() {
  if (!_currentCompany) return;
  const tags = document.getElementById('company-tags-input').value;
  const notes = document.getElementById('company-notes-input').value;
  fetch('/company-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: _currentCompany, tags, notes }),
  })
    .then(() => { showToast('Notes saved', '#22c55e'); closeCompanyNotes(); })
    .catch(() => showToast('Save failed', '#ef4444'));
}

document.getElementById('company-notes-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('company-notes-modal')) closeCompanyNotes();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeCompanyNotes();
    closeApplyImage();
    document.getElementById('jd-modal').style.display = 'none';
  }
});

// ---------------------------------------------------------------------------
// Job description modal
// ---------------------------------------------------------------------------

async function openJobDescription(id, title, company) {
  const modal = document.getElementById('jd-modal');
  const body = document.getElementById('jd-modal-body');
  document.getElementById('jd-modal-title').textContent = title;
  document.getElementById('jd-modal-sub').textContent = company;
  body.textContent = 'Loading…';
  modal.style.display = 'flex';
  try {
    const data = await fetch('/job-description?id=' + encodeURIComponent(id)).then(r => r.json());
    body.textContent = data.description || '(no description stored)';
  } catch (e) {
    body.textContent = 'Failed to load.';
  }
}

document.getElementById('jd-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('jd-modal')) document.getElementById('jd-modal').style.display = 'none';
});

// ---------------------------------------------------------------------------
// Apply image modal
// ---------------------------------------------------------------------------

let _applyImageState = null;

function closeApplyImage() {
  const modal = document.getElementById('apply-image-modal');
  const frame = document.getElementById('apply-image-frame');
  const img = document.getElementById('apply-image-img');
  const status = document.getElementById('apply-image-status');
  const preTab = document.getElementById('apply-image-tab-pre');
  const postTab = document.getElementById('apply-image-tab-post');
  preTab.classList.remove('active');
  postTab.classList.remove('active');
  preTab.disabled = false;
  postTab.disabled = false;
  modal.classList.remove('open');
  frame.classList.remove('visible');
  frame.scrollTop = 0;
  frame.scrollLeft = 0;
  img.removeAttribute('src');
  img.onerror = null;
  img.onload = null;
  status.textContent = '';
  _applyImageState = null;
}

function setApplyImagePhase(phase) {
  const frame = document.getElementById('apply-image-frame');
  const img = document.getElementById('apply-image-img');
  const status = document.getElementById('apply-image-status');
  const preTab = document.getElementById('apply-image-tab-pre');
  const postTab = document.getElementById('apply-image-tab-post');
  if (!_applyImageState || !_applyImageState.available[phase]) return;
  _applyImageState.phase = phase;
  preTab.classList.toggle('active', phase === 'pre');
  postTab.classList.toggle('active', phase === 'post');
  status.textContent = phase === 'pre' ? 'Loading pre-apply screenshot…' : 'Loading post-apply screenshot…';
  frame.classList.remove('visible');
  frame.scrollTop = 0;
  frame.scrollLeft = 0;
  img.onerror = function () {
    frame.classList.remove('visible');
    status.textContent = phase === 'pre'
      ? 'No pre-apply image found in logs for this job yet.'
      : 'No post-apply image found in logs for this job yet.';
  };
  img.onload = function () {
    status.textContent = '';
    frame.classList.add('visible');
  };
  img.src = '/job-apply-image?id=' + encodeURIComponent(_applyImageState.id) + '&phase=' + encodeURIComponent(phase) + '&t=' + Date.now();
}

async function openApplyImage(id, title, company) {
  const modal = document.getElementById('apply-image-modal');
  const frame = document.getElementById('apply-image-frame');
  const img = document.getElementById('apply-image-img');
  const status = document.getElementById('apply-image-status');
  const preTab = document.getElementById('apply-image-tab-pre');
  const postTab = document.getElementById('apply-image-tab-post');
  document.getElementById('apply-image-title').textContent = 'Apply Image';
  document.getElementById('apply-image-sub').textContent = company + ' - ' + title;
  _applyImageState = null;
  frame.classList.remove('visible');
  frame.scrollTop = 0;
  frame.scrollLeft = 0;
  img.removeAttribute('src');
  img.onerror = null;
  img.onload = null;
  preTab.classList.remove('active');
  postTab.classList.remove('active');
  preTab.disabled = true;
  postTab.disabled = true;
  status.textContent = 'Loading…';
  modal.classList.add('open');
  try {
    const data = await fetch('/job-apply-images?id=' + encodeURIComponent(id)).then(r => r.json());
    const available = { pre: !!data.pre, post: !!data.post };
    _applyImageState = {
      id,
      available,
      phase: data.defaultPhase || (available.pre ? 'pre' : available.post ? 'post' : null),
    };
    preTab.disabled = !available.pre;
    postTab.disabled = !available.post;
    if (!_applyImageState.phase) {
      status.textContent = 'No apply images found in logs for this job yet.';
      frame.classList.remove('visible');
      return;
    }
    setApplyImagePhase(_applyImageState.phase);
  } catch (e) {
    status.textContent = 'Failed to load apply images.';
  }
}

document.getElementById('apply-image-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('apply-image-modal')) closeApplyImage();
});

// ---------------------------------------------------------------------------
// Score comparison pagination (analytics page)
// ---------------------------------------------------------------------------

(function () {
  var table = document.getElementById('comparison-table');
  if (!table) return;
  var PAGE_SIZE = 25, page = 0;
  var rows = table.querySelectorAll('tbody tr');
  var total = rows.length, pages = Math.ceil(total / PAGE_SIZE);
  function show() {
    rows.forEach(function (r, i) { r.style.display = (i >= page * PAGE_SIZE && i < (page + 1) * PAGE_SIZE) ? '' : 'none'; });
    document.getElementById('comparison-prev').disabled = page === 0;
    document.getElementById('comparison-next').disabled = page >= pages - 1;
    document.getElementById('comparison-page-info').textContent = 'Page ' + (page + 1) + ' of ' + pages + ' (' + total + ' total)';
  }
  window.pageComparison = function (d) { page = Math.max(0, Math.min(pages - 1, page + d)); show(); };
  show();
})();
