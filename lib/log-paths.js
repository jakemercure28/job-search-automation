'use strict';

const path = require('path');

const LOGS = path.join(__dirname, '..', 'logs');
const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

module.exports = {
  daily:      (name) => path.join(LOGS, `${name}-${today()}.log`),
  persistent: (name) => path.join(LOGS, `${name}.log`),
};
