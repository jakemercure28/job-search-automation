'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseCompanyTags, serializeCompanyTags } = require('../lib/company-tags');

describe('company tag helpers', () => {
  it('normalizes, deduplicates, and sorts tags before storage', () => {
    assert.equal(
      serializeCompanyTags(' Priority,agency,  follow up ,Agency,priority '),
      'agency, follow up, priority'
    );
  });

  it('accepts arrays and returns a stable sorted list', () => {
    assert.deepEqual(
      parseCompanyTags(['zeta', 'Agency', 'alpha', 'agency', '  beta  ']),
      ['agency', 'alpha', 'beta', 'zeta']
    );
  });
});
