'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isLikelyApplicationConfirmation } = require('../lib/gmail-code');

describe('application confirmation email matching', () => {
  it('matches a confirmation email that references the company and job title', () => {
    const matched = isLikelyApplicationConfirmation(
      {
        company: 'Halcyon',
        title: 'Senior DevOps Engineer',
        url: 'https://job-boards.greenhouse.io/halcyon/jobs/5842441004',
      },
      {
        subject: 'Your application to Halcyon has been received',
        fromAddress: 'greenhouse-mail@example.com',
        raw: 'Thank you for applying to Senior DevOps Engineer at Halcyon.',
      }
    );

    assert.equal(matched, true);
  });

  it('rejects rejection emails even if they mention the company', () => {
    const matched = isLikelyApplicationConfirmation(
      {
        company: 'Halcyon',
        title: 'Senior DevOps Engineer',
        url: 'https://job-boards.greenhouse.io/halcyon/jobs/5842441004',
      },
      {
        subject: 'Update from Halcyon',
        fromAddress: 'greenhouse-mail@example.com',
        raw: 'Unfortunately, we will not be moving forward with your application.',
      }
    );

    assert.equal(matched, false);
  });
});
