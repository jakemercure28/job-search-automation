'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('application override helpers', () => {
  it('creates and preserves per-job override templates', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-overrides-'));
    const previousProfileDir = process.env.JOB_PROFILE_DIR;

    try {
      process.env.JOB_PROFILE_DIR = tmpDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];

      const {
        ensureApplicationOverrideTemplate,
        overridePathForJob,
      } = require('../lib/application-overrides');

      const job = {
        id: 'job-1',
        company: 'Acme',
        title: 'Platform Engineer',
        url: 'https://example.com/jobs/1',
      };

      const firstPath = ensureApplicationOverrideTemplate(job, job.url, [
        { label: 'Question one', name: 'question_one', type: 'text', required: true, options: [] },
      ]);
      assert.equal(firstPath, overridePathForJob(job.id));

      const firstPayload = JSON.parse(fs.readFileSync(firstPath, 'utf8'));
      assert.equal(firstPayload.answers.question_one, '');

      firstPayload.answers.question_one = 'Manual answer';
      fs.writeFileSync(firstPath, `${JSON.stringify(firstPayload, null, 2)}\n`);

      ensureApplicationOverrideTemplate(job, job.url, [
        { label: 'Question one', name: 'question_one', type: 'text', required: true, options: [] },
        { label: 'Question two', name: 'question_two', type: 'select', required: true, options: ['Yes', 'No'] },
      ]);

      const secondPayload = JSON.parse(fs.readFileSync(firstPath, 'utf8'));
      assert.equal(secondPayload.answers.question_one, 'Manual answer');
      assert.equal(secondPayload.answers.question_two, '');
    } finally {
      if (previousProfileDir == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = previousProfileDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
