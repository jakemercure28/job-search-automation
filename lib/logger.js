'use strict';

/**
 * Structured JSON logger. Writes one JSON object per line to stderr.
 *
 * Usage:
 *   const log = require('./lib/logger')('pipeline');
 *   log.info('Scored job', { company: 'acme', score: 8 });
 *   log.error('Scoring failed', { error: err.message });
 *
 * Output:
 *   {"ts":"2026-03-27T18:00:00.000Z","level":"info","component":"pipeline","msg":"Scored job","company":"acme","score":8}
 */

function createLogger(component) {
  function write(level, msg, data) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      component,
      msg,
      ...data,
    };
    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  return {
    info:  (msg, data) => write('info', msg, data),
    warn:  (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
  };
}

module.exports = createLogger;
