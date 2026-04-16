'use strict';

const { escapeHtml } = require('../utils');
const { renderScore } = require('../voice-check');

function statusTone(status) {
  if (status === 'ready') return 'prep-status ready';
  if (status === 'unsupported') return 'prep-status blocked';
  return 'prep-status pending';
}

function workflowLabel(workflow) {
  if (workflow === 'simple-auto') return 'simple auto';
  if (workflow === 'autofill') return 'autofill';
  if (workflow === 'email') return 'email';
  if (workflow === 'manual') return 'manual';
  return workflow || 'unknown';
}

function voiceBadge(voiceCheck) {
  if (!voiceCheck) return '<span class="prep-pill muted">No check</span>';
  const score = voiceCheck.sapling?.score;
  if (typeof score === 'number') {
    const tone = voiceCheck.passed ? 'good' : 'warn';
    return `<span class="prep-pill ${tone}">${escapeHtml(renderScore(score))}</span>`;
  }
  if (voiceCheck.sapling?.error) {
    return `<span class="prep-pill muted" title="${escapeHtml(voiceCheck.sapling.error)}">Sapling unavailable</span>`;
  }
  return `<span class="prep-pill ${voiceCheck.passed ? 'good' : 'warn'}">${voiceCheck.passed ? 'Voice check passed' : 'Needs review'}</span>`;
}

function prettyAnswer(answer) {
  if (Array.isArray(answer)) return answer.join(', ');
  if (answer == null || answer === '') return '<span class="prep-empty">Blank</span>';
  return escapeHtml(String(answer));
}

function formatJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function renderQuestionCard(field, answer, voiceCheck) {
  const options = Array.isArray(field.options) && field.options.length
    ? `<div class="prep-meta-row"><span>Options</span><code>${escapeHtml(field.options.join(' | '))}</code></div>`
    : '';

  const issues = voiceCheck?.issues?.length
    ? `<div class="prep-issues">${voiceCheck.issues.map((issue) => `<div>${escapeHtml(issue.type)}: ${escapeHtml(issue.detail)}</div>`).join('')}</div>`
    : '';

  return `<section class="prep-card">
    <div class="prep-card-head">
      <div>
        <h3>${escapeHtml(field.label)}</h3>
        <div class="prep-card-sub">${escapeHtml(field.name)} · ${escapeHtml(field.type)}${field.required ? ' · required' : ''}</div>
      </div>
      ${voiceBadge(voiceCheck)}
    </div>
    <div class="prep-answer">${prettyAnswer(answer)}</div>
    <div class="prep-meta">
      ${options}
    </div>
    ${issues}
  </section>`;
}

function renderQuestionList(prep) {
  if (!prep) {
    return `<section class="prep-empty-state">
      <h2>No prep yet</h2>
      <p>Generate answers when you want them. Nothing has been stored for this job yet.</p>
    </section>`;
  }

  if (prep.status === 'unsupported') {
    return `<section class="prep-empty-state">
      <h2>Fast-failed</h2>
      <p>${escapeHtml(prep.summary || prep.error || 'This form is not worth autonomous handling.')}</p>
    </section>`;
  }

  if (!Array.isArray(prep.questions) || prep.questions.length === 0) {
    return `<section class="prep-empty-state">
      <h2>No custom questions</h2>
      <p>${escapeHtml(prep.summary || 'This should stay on the fast auto-submit path.')}</p>
    </section>`;
  }

  return prep.questions.map((field) => renderQuestionCard(
    field,
    prep.answers?.[field.name],
    prep.voiceChecks?.[field.name]
  )).join('');
}

function buildPlainText(prep) {
  if (!prep?.questions?.length) return '';
  return prep.questions.map((field) => {
    const answer = prep.answers?.[field.name];
    const answerText = Array.isArray(answer) ? answer.join(', ') : String(answer || '');
    return `${field.label}\n${answerText}`.trim();
  }).join('\n\n');
}

