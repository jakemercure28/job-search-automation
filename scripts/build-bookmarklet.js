#!/usr/bin/env node
'use strict';

// Build the deployable bookmarklet from public/bookmarklet.template.js.
// Reads applicant identity from APPLICANT_* env vars, substitutes the
// placeholders, minifies the result, and writes public/bookmarklet.js.
// The output file is gitignored because it contains personal data.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'public', 'bookmarklet.template.js');
const OUTPUT = path.join(ROOT, 'public', 'bookmarklet.js');

const replacements = {
  __APPLICANT_FIRST_NAME__: process.env.APPLICANT_FIRST_NAME || '',
  __APPLICANT_LAST_NAME__: process.env.APPLICANT_LAST_NAME || '',
  __APPLICANT_EMAIL__: process.env.APPLICANT_EMAIL || '',
  __APPLICANT_PHONE__: process.env.APPLICANT_PHONE || '',
  __APPLICANT_LINKEDIN__: process.env.APPLICANT_LINKEDIN || '',
  __APPLICANT_GITHUB__: process.env.APPLICANT_GITHUB || '',
};

const missing = Object.entries(replacements).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.warn('[build-bookmarklet] Warning, missing env vars will be empty strings:');
  for (const name of missing) console.warn('  ' + name);
}

let source = fs.readFileSync(TEMPLATE, 'utf8');
for (const [token, value] of Object.entries(replacements)) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  source = source.split(token).join(escaped);
}

// Minimal minify: drop full-line comments only (never inline, since URLs contain '//').
// Strip leading banner, then drop any line whose first non-space character is '//',
// then collapse whitespace.
const lines = source.split('\n');
const keep = [];
let bannerDone = false;
for (const line of lines) {
  const trimmed = line.trim();
  if (!bannerDone && (trimmed === '' || trimmed.startsWith('//'))) continue;
  bannerDone = true;
  if (trimmed.startsWith('//')) continue;
  keep.push(line);
}
const collapsed = keep.join('\n').replace(/\s+/g, ' ').trim();
const bookmarklet = 'javascript:' + collapsed;

fs.writeFileSync(OUTPUT, bookmarklet + '\n');
console.log('[build-bookmarklet] Wrote ' + path.relative(ROOT, OUTPUT) + ' (' + bookmarklet.length + ' bytes)');
