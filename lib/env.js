'use strict';

const fs = require('fs');
const path = require('path');

const log = require('./logger')('env');

function requireEnv(name) {
  if (!process.env[name]) {
    log.error('Missing required environment variable', { name });
    process.exit(1);
  }
  return process.env[name];
}

function parseEnvValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] != null && String(process.env[key]) !== '') continue;
    process.env[key] = parseEnvValue(rawValue);
  }

  return true;
}

function loadDashboardEnv(baseDir = process.cwd()) {
  const repoRoot = path.resolve(baseDir);
  loadEnvFile(path.join(repoRoot, '.env'));
}

module.exports = {
  requireEnv,
  loadEnvFile,
  loadDashboardEnv,
};
