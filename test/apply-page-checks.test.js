'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { detectApplicationPageIssue, matchesStandardField } = require('../lib/ats-appliers/page-checks');

describe('page checks', () => {
  it('flags Greenhouse error redirects as closed jobs', () => {
    const issue = detectApplicationPageIssue('greenhouse', {
      url: 'https://job-boards.greenhouse.io/sonyinteractiveentertainmentglobal?error=true',
      text: 'The job you are looking for is no longer open. Current openings at PlayStation Global',
      fileInputCount: 0,
      standardFieldCount: 0,
    }, {
      sourceUrl: 'https://job-boards.greenhouse.io/sonyinteractiveentertainmentglobal/jobs/5710578004',
      jobId: '5710578004',
    });

    assert.equal(issue, 'Job is no longer available');
  });

  it('flags redirects to listing pages as invalid application pages', () => {
    const issue = detectApplicationPageIssue('greenhouse', {
      url: 'https://www.anduril.com/open-roles',
      text: 'CAREERS Open Roles Showing 100 results out of total 1823',
      fileInputCount: 0,
      standardFieldCount: 0,
    }, {
      sourceUrl: 'https://boards.greenhouse.io/andurilindustries/jobs/5082090007?gh_jid=5082090007',
      jobId: '5082090007',
    });

    assert.equal(issue, 'Redirected away from job 5082090007 to a listing page');
  });

  it('accepts pages that clearly look like an application form', () => {
    const issue = detectApplicationPageIssue('greenhouse', {
      url: 'https://job-boards.greenhouse.io/example/jobs/123456',
      text: 'Apply for this job First Name Last Name Email Phone Resume Submit Application',
      fileInputCount: 1,
      standardFieldCount: 4,
    }, {
      sourceUrl: 'https://job-boards.greenhouse.io/example/jobs/123456',
      jobId: '123456',
    });

    assert.equal(issue, null);
  });

  it('matches standard application fields', () => {
    assert.equal(matchesStandardField('first_name'), true);
    assert.equal(matchesStandardField('Resume Upload'), true);
    assert.equal(matchesStandardField('question_123456'), false);
  });
});
