'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  answerForGreenhouseQuestion,
  classifyGreenhouseSubmitOutcome,
  greenhouseComboboxSnapshotIsEmpty,
  resolveGreenhouseQuestionAnswer,
  selectGreenhouseEducationTarget,
} = require('../lib/ats-appliers/greenhouse');

describe('greenhouse auto-apply helpers', () => {
  it('treats typed combobox text without a selected value as empty', () => {
    assert.equal(greenhouseComboboxSnapshotIsEmpty({
      typedValue: 'University of Washington',
      selectedValue: '',
      hasSingleValueNode: false,
    }), true);
  });

  it('treats a rendered single-value selection as filled', () => {
    assert.equal(greenhouseComboboxSnapshotIsEmpty({
      typedValue: '',
      selectedValue: 'University of Washington',
      hasSingleValueNode: true,
    }), false);
  });

  it('targets the visible required education row before other school inputs', () => {
    const target = selectGreenhouseEducationTarget([
      { domIndex: 0, rowIndex: 0, visible: true, required: false, fieldName: 'school--0' },
      { domIndex: 1, rowIndex: 1, visible: true, required: true, fieldName: 'school--1' },
      { domIndex: 2, rowIndex: 2, visible: false, required: true, fieldName: 'school--2' },
    ]);

    assert.equal(target.fieldName, 'school--1');
  });

  it('classifies same-page invalid fields as a validation failure', () => {
    const outcome = classifyGreenhouseSubmitOutcome({
      pageText: 'Please correct the required fields below.',
      pageUrl: 'https://job-boards.greenhouse.io/acme/jobs/123',
      pageTitle: 'Apply',
      invalidFields: ['School*'],
      stillOnForm: true,
      isSuccess: false,
      isDuplicate: false,
      isAbuseWarning: false,
    });

    assert.equal(outcome.outcome, 'validation-failure');
    assert.deepEqual(outcome.details.invalidFields, ['School*']);
  });

  it('classifies a confirmation page as success', () => {
    const outcome = classifyGreenhouseSubmitOutcome({
      pageText: 'Thank you for applying.',
      isSuccess: true,
    });

    assert.equal(outcome.outcome, 'success');
  });

  it('classifies a non-invalid non-confirmation state as confirmation missing', () => {
    const outcome = classifyGreenhouseSubmitOutcome({
      pageText: 'Your request is being processed.',
      pageUrl: 'https://job-boards.greenhouse.io/acme/jobs/123/processing',
      pageTitle: 'Processing',
      invalidFields: [],
      stillOnForm: false,
      isSuccess: false,
      isDuplicate: false,
      isAbuseWarning: false,
    });

    assert.equal(outcome.outcome, 'confirmation-missing');
    assert.equal(outcome.details.pageTitle, 'Processing');
  });

  it('treats the Armada-style authorization question as yes', () => {
    const label = 'Are you currently authorized to work in the United States for any employer without restriction? (“Without restriction” means not tied to a specific employer and not dependent on a pending or future government filing.)';
    assert.equal(answerForGreenhouseQuestion(label, { usWorkAuthorized: 'Yes', requiresSponsorship: 'No' }), 'Yes');
  });

  it('prefers prepared answers over fallback heuristics', () => {
    const label = 'Are you currently authorized to work in the United States for any employer without restriction? (“Without restriction” means not tied to a specific employer and not dependent on a pending or future government filing.)';
    const answer = resolveGreenhouseQuestionAnswer(label, {
      usWorkAuthorized: 'No',
      requiresSponsorship: 'No',
    }, {
      question_123: 'Yes',
    }, 'question_123');

    assert.equal(answer, 'Yes');
  });
});
