'use strict';

const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getProfileDir, loadAutoApplyConfig, parseDryRun } = require('../scripts/run-auto-apply');

describe('run-auto-apply script helpers', () => {
  it('parses the dry-run flag', () => {
    assert.equal(parseDryRun(['--dry-run']), true);
    assert.equal(parseDryRun([]), false);
  });

  it('resolves relative JOB_PROFILE_DIR before loading auto-apply config', () => {
    const previous = process.env.JOB_PROFILE_DIR;
    process.env.JOB_PROFILE_DIR = 'profiles/example';

    try {
      assert.equal(getProfileDir(), path.resolve('profiles/example'));

      const config = loadAutoApplyConfig();
      assert.equal(typeof config, 'object');
      assert.equal(typeof config.dailyLimit, 'number');
      assert.equal(typeof config.applicant, 'object');
    } finally {
      if (previous == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = previous;
    }
  });
});
