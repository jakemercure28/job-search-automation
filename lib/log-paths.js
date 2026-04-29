'use strict';

const path = require('path');
const { dailyStamp } = require('./time-format');

const LOGS = path.join(__dirname, '..', 'logs');

module.exports = {
  daily:      (name) => path.join(LOGS, name, `${dailyStamp()}.log`),
  persistent: (name) => path.join(LOGS, name, `${name}.log`),
};
