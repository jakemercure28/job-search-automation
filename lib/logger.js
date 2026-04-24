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
 *   {"ts":"2026-03-27T18:00:00.000Z","level":"info","component":"pipeline","msg":"Scored job","company":"acme","score":8}
 */

function createLogger(component, options = {}) {
  let fileStream = null;
  if (options.logFile) {
    fs.mkdirSync(require('path').dirname(options.logFile), { recursive: true });
    fileStream = fs.createWriteStream(options.logFile, { flags: 'a' });
  }

  function write(level, msg, data) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      component,
      msg,
      ...data,
    };
    const line = JSON.stringify(entry) + '\n';
    process.stderr.write(line);
    if (fileStream) fileStream.write(line);
  }

  return {
    info:  (msg, data) => write('info', msg, data),
    warn:  (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
  };
}

module.exports = createLogger;
