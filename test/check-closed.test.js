'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getAutoCloseEligibility } = require('../scripts/check-closed');

describe('check-closed eligibility', () => {
  it('allows standard native Greenhouse rows', () => {
    assert.deepEqual(
      getAutoCloseEligibility({
        id: 'greenhouse-5030680008',
        platform: 'Greenhouse',
        url: 'https://job-boards.greenhouse.io/anthropic/jobs/5030680008',
      }),
      { platform: 'Greenhouse', slug: 'anthropic', jobId: '5030680008' }
    );

    assert.deepEqual(
      getAutoCloseEligibility({
        id: 'greenhouse-7241754',
        platform: 'greenhouse',
        url: 'https://boards.greenhouse.io/cloudflare/jobs/7241754?gh_jid=7241754',
      }),
      { platform: 'Greenhouse', slug: 'cloudflare', jobId: '7241754' }
    );
  });

  it('skips custom Greenhouse URLs with gh_jid', () => {
    assert.equal(
      getAutoCloseEligibility({
        id: 'greenhouse-7484028',
        platform: 'Greenhouse',
        url: 'http://bankrate.com/careers/current-openings?gh_jid=7484028',
      }),
      null
    );
  });

  it('skips Built In rows that point at Greenhouse or Ashby', () => {
    assert.equal(
      getAutoCloseEligibility({
        id: 'builtin-123',
        platform: 'Built In',
        url: 'https://job-boards.greenhouse.io/acme/jobs/123',
      }),
      null
    );

    assert.equal(
      getAutoCloseEligibility({
        id: 'builtin-456',
        platform: 'Built In',
        url: 'https://jobs.ashbyhq.com/acme/11111111-2222-3333-4444-555555555555',
      }),
      null
    );
  });

  it('allows standard native Ashby rows', () => {
    assert.deepEqual(
      getAutoCloseEligibility({
        id: 'ashby-6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
        platform: 'Ashby',
        url: 'https://jobs.ashbyhq.com/helion/6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      }),
      {
        platform: 'Ashby',
        slug: 'helion',
        jobId: '6b2ee1c2-509e-4433-9a60-3f79d7dfcd42',
      }
    );
  });

  it('skips Lever, Rippling, Workday, manual, and generic rows', () => {
    const skipped = [
      {
        id: 'lever-11111111-2222-3333-4444-555555555555',
        platform: 'Lever',
        url: 'https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555',
      },
      {
        id: 'rippling-11111111-2222-3333-4444-555555555555',
        platform: 'Rippling',
        url: 'https://ats.rippling.com/acme/jobs/11111111-2222-3333-4444-555555555555',
      },
      {
        id: 'workday-123',
        platform: 'Workday',
        url: 'https://acme.wd1.myworkdayjobs.com/en-US/careers/job/test',
      },
      {
        id: 'manual-123',
        platform: 'Manual',
        url: 'https://example.com/manual-job',
      },
      {
        id: 'generic-123',
        platform: null,
        url: 'https://example.com/job/123',
      },
    ];

    for (const row of skipped) {
      assert.equal(getAutoCloseEligibility(row), null, `${row.platform || 'generic'} should be skipped`);
    }
  });
});
