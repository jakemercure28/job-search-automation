'use strict';

const fs = require('fs');

/**
 * Structured JSON logger. Writes one JSON object per line to stderr.
 * Pass { logFile: '/path/to/file.log' } as the second argument to also
 * append to a dedicated file.
 *
 * Usage:
 *   const log = require('./lib/logger')('pipeline');
 *   log.info('Scored job', { company: 'acme', score: 8 });
 *   log.error('Scoring failed', { error: err.message });
 *
 * Output:
 *   {"ts":"2026-04-24T10:33:45.667","level":"info","component":"pipeline","msg":"Scored job","company":"acme","score":8}
 *
 * Environment:
 *   LOG_LEVEL=debug|info|warn|error  (default: info)
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function localTs() {
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const p3 = n => String(n).padStart(3, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
}

function createLogger(component, options = {}) {
  let fileStream = null;
  let formatLine = null;
  if (options.logFile) {
    fs.mkdirSync(require('path').dirname(options.logFile), { recursive: true });
    fileStream = fs.createWriteStream(options.logFile, { flags: 'a' });
    if (options.humanReadable !== false) {
      ({ formatLine } = require('./refresh-logger'));
    }
  }

  function write(level, msg, data) {
    if ((LEVELS[level] ?? 0) < minLevel) return;
    const entry = {
      ts: localTs(),
      level,
      component,
      msg,
      ...data,
    };
    const jsonLine = JSON.stringify(entry) + '\n';
    process.stderr.write(jsonLine);
    if (fileStream) {
      fileStream.write(formatLine ? (formatLine(jsonLine) + '\n') : jsonLine);
    }
  }

  return {
    debug: (msg, data) => write('debug', msg, data),
    info:  (msg, data) => write('info', msg, data),
    warn:  (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
  };
}

module.exports = createLogger;
