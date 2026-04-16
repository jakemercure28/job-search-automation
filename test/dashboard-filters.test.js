'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderFilters } = require('../lib/html/filters');
const { buildDashboardHref } = require('../lib/html/helpers');

describe('dashboard filter links', () => {
  it('builds dashboard URLs with persisted search state', () => {
    assert.equal(
      buildDashboardHref('all', 'score', '1', { q: 'platform aws', minScore: 7, page: 3 }),
      '/?filter=all&sort=score&level=1&q=platform+aws&minScore=7&page=3'
    );
  });

  it('renders filter controls with current search values', () => {
    const html = renderFilters('all', 'score', { myLevel: 12 }, '1', {
      q: 'Acme remote',
      minScore: 6,
    });

    assert.match(html, /value="Acme remote"/);
    assert.match(html, /id="score-filter"[^>]*value="6"/);
    assert.match(html, /href="\/\?filter=rejected&sort=score&level=1&q=Acme\+remote&minScore=6"/);
  });
});
