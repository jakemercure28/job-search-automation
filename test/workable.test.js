'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { fetchWorkableAccountJobs, normalizeWorkableJobs } = require('../lib/workable');
const { checkWorkable } = require('../scripts/validate-slugs');

function jsonResponse(status, data, url = 'https://example.com') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async json() { return data; },
  };
}

describe('Workable public endpoints', () => {
  it('normalizes public account endpoint jobs', () => {
    const jobs = normalizeWorkableJobs({
      name: 'Acme',
      jobs: [{
        shortcode: 'ABC123',
        title: 'Site Reliability Engineer',
        url: 'https://apply.workable.com/acme/j/ABC123',
        created_at: '2026-04-20T00:00:00Z',
        description: '<p>Keep systems reliable.</p>',
        location: { city: 'Remote', country: 'United States' },
      }],
    }, 'acme');

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'workable-acme-ABC123');
    assert.equal(jobs[0].company, 'Acme');
    assert.equal(jobs[0].description, 'Keep systems reliable.');
    assert.equal(jobs[0].location, 'Remote, United States');
  });

  it('normalizes widget endpoint jobs nested below account data', () => {
    const jobs = normalizeWorkableJobs({
      account: {
        name: 'Widget Co',
        departments: [{
          name: 'Engineering',
          jobs: [{
            shortcode: 'XYZ789',
            title: 'Platform Engineer',
            description_html: '<b>Build platforms</b>',
            locations: ['Remote'],
          }],
        }],
      },
    }, 'widgetco');

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'workable-widgetco-XYZ789');
    assert.equal(jobs[0].url, 'https://apply.workable.com/j/XYZ789');
    assert.equal(jobs[0].company, 'Widget Co');
  });

  it('tries public endpoints before v3 and reports blocked on 429', async () => {
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (url.includes('www.workable.com')) return jsonResponse(429, {});
      if (url.includes('/api/v1/widget/')) return jsonResponse(429, {});
      return jsonResponse(429, {});
    };

    const result = await fetchWorkableAccountJobs('blockedco', { fetch });

    assert.equal(result.result, 'blocked');
    assert.equal(result.attempts.length, 3);
    assert.match(calls[0], /www\.workable\.com\/api\/accounts\/blockedco/);
    assert.match(calls[1], /apply\.workable\.com\/api\/v1\/widget\/accounts\/blockedco/);
    assert.match(calls[2], /apply\.workable\.com\/api\/v3\/accounts\/blockedco\/jobs/);
  });

  it('validator classifies Workable 429 as blocked, not broken', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => jsonResponse(429, {});
    try {
      const result = await checkWorkable('blockedco');
      assert.equal(result.result, 'blocked');
      assert.match(result.note, /HTTP 429/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
