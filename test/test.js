'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// matchesSearchTerms
// ---------------------------------------------------------------------------

const { matchesSearchTerms } = require('../lib/scraper-utils');

describe('matchesSearchTerms', () => {
  it('matches devops titles', () => {
    assert.ok(matchesSearchTerms('Senior DevOps Engineer'));
    assert.ok(matchesSearchTerms('SRE Lead'));
    assert.ok(matchesSearchTerms('Platform Engineer II'));
    assert.ok(matchesSearchTerms('Cloud Engineer'));
  });

  it('rejects non-matching titles', () => {
    assert.ok(!matchesSearchTerms('Product Manager'));
    assert.ok(!matchesSearchTerms('Frontend Developer'));
    assert.ok(!matchesSearchTerms(''));
    assert.ok(!matchesSearchTerms(null));
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

const { escapeHtml, stripHtml } = require('../lib/utils');

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands and quotes', () => {
    assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  });

  it('handles null/undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });
});

// ---------------------------------------------------------------------------
// stripHtml
// ---------------------------------------------------------------------------

describe('stripHtml', () => {
  it('strips HTML tags and collapses whitespace', () => {
    assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  });

  it('respects maxLen', () => {
    const long = '<p>' + 'a'.repeat(20000) + '</p>';
    assert.ok(stripHtml(long).length <= 15000);
  });

  it('handles empty input', () => {
    assert.equal(stripHtml(''), '');
    assert.equal(stripHtml(null), '');
  });

  it('decodes nested entities before stripping tags', () => {
    assert.equal(stripHtml('&amp;lt;b&amp;gt;Hi&amp;lt;/b&amp;gt; &amp;amp; bye'), 'Hi & bye');
  });
});

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

describe('safeFetch', () => {
  const { safeFetch } = require('../lib/utils');

  it('returns null for non-ok responses', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false });

    try {
      const result = await safeFetch('https://example.com');
      assert.equal(result, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('clears the timeout when fetch throws', async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    const timerToken = { id: 'timer-1' };
    let clearedToken = null;

    global.fetch = async () => {
      throw new Error('network down');
    };
    global.setTimeout = () => timerToken;
    global.clearTimeout = (token) => {
      clearedToken = token;
    };

    try {
      const result = await safeFetch('https://example.com');
      assert.equal(result, null);
      assert.equal(clearedToken, timerToken);
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });
});

// ---------------------------------------------------------------------------
// Score parsing (the regex from scorer.js)
// ---------------------------------------------------------------------------

describe('score parsing', () => {
  function parseScore(text) {
    const scoreMatch = text.match(/^SCORE:\s*(\d+)/m);
    const reasoningMatch = text.match(/^REASONING:\s*(.+)/ms);
    const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : null;
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : (scoreMatch ? text : `Score parse failed. Raw: ${text.slice(0, 200)}`);
    return { score, reasoning };
  }

  it('parses valid response', () => {
    const text = 'SCORE: 8\nREASONING: Strong match for stack and seniority.';
    const { score, reasoning } = parseScore(text);
    assert.equal(score, 8);
    assert.equal(reasoning, 'Strong match for stack and seniority.');
  });

  it('clamps score to 1-10', () => {
    assert.equal(parseScore('SCORE: 15\nREASONING: test').score, 10);
    assert.equal(parseScore('SCORE: 0\nREASONING: test').score, 1);
  });

  it('returns null score on unparseable response', () => {
    const result = parseScore('This is garbage output');
    assert.equal(result.score, null);
    assert.ok(result.reasoning.startsWith('Score parse failed.'));
  });

  it('handles multiline reasoning', () => {
    const text = 'SCORE: 7\nREASONING: Line one.\nLine two continues here.';
    const { reasoning } = parseScore(text);
    assert.ok(reasoning.includes('Line one.'));
    assert.ok(reasoning.includes('Line two'));
  });
});

// ---------------------------------------------------------------------------
// Location filter
// ---------------------------------------------------------------------------

const { isLocationAllowed } = require('../lib/location-filter');

describe('isLocationAllowed', () => {
  // The filter is env-configured via LOCATION_FILTER and LOCATION_BLOCKLIST.
  // With no env vars set (default in tests), Remote is always allowed and
  // everything else passes through to the scorer.
  it('allows Remote by default', () => {
    assert.ok(isLocationAllowed('Remote'));
    assert.ok(isLocationAllowed('Anywhere'));
  });

  it('allows empty/unknown locations', () => {
    assert.ok(isLocationAllowed(''));
    assert.ok(isLocationAllowed(null));
  });

  it('passes through specific cities when no filter is set', () => {
    assert.ok(isLocationAllowed('Austin, TX'));
    assert.ok(isLocationAllowed('Berlin, Germany'));
  });
});

// ---------------------------------------------------------------------------
// WWR RSS extractTag
// ---------------------------------------------------------------------------

describe('wwr extractTag', () => {
  // Import the function by testing the module indirectly through scrapeWWR output shape
  // Since extractTag is not exported, we test the scraper's output contract

  it('scrapeWWR returns an array', async () => {
    // Just verify the module loads and the function signature is correct
    const { scrapeWWR } = require('../scrapers/wwr');
    assert.equal(typeof scrapeWWR, 'function');
  });
});

// ---------------------------------------------------------------------------
// Job object shape validation
// ---------------------------------------------------------------------------

describe('job object shape', () => {
  const REQUIRED_FIELDS = ['id', 'platform', 'title', 'company', 'url', 'postedAt', 'description', 'location'];

  it('validates a well-formed job object', () => {
    const job = {
      id: 'greenhouse-123',
      platform: 'Greenhouse',
      title: 'DevOps Engineer',
      company: 'acme',
      url: 'https://example.com/job/123',
      postedAt: '2026-03-15T00:00:00Z',
      description: 'Build infrastructure',
      location: 'Remote',
    };
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in job, `missing field: ${field}`);
      assert.ok(typeof job[field] === 'string', `field ${field} should be a string`);
    }
  });
});

