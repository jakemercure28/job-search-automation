'use strict';

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function timezoneOffset(date = new Date(), { colon = true } = {}) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = pad(Math.floor(abs / 60));
  const minutes = pad(abs % 60);
  return colon ? `${sign}${hours}:${minutes}` : `${sign}${hours}${minutes}`;
}

function formatLocalTime(date = new Date()) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatLocalTimestamp(date = new Date(), { milliseconds = true, offsetColon = true } = {}) {
  const ms = milliseconds ? `.${pad(date.getMilliseconds(), 3)}` : '';
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    formatLocalTime(date),
    ms,
    timezoneOffset(date, { colon: offsetColon }),
  ].join('');
}

function dailyStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

module.exports = {
  dailyStamp,
  formatLocalTime,
  formatLocalTimestamp,
  timezoneOffset,
};
