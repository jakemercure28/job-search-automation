'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderApplicationPrepPage } = require('../lib/html/application-prep');

describe('manual application prep page', () => {
  it('renders answers, bookmarklet, and copy controls', () => {
    const html = renderApplicationPrepPage({
      job: {
        id: 'job-1',
        title: 'Platform Engineer',
        company: 'Acme',
        platform: 'Greenhouse',
        url: 'https://example.com/job',
        apply_complexity: 'complex',
      },
      prep: {
        status: 'ready',
        workflow: 'manual',
        apply_url: 'https://example.com/apply',
        generated_at: '2026-04-01T00:00:00Z',
        summary: 'Prepared for manual apply.',
        questions: [{ label: 'Why Acme?', name: 'why', type: 'textarea', required: true }],
        answers: { why: 'Because the role matches platform work.' },
        voiceChecks: {},
      },
    });

    assert.match(html, /Copy JSON/);
    assert.match(html, /Copy Plain Text/);
    assert.match(html, /Copy Bookmarklet/);
    assert.match(html, /Because the role matches platform work/);
    assert.match(html, /job-bookmarklet\.js\?id=job-1/);
  });
});