function renderApplicationPrepPage({ job, prep }) {
  const title = `${job.company} · ${job.title}`;
  const payload = prep ? {
    jobId: job.id,
    workflow: prep.workflow,
    applyUrl: prep.apply_url || job.url,
    questions: prep.questions || [],
    answers: prep.answers || {},
    voiceChecks: prep.voiceChecks || {},
  } : null;

  const jsonPayload = payload || {
    jobId: job.id,
    workflow: job.apply_complexity === 'simple' ? 'simple-auto' : 'manual',
    applyUrl: job.url,
    questions: [],
    answers: {},
    voiceChecks: {},
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Application Prep</title>
<link rel="stylesheet" href="/public/dashboard.css?v=10">
<style>
body { background: #05020e; }
.prep-shell { max-width: 1120px; margin: 0 auto; padding: 32px 24px 56px; }
.prep-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.prep-title { font-size: 30px; line-height: 1.08; color: var(--text-primary); font-weight: 800; letter-spacing: -0.04em; }
.prep-sub { margin-top: 8px; color: var(--text-secondary); font-size: 14px; }
.prep-sub a { color: #c4b5fd; text-decoration: none; }
.prep-sub a:hover { text-decoration: underline; }
.prep-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.prep-btn { appearance: none; border: 1px solid var(--border); background: rgba(255,255,255,0.03); color: var(--text-primary); border-radius: 10px; padding: 10px 14px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; text-decoration: none; }
.prep-btn:hover { border-color: var(--border-hover); background: rgba(255,255,255,0.06); }
.prep-btn.primary { background: rgba(139,92,246,0.16); color: #ddd6fe; border-color: rgba(139,92,246,0.35); }
.prep-grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 18px; align-items: start; }
.prep-panel, .prep-card, .prep-empty-state { background: rgba(255,255,255,0.035); border: 1px solid var(--border); border-radius: 16px; }
.prep-panel { padding: 18px; position: sticky; top: 24px; }
.prep-panel h2, .prep-empty-state h2 { color: var(--text-primary); font-size: 15px; margin-bottom: 12px; }
.prep-info-row { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.prep-info-row:first-of-type { border-top: 0; padding-top: 0; }
.prep-info-row span { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.prep-info-row strong, .prep-info-row code { color: var(--text-primary); font-size: 13px; line-height: 1.5; }
.prep-summary { color: var(--text-secondary); font-size: 13px; line-height: 1.6; margin-top: 14px; }
.prep-status { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
.prep-status.ready { background: rgba(16,185,129,0.12); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.28); }
.prep-status.blocked { background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.28); }
.prep-status.pending { background: rgba(148,163,184,0.1); color: #cbd5e1; border: 1px solid rgba(148,163,184,0.24); }
.prep-pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.prep-pill.good { background: rgba(16,185,129,0.12); color: #6ee7b7; }
.prep-pill.warn { background: rgba(245,158,11,0.12); color: #fcd34d; }
.prep-pill.muted { background: rgba(148,163,184,0.1); color: #cbd5e1; }
.prep-list { display: flex; flex-direction: column; gap: 14px; }
.prep-card { padding: 18px; }
.prep-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.prep-card h3 { color: var(--text-primary); font-size: 16px; line-height: 1.35; margin: 0; }
.prep-card-sub { color: var(--text-muted); font-size: 12px; margin-top: 4px; }
.prep-answer { color: var(--text-primary); font-size: 14px; line-height: 1.7; white-space: pre-wrap; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 14px; }
.prep-empty { color: var(--text-dim); font-style: italic; }
.prep-meta-row { margin-top: 12px; display: flex; flex-direction: column; gap: 4px; }
.prep-meta-row span { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
.prep-meta-row code { color: #ddd6fe; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.prep-issues { margin-top: 12px; color: #fcd34d; font-size: 12px; line-height: 1.5; }
.prep-empty-state { padding: 22px; color: var(--text-secondary); line-height: 1.6; }
.prep-json { margin-top: 18px; }
.prep-json pre { margin-top: 12px; white-space: pre-wrap; word-break: break-word; max-height: 420px; overflow: auto; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px; color: #d4d4d8; font-size: 12px; line-height: 1.6; }
.prep-note { margin-top: 10px; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.prep-flash { position: fixed; right: 16px; bottom: 16px; padding: 10px 14px; background: #111827; border: 1px solid rgba(255,255,255,0.08); color: #e5e7eb; border-radius: 10px; opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s; pointer-events: none; }
.prep-flash.show { opacity: 1; transform: translateY(0); }
@media (max-width: 900px) {
  .prep-top, .prep-grid { display: block; }
  .prep-actions { justify-content: flex-start; margin-top: 14px; }
  .prep-panel { position: static; margin-bottom: 16px; }
}
</style>
</head>
<body>
  <div class="prep-shell">
    <div class="prep-top">
      <div>
        <div class="prep-title">${escapeHtml(job.title)}</div>
        <div class="prep-sub">${escapeHtml(job.company)} · ${escapeHtml(job.platform || 'Unknown')} · <span class="complexity-badge ${job.apply_complexity === 'simple' ? 'simple' : 'complex'}">${escapeHtml(job.apply_complexity || 'unknown')}</span></div>
        <div class="prep-sub"><a href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Open job posting</a> · <a href="/" target="_blank" rel="noreferrer">Back to dashboard</a></div>
      </div>
      <div class="prep-actions">
        <button class="prep-btn primary" onclick="generatePrep(false)">${prep ? 'Refresh Prep' : 'Generate Prep'}</button>
        <button class="prep-btn" onclick="generatePrep(true)">Force Regenerate</button>
        <a class="prep-btn" href="${escapeHtml((prep && prep.apply_url) || job.url)}" target="_blank" rel="noreferrer">Open Apply URL</a>
        <button class="prep-btn" onclick="copyText(window.__prepJson, 'Copied answers JSON')">Copy JSON</button>
        <button class="prep-btn" onclick="copyText(window.__prepPlainText, 'Copied plain text answers')">Copy Plain Text</button>
        <button class="prep-btn" onclick="copyText(window.__prepBookmarklet, 'Copied job bookmarklet')">Copy Bookmarklet</button>
      </div>
    </div>

    <div class="prep-grid">
      <aside class="prep-panel">
        <h2>Prep Status</h2>
        <div class="prep-info-row">
          <span>Status</span>
          <strong><span class="${statusTone(prep?.status)}">${escapeHtml(prep?.status || 'not generated')}</span></strong>
        </div>
        <div class="prep-info-row">
          <span>Workflow</span>
          <strong>${escapeHtml(workflowLabel(prep?.workflow || (job.apply_complexity === 'simple' ? 'simple-auto' : 'manual')))}</strong>
        </div>
        <div class="prep-info-row">
          <span>Questions</span>
          <strong>${prep?.questions?.length || 0}</strong>
        </div>
        <div class="prep-info-row">
          <span>Generated</span>
          <strong>${escapeHtml(prep?.generated_at || 'Not yet')}</strong>
        </div>
        <div class="prep-info-row">
          <span>Apply URL</span>
          <code>${escapeHtml((prep && prep.apply_url) || job.url)}</code>
        </div>
        ${(prep?.page_issue || prep?.error) ? `<div class="prep-info-row"><span>Failure</span><code>${escapeHtml(prep.page_issue || prep.error)}</code></div>` : ''}
        <div class="prep-summary">${escapeHtml(prep?.summary || 'Generate prep to store answers, Sapling checks, and the job-specific autofill payload.')}</div>
        <div class="prep-note">Use the bookmarklet first on supported forms. If the site is weird, this page is the copy and paste fallback.</div>
      </aside>

      <main>
        <div class="prep-list">
          ${renderQuestionList(prep)}
        </div>
        <section class="prep-panel prep-json">
          <h2>Stored JSON</h2>
          <div class="prep-note">This is the stored question and answer payload for this job. Use it as the copy and paste fallback when autofill misses.</div>
          <pre id="prep-json">${formatJson(jsonPayload)}</pre>
        </section>
      </main>
    </div>
  </div>
  <div class="prep-flash" id="prep-flash"></div>
<script>
window.__jobId = ${JSON.stringify(job.id)};
window.__prepJson = ${JSON.stringify(JSON.stringify(jsonPayload, null, 2))};
window.__prepPlainText = ${JSON.stringify(buildPlainText(prep))};
window.__prepBookmarklet = ${JSON.stringify(`javascript:(function(){var s=document.createElement('script');s.src='http://localhost:3131/job-bookmarklet.js?id=${encodeURIComponent(job.id)}&t='+Date.now();document.documentElement.appendChild(s);}())`)};

function flash(message) {
  var el = document.getElementById('prep-flash');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__prepFlashTimer);
  window.__prepFlashTimer = setTimeout(function() { el.classList.remove('show'); }, 1800);
}

async function copyText(text, message) {
  if (!text) {
    flash('Nothing to copy yet');
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      flash(message);
      return;
    }
  } catch (_) {}

  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var copied = document.execCommand('copy');
    document.body.removeChild(ta);
    if (copied) {
      flash(message);
      return;
    }
  } catch (_) {}

  try {
    window.prompt('Copy this value manually:', text);
    flash('Clipboard blocked. Manual copy opened.');
  } catch (_) {
    flash('Copy failed. Browser blocked clipboard access.');
  }
}

async function generatePrep(force) {
  flash(force ? 'Regenerating prep…' : 'Generating prep…');
  var response = await fetch('/job-application-prep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: window.__jobId, force: !!force }),
  });
  if (!response.ok) {
    var text = await response.text();
    flash(text || 'Prep failed');
    return;
  }
  location.reload();
}
</script>
</body>
</html>`;
}

module.exports = {
  renderApplicationPrepPage,
};
