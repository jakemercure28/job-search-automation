'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { screenshotPath, hasDuplicateSubmissionMessage, hasAbuseWarningMessage } = require('../lib/ats-appliers/browser');

describe('screenshotPath', () => {
  it('uses prefix, company, title, and a timestamped filename', () => {
    const filePath = screenshotPath({
      company: 'Ashby',
      title: 'Staff Platform Engineer, Americas',
    }, 'postsubmit');

    assert.match(filePath, /logs\/screenshots\/postsubmit-ashby-staff-platform-engineer-americas-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.png$/);
  });

  it('detects duplicate-submission confirmation text', () => {
    assert.equal(
      hasDuplicateSubmissionMessage("You've already submitted an application for this role."),
      true
    );
    assert.equal(
      hasDuplicateSubmissionMessage('Thanks for applying.'),
      false
    );
  });

  it('detects abuse warning text', () => {
    assert.equal(
      hasAbuseWarningMessage('This application looks like spam. Please contact support.'),
      true
    );
    assert.equal(
      hasAbuseWarningMessage('Application received successfully.'),
      false
    );
  });
});
