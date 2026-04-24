'use strict';

const SKIP_KEYS = new Set(['ts', 'level', 'component', 'msg']);

function shortTime(isoTs) {
  return isoTs ? isoTs.slice(11, 19) : new Date().toISOString().slice(11, 19);
}

function formatExtras(obj) {
  return Object.entries(obj)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('  ');
}

function formatLine(rawLine) {
  const line = rawLine.trim();
  if (!line) return null;

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.msg) return line;

  const time = shortTime(parsed.ts);
  const level = (parsed.level || 'info').toUpperCase().padEnd(5);
  const comp = (parsed.component || '').slice(0, 11).padEnd(11);
  const extras = formatExtras(parsed);

  return extras
    ? `${time}  ${level}  [${comp}]  ${parsed.msg}  ${extras}`
    : `${time}  ${level}  [${comp}]  ${parsed.msg}`;
}

function formatBuffer(buf) {
  if (!buf) return [];
  return buf
    .toString()
    .split('\n')
    .map(formatLine)
    .filter(Boolean);
}

module.exports = { formatLine, formatBuffer };
