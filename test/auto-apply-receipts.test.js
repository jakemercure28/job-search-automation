'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyAutoApplyFailure,
  summarizeAutoApplyAttempts,
} = require('../lib/auto-apply-receipts');
const { renderAutoApplies } = require('../lib/html/analytics');

describe('auto-apply receipts', () => {
  it('classifies common failure modes into normalized buckets', () => {
    assert.equal(classifyAutoApplyFailure('Required fields still empty before submit: Resume'), 'validation');
    assert.equal(classifyAutoApplyFailure('No success confirmation found after submit.'), 'confirmation-missing');
    assert.equal(classifyAutoApplyFailure('Abuse warning detected after submit.'), 'abuse-warning');
    assert.equal(classifyAutoApplyFailure('already submitted an application'), 'duplicate');
    assert.equal(classifyAutoApplyFailure('Manual review required for unresolved fields: sponsorship'), 'manual-review-needed');
    assert.equal(classifyAutoApplyFailure('Application form not detected on the greenhouse page'), 'closed-page');
  });

  it('summarizes receipt rows for the dashboard cards', () => {
    const summary = summarizeAutoApplyAttempts([
      { status: 'prepared', dry_run: 0 },
      { status: 'success', dry_run: 0 },
      { status: 'failed', dry_run: 0, failure_class: 'validation' },
      { status: 'failed', dry_run: 1, failure_class: 'duplicate' },
      { status: 'failed', dry_run: 0, failure_class: 'manual-review-needed' },
      { status: 'failed', dry_run: 0, failure_class: 'closed-page' },
    ]);

    assert.deepEqual(summary, {
      total: 6,
      submitted: 1,
      prepared: 1,
      failed: 4,
      dryRun: 1,
      retryNeeded: 1,
    });
  });

  it('renders the consolidated apply receipts page with cards and artifact links', () => {
    const html = renderAutoApplies({
      autoApplySummary: {
        total: 1,
        submitted: 1,
        prepared: 0,
        failed: 0,
        dryRun: 0,
        retryNeeded: 0,
      },
      autoApplyAttempts: [
        {
          attempt_id: 7,
          attempted_at: '2026-04-21T20:00:00Z',
          company: 'Acme',
          title: 'Platform Engineer',
          score: 8,
          platform: 'greenhouse',
          mode: 'submit',
          dry_run: 0,
          status: 'success',
          resume_filename: 'resume-ai.pdf',
          artifact_links: {
            resume: '/auto-apply-artifact?attemptId=7&type=resume',
            pre: '/auto-apply-artifact?attemptId=7&type=pre',
            post: '/auto-apply-artifact?attemptId=7&type=post',
          },
        },
      ],
      autoApplyFilters: {},
    });

    assert.match(html, /Apply Receipts/);
    assert.match(html, /Retry Needed/);
    assert.match(html, /Manual Review/);
    assert.match(html, /Failure Class/);
    assert.match(html, /Mode/);
    assert.match(html, /attemptId=7&type=resume/);
    assert.match(html, /Platform Engineer/);
  });
});