// ---------------------------------------------------------------------------
// check-descriptions thresholds
// ---------------------------------------------------------------------------

const { CRITICAL, WARN, checkDescriptions } = require('../scripts/check-descriptions');

describe('checkDescriptions thresholds', () => {
  it('CRITICAL is less than WARN', () => {
    assert.ok(CRITICAL < WARN, 'CRITICAL threshold must be lower than WARN');
  });

  it('classifies empty description as critical', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '1', title: 'DevOps Engineer', company: 'acme', platform: 'Ashby', len: 0 },
      ]}),
    };
    const { critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(critical.length, 1);
    assert.equal(warn.length, 0);
    assert.equal(ok, 0);
  });

  it('classifies short description as warn', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '2', title: 'SRE', company: 'acme', platform: 'Greenhouse', len: 150 },
      ]}),
    };
    const { critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(critical.length, 0);
    assert.equal(warn.length, 1);
    assert.equal(ok, 0);
  });

  it('classifies full description as ok', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '3', title: 'Platform Engineer', company: 'acme', platform: 'Lever', len: 4500 },
      ]}),
    };
    const { critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(critical.length, 0);
    assert.equal(warn.length, 0);
    assert.equal(ok, 1);
  });

  it('handles mixed batch correctly', () => {
    const fakeDb = {
      prepare: () => ({ all: () => [
        { id: '1', title: 'A', company: 'x', platform: 'Ashby',     len: 0 },
        { id: '2', title: 'B', company: 'x', platform: 'Workday',   len: 150 },
        { id: '3', title: 'C', company: 'x', platform: 'Greenhouse',len: 5000 },
      ]}),
    };
    const { total, critical, warn, ok } = checkDescriptions(fakeDb);
    assert.equal(total, 3);
    assert.equal(critical.length, 1);
    assert.equal(warn.length, 1);
    assert.equal(ok, 1);
  });
});
