'use strict';

const fs = require('fs');
const path = require('path');

const FILENAME = 'suggested-companies.json';

function empty() {
  return { greenhouse: [], ashby: [], lever: [], updatedAt: null };
}

function loadSuggested(profileDir) {
  const filePath = path.join(profileDir, FILENAME);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return {
      greenhouse: Array.isArray(data.greenhouse) ? data.greenhouse : [],
      ashby:      Array.isArray(data.ashby)      ? data.ashby      : [],
      lever:      Array.isArray(data.lever)       ? data.lever      : [],
      updatedAt:  data.updatedAt || null,
    };
  } catch {
    return empty();
  }
}

function saveSuggested(profileDir, data) {
  const filePath = path.join(profileDir, FILENAME);
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function allSlugs(suggested) {
  return new Set([
    ...(suggested.greenhouse || []),
    ...(suggested.ashby      || []),
    ...(suggested.lever      || []),
  ]);
}

module.exports = { loadSuggested, saveSuggested, allSlugs };
