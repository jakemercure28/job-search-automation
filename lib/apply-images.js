'use strict';

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

function slugifyCompany(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectImageFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectImageFiles(fullPath, acc);
      continue;
    }
    if (entry.isFile() && IMAGE_EXT_RE.test(entry.name)) acc.push(fullPath);
  }
  return acc;
}

function listApplyImages(job) {
  const slug = slugifyCompany(job.company);
  const slugRe = new RegExp(`(^|-)${escapeRegex(slug)}(-|\\.)`, 'i');
  const candidates = collectImageFiles(LOGS_DIR)
    .filter(filePath => slugRe.test(path.basename(filePath)));

  const scored = candidates.map(filePath => {
    const base = path.basename(filePath).toLowerCase();
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch (_) {}
    return { filePath, base, mtimeMs };
  });

  function pickForPhase(phase) {
    return scored
      .filter(entry => {
        if (phase === 'post') return entry.base.startsWith('postsubmit-');
        if (phase === 'pre') return entry.base.startsWith('presubmit-') || entry.base.startsWith('extract-') || !entry.base.includes('-');
        return false;
      })
      .map(entry => {
        let rank = 0;
        if (phase === 'pre') {
          if (entry.base.startsWith('presubmit-')) rank += 30;
          else if (entry.base.startsWith('extract-')) rank += 20;
          else rank += 10;
        } else if (phase === 'post') {
          if (entry.base.startsWith('postsubmit-')) rank += 30;
        }
        if (entry.filePath.includes(`${path.sep}screenshots${path.sep}`)) rank += 5;
        return { ...entry, rank };
      })
      .sort((a, b) => b.rank - a.rank || b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
  }

  return {
    pre: pickForPhase('pre'),
    post: pickForPhase('post'),
  };
}

module.exports = {
  LOGS_DIR,
  IMAGE_EXT_RE,
  slugifyCompany,
  escapeRegex,
  collectImageFiles,
  listApplyImages,
};
