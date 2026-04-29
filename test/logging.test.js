'use strict';

const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { formatLine } = require('../lib/refresh-logger');
const { dailyStamp, formatLocalTime, formatLocalTimestamp, timezoneOffset } = require('../lib/time-format');

describe('time formatting', () => {
  it('formats local timestamps with millisecond precision and timezone offset', () => {
    const date = new Date(2026, 3, 29, 14, 34, 1, 22);
    const offset = timezoneOffset(date);

    assert.match(offset, /^[+-]\d{2}:\d{2}$/);
    assert.equal(formatLocalTimestamp(date), `2026-04-29T14:34:01.022${offset}`);
  });

  it('formats local timestamps without milliseconds when requested', () => {
    const date = new Date(2026, 3, 29, 14, 34, 1, 22);

    assert.equal(
      formatLocalTimestamp(date, { milliseconds: false }),
      `2026-04-29T14:34:01${timezoneOffset(date)}`
    );
  });

  it('formats daily stamps with the repo log filename convention', () => {
    assert.equal(dailyStamp(new Date(2026, 3, 29, 14, 34, 1)), '20260429');
  });

  it('formats local wall-clock times without falling back to UTC', () => {
    assert.equal(formatLocalTime(new Date(2026, 3, 29, 14, 34, 1)), '14:34:01');
  });
});

describe('refresh log formatting', () => {
  it('formats structured JSON logs with offset timestamps', () => {
    const line = formatLine(JSON.stringify({
      ts: '2026-04-29T14:34:01.022-07:00',
      level: 'info',
      component: 'dashboard',
      msg: 'Dashboard running',
      url: 'http://localhost:3131',
    }));

    assert.equal(line, '14:34:01  INFO   [dashboard  ]  Dashboard running  url=http://localhost:3131');
  });

  it('keeps the refresh shell wrapper on daily log files', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'refresh-if-dashboard.sh'), 'utf8');

    assert.match(script, /LOG_DIR="\$REPO\/logs\/refresh"/);
    assert.match(script, /LOG="\$LOG_DIR\/\$\(date \+%Y%m%d\)\.log"/);
    assert.doesNotMatch(script, /logs\/refresh\.log/);
  });
});
