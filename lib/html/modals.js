'use strict';

const { COLORS } = require('./helpers');

function renderModals() {
  return `
<!-- Job description modal -->
<div class="modal-overlay" id="jd-modal">
  <div class="modal" style="max-width:720px">
    <h2 id="jd-modal-title">Job Description</h2>
    <div class="modal-sub" id="jd-modal-sub"></div>
    <div id="jd-modal-body" style="white-space:pre-wrap;font-size:13px;line-height:1.6;max-height:60vh;overflow-y:auto;margin-top:12px;padding:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary)"></div>
    <div class="modal-actions">
      <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="document.getElementById('jd-modal').style.display='none'">Close</button>
    </div>
  </div>
</div>

<!-- Apply image modal -->
<div class="modal-overlay" id="apply-image-modal">
  <div class="modal apply-image-modal">
    <h2 id="apply-image-title">Apply Image</h2>
    <div class="modal-sub" id="apply-image-sub"></div>
    <div class="modal-tabs" id="apply-image-tabs">
      <button class="modal-tab" id="apply-image-tab-pre" onclick="setApplyImagePhase('pre')">Pre-Apply</button>
      <button class="modal-tab" id="apply-image-tab-post" onclick="setApplyImagePhase('post')">Post-Apply</button>
    </div>
    <div id="apply-image-status" class="apply-image-status">Loading…</div>
    <div id="apply-image-frame" class="apply-image-frame">
      <img id="apply-image-img" alt="Application screenshot" class="apply-image-img" />
    </div>
    <div class="modal-actions">
      <button class="btn" style="background:var(--slate);color:var(--text-muted)" onclick="closeApplyImage()">Close</button>
    </div>
  </div>
</div>

<!-- Company notes modal -->
<div class="modal-overlay" id="company-notes-modal">
  <div class="modal">
    <h2>Company Notes</h2>
    <div class="modal-sub" id="company-notes-sub"></div>
    <label for="company-tags-input">Tags <span style="font-size:11px;color:${COLORS.muted}">(comma-separated, e.g. "recently funded, network connection")</span></label>
    <input id="company-tags-input" type="text" placeholder="e.g. recently funded, network connection" autocomplete="off" />
    <label for="company-notes-input" style="margin-top:12px">Notes</label>
    <textarea id="company-notes-input" rows="4" placeholder="Freeform notes about this company..." style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);padding:8px;font-size:13px;resize:vertical"></textarea>
    <div class="modal-actions">
      <button class="btn" style="background:${COLORS.slateDark};color:${COLORS.muted}" onclick="closeCompanyNotes()">Cancel</button>
      <button class="btn" style="background:${COLORS.accent};color:white" onclick="saveCompanyNotes()">Save</button>
    </div>
  </div>
</div>`;
}

module.exports = { renderModals };
