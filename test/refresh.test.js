'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs } = require('../scripts/refresh');

describe('refresh arguments', () => {
  it('runs slug validation by default', () => {
    assert.equal(parseArgs([]).skipSlugCheck, false);
  });

  it('can skip slug validation explicitly', () => {
    assert.equal(parseArgs(['--skip-slug-check']).skipSlugCheck, true);
  });
});

