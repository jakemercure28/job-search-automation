'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderSlugHealthBanner } = require('../lib/dashboard-html');

describe('dashboard slug health banner', () => {
  it('renders separate broken, blocked, and transient counts', () => {
    const html = renderSlugHealthBanner({
      timestamp: '2026-04-30T12:00:00Z',
      broken: [
        { ats: 'Greenhouse', slug: 'rootly', note: 'HTTP 404', status: 404, attempts: 1 },
        { ats: 'Ashby', slug: 'observeinc', note: 'HTTP 404', status: 404, attempts: 1 },
      ],
      blocked: [
        { ats: 'Workable', slug: 'huggingface', note: 'HTTP 429', status: 429, attempts: 3 },
      ],
      transient: [
        { ats: 'Lever', slug: 'example', note: 'HTTP 500', status: 500, attempts: 3 },
      ],
    });

    assert.match(html, /2 broken ATS slugs/);
    assert.match(html, /1 blocked check/);
    assert.match(html, /1 transient check/);
    assert.match(html, /8 attempts across 4 checks/);
    assert.match(html, /npm run validate-slugs:broken/);
  });

  it('suppresses the banner when the current health timestamp is dismissed', () => {
    assert.equal(renderSlugHealthBanner({
      _dismissed: true,
      timestamp: '2026-04-30T12:00:00Z',
      broken: [{ ats: 'Greenhouse', slug: 'rootly', note: 'HTTP 404', status: 404, attempts: 1 }],
    }), '');
  });

  it('renders safely for the old broken-only slug-health shape', () => {
    const html = renderSlugHealthBanner({
      timestamp: '2026-04-30T12:00:00Z',
      broken: [{ ats: 'Greenhouse', slug: 'old-slug', note: 'HTTP 404' }],
    });

    assert.match(html, /1 broken ATS slug/);
    assert.match(html, /Greenhouse\/old-slug/);
  });
});
