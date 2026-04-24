'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadEnvFile } = require('../lib/env');

describe('env loader', () => {
  it('fills empty environment variables from the env file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
    const filePath = path.join(dir, '.env');
    fs.writeFileSync(filePath, 'JOB_PROFILE_DIR=profiles/jake\nJOB_DB_PATH=profiles/jake/jobs.db\n');

    const prevProfile = process.env.JOB_PROFILE_DIR;
    const prevDb = process.env.JOB_DB_PATH;
    process.env.JOB_PROFILE_DIR = '';
    process.env.JOB_DB_PATH = '';

    try {
      assert.equal(loadEnvFile(filePath), true);
      assert.equal(process.env.JOB_PROFILE_DIR, 'profiles/jake');
      assert.equal(process.env.JOB_DB_PATH, 'profiles/jake/jobs.db');
    } finally {
      if (prevProfile == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = prevProfile;
      if (prevDb == null) delete process.env.JOB_DB_PATH;
      else process.env.JOB_DB_PATH = prevDb;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
