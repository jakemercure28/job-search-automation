'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDashboardSearchOptions,
  parseDashboardSearchOptions,
  jobMatchesSearch,
  applyDashboardSearch,
} = require('../lib/dashboard-search');

describe('dashboard search', () => {
  it('normalizes dashboard search options', () => {
    assert.deepEqual(
      normalizeDashboardSearchOptions({ q: '  remote   aws  ', minScore: '12' }),
      { q: 'remote aws', minScore: 9 }
    );

    assert.deepEqual(
      normalizeDashboardSearchOptions({ q: '', minScore: 'nope' }),
      { q: '', minScore: 1 }
    );
  });

  it('parses normalized search options from URL parameters', () => {
    const url = new URL('http://localhost/?q=Acme%20%20remote&minScore=0');
    assert.deepEqual(parseDashboardSearchOptions(url), { q: 'Acme remote', minScore: 1 });
  });

  it('matches jobs case-insensitively across searchable fields', () => {
    const job = {
      title: 'Senior Platform Engineer',
      company: 'Acme',
      description: 'Hands-on AWS and Kubernetes work.',
      platform: 'Greenhouse',
    };

    assert.equal(jobMatchesSearch(job, '  AWS and   Kubernetes '), true);
    assert.equal(jobMatchesSearch(job, 'lever'), false);
  });

  it('filters jobs by score and normalized query', () => {
    const jobs = [
      { id: '1', title: 'Platform Engineer', description: 'AWS infra', score: 8 },
      { id: '2', title: 'Frontend Engineer', description: 'React UI', score: 9 },
      { id: '3', title: 'SRE', description: 'AWS operations', score: 6 },
    ];

    assert.deepEqual(
      applyDashboardSearch(jobs, { q: '  aws ', minScore: '7' }).map((job) => job.id),
      ['1']
    );
  });
});
