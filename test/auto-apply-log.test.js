'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderAutoApplyLog, getLatestRealAutoApplyOutcomes } = require('../lib/html/analytics');

describe('auto-apply log summary', () => {
  it('counts latest real outcome per job instead of every retry attempt', () => {
    const rows = [
      { job_id: 'guided', attempted_at: '2026-04-12T19:30:39.779Z', status: 'prepared', dry_run: 0, company: 'atlas', title: 'Platform', score: 8 },
      { job_id: 'zora', attempted_at: '2026-04-12T19:43:39.779Z', status: 'success', dry_run: 0, company: 'zora', title: 'SRE', score: 8 },
      { job_id: 'poshmark', attempted_at: '2026-04-12T19:58:01.660Z', status: 'failed', dry_run: 0, company: 'poshmark', title: 'SRE', score: 8 },
      { job_id: 'poshmark', attempted_at: '2026-04-12T19:58:50.552Z', status: 'failed', dry_run: 0, company: 'poshmark', title: 'SRE', score: 8 },
      { job_id: 'poshmark', attempted_at: '2026-04-12T20:00:16.397Z', status: 'failed', dry_run: 0, company: 'poshmark', title: 'SRE', score: 8 },
      { job_id: 'mercury', attempted_at: '2026-04-12T20:01:33.400Z', status: 'success', dry_run: 0, company: 'mercury', title: 'Release Engineering', score: 7 },
      { job_id: 'mercury', attempted_at: '2026-04-12T20:05:33.400Z', status: 'success', dry_run: 1, company: 'mercury', title: 'Release Engineering', score: 7 },
    ];

    assert.deepEqual(
      getLatestRealAutoApplyOutcomes(rows).map(row => ({ job_id: row.job_id, status: row.status })),
      [
        { job_id: 'guided', status: 'prepared' },
        { job_id: 'zora', status: 'success' },
        { job_id: 'poshmark', status: 'failed' },
        { job_id: 'mercury', status: 'success' },
      ]
    );

    const html = renderAutoApplyLog({ autoApplyLog: rows });
    assert.ok(html.includes('>4</span> jobs &mdash; <span style="color:#93c5fd;font-family:var(--font-mono)">1</span> prepared, <span style="color:#4ade80;font-family:var(--font-mono)">2</span> submitted, <span style="color:#f87171;font-family:var(--font-mono)">1</span> failed'));
    assert.match(html, /\(\+ 1 dry run\)/);
  });
});
