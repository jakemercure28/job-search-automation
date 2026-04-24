'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('application prep answer guidance', () => {
  it('lets explicit overrides win over heuristic answers', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-prep-'));
    const previousProfileDir = process.env.JOB_PROFILE_DIR;

    try {
      process.env.JOB_PROFILE_DIR = tmpDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];

      const { overridePathForJob } = require('../lib/application-overrides');
      const { mergeResolvedAndOverrides } = require('../lib/application-prep');

      fs.mkdirSync(path.dirname(overridePathForJob('job-1')), { recursive: true });
      fs.writeFileSync(overridePathForJob('job-1'), JSON.stringify({
        jobId: 'job-1',
        answers: {
          work_auth: 'No',
        },
      }, null, 2));

      const { answers } = mergeResolvedAndOverrides('job-1', [
        { label: 'Are you legally authorized to work in the United States?', name: 'work_auth', type: 'select', required: true },
      ], {
        work_auth: 'Yes',
      });

      assert.equal(answers.work_auth, 'No');
    } finally {
      if (previousProfileDir == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = previousProfileDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats explicit blank overrides as resolved only for optional fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-prep-'));
    const previousProfileDir = process.env.JOB_PROFILE_DIR;

    try {
      process.env.JOB_PROFILE_DIR = tmpDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];

      const { overridePathForJob } = require('../lib/application-overrides');
      const { mergeResolvedAndOverrides } = require('../lib/application-prep');

      fs.mkdirSync(path.dirname(overridePathForJob('job-blank')), { recursive: true });
      fs.writeFileSync(overridePathForJob('job-blank'), JSON.stringify({
        jobId: 'job-blank',
        answers: {
          optional_note: '',
          required_note: '',
        },
      }, null, 2));

      const { answers, unresolved } = mergeResolvedAndOverrides('job-blank', [
        { label: 'Optional note', name: 'optional_note', type: 'text', required: false },
        { label: 'Required note', name: 'required_note', type: 'text', required: true },
      ], {});

      assert.equal(answers.optional_note, '');
      assert.equal(answers.required_note, '');
      assert.deepEqual(unresolved.map((field) => field.name), ['required_note']);
    } finally {
      if (previousProfileDir == null) delete process.env.JOB_PROFILE_DIR;
      else process.env.JOB_PROFILE_DIR = previousProfileDir;
      delete require.cache[require.resolve('../config/paths')];
      delete require.cache[require.resolve('../lib/application-overrides')];
      delete require.cache[require.resolve('../lib/application-prep')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps authorization and sponsorship prompts distinct', () => {
    const { heuristicAnswer } = require('../lib/application-prep');

    assert.equal(heuristicAnswer({
      label: 'Are you legally authorized to work in the United States?',
      options: ['Yes', 'No'],
      type: 'select',
    }, {}), 'Yes');

    assert.equal(heuristicAnswer({
      label: 'Will you now or in the future require employer sponsorship to work in the United States?',
      options: ['Yes', 'No'],
      type: 'select',
    }, {}), 'No');
  });

  it('leaves ambiguous combined work-eligibility prompts unresolved', () => {
    const { splitResolvedFields } = require('../lib/application-prep');
    const field = {
      label: 'Are you legally authorized to work in the United States and will you now or in the future require sponsorship?',
      name: 'combo_auth',
      options: ['Yes', 'No'],
      type: 'select',
      required: true,
    };

    const { resolved, unresolved } = splitResolvedFields([field], {});

    assert.deepEqual(resolved, {});
    assert.equal(unresolved.length, 1);
    assert.equal(unresolved[0].name, 'combo_auth');
  });
});
