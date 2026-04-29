'use strict';

const fs = require('fs');
const { formatLocalTimestamp } = require('./time-format');

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
      ts: formatLocalTimestamp(),
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

  function makeLogger(bindings) {
    function boundWrite(level, msg, data) {
      write(level, msg, bindings ? { ...bindings, ...data } : data);
    }
    return {
      debug: (msg, data) => boundWrite('debug', msg, data),
      info:  (msg, data) => boundWrite('info', msg, data),
      warn:  (msg, data) => boundWrite('warn', msg, data),
      error: (msg, data) => boundWrite('error', msg, data),
      timer: () => { const s = Date.now(); return () => Date.now() - s; },
      child: (extra) => makeLogger(bindings ? { ...bindings, ...extra } : extra),
    };
  }

  return makeLogger(null);
}

module.exports = createLogger;
