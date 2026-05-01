'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.join(__dirname, '..');
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('slug validation configuration', () => {
  it('loads company slugs through active-profile config', () => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-profile-'));
    fs.writeFileSync(path.join(profileDir, 'companies.js'), `
'use strict';
module.exports = {
  GREENHOUSE_COMPANIES: ['gh-one', 'gh-two'],
  LEVER_COMPANIES: ['lever-one'],
  WORKABLE_COMPANIES: [],
  ASHBY_COMPANIES: [],
  WORKDAY_COMPANIES: [],
  RIPPLING_COMPANIES: ['rippling-one'],
};
`);

    const output = execFileSync(process.execPath, ['-e', `
process.env.JOB_PROFILE_DIR = ${JSON.stringify(profileDir)};
const { atsBatches } = require('./scripts/validate-slugs');
console.log(JSON.stringify(Object.fromEntries(atsBatches().map(([name, items]) => [name, items.length]))));
`], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, JOB_PROFILE_DIR: profileDir },
    });

    assert.deepEqual(JSON.parse(output), {
      Greenhouse: 2,
      Lever: 1,
      Ashby: 0,
      Workable: 0,
      Workday: 0,
      Rippling: 1,
    });
  });

  it('does not hard-code the example companies file', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'validate-slugs.js'), 'utf8');
    assert.match(source, /require\('\.\.\/config\/companies'\)/);
    assert.doesNotMatch(source, /profiles\/example\/companies\.js/);
  });
});

describe('slug validation health categories', () => {
  const {
    classifyFailure,
    checkGreenhouse,
    runCheckWithRetries,
  } = require('../scripts/validate-slugs');

  function fetchResponse(status, body = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('classifies 404 and 422 as broken', async () => {
    global.fetch = async () => fetchResponse(404, { error: 'not found' });
    assert.equal((await checkGreenhouse('missing')).result, 'broken');

    global.fetch = async () => fetchResponse(422, { error: 'invalid' });
    assert.equal((await checkGreenhouse('invalid')).result, 'broken');
  });

  it('classifies 429 and anti-bot responses as blocked', async () => {
    global.fetch = async () => fetchResponse(429, { error: 'too many requests' });
    assert.equal((await checkGreenhouse('limited')).result, 'blocked');
    assert.equal(classifyFailure({ status: 403, text: 'Cloudflare captcha challenge' }), 'blocked');
  });

  it('classifies 500, timeout, and DNS failures as transient', async () => {
    global.fetch = async () => fetchResponse(500, { error: 'server error' });
    assert.equal((await checkGreenhouse('server-error')).result, 'transient');
    assert.equal(classifyFailure({ status: 0, errorName: 'TimeoutError', error: 'The operation was aborted' }), 'transient');
    assert.equal(classifyFailure({ status: 0, error: 'getaddrinfo ENOTFOUND api.example.test' }), 'transient');
  });

  it('retries retryable failures up to 3 total attempts', async () => {
    let calls = 0;
    const result = await runCheckWithRetries('Greenhouse', 'retry-me', 'retry-me', async () => {
      calls += 1;
      return calls < 3
        ? { result: 'transient', note: 'HTTP 500', status: 500, url: 'https://example.test' }
        : { result: 'ok', count: 1, status: 200, url: 'https://example.test' };
    }, { retryBaseMs: 0, retryMaxMs: 0, logAttempts: false });

    assert.equal(calls, 3);
    assert.equal(result.result, 'ok');
    assert.equal(result.attempts, 3);
  });

  it('does not retry hard 404 without a verified replacement candidate', async () => {
    let calls = 0;
    const result = await runCheckWithRetries('Greenhouse', 'missing', 'missing', async () => {
      calls += 1;
      return { result: 'broken', note: 'HTTP 404', status: 404, url: 'https://example.test' };
    }, { retryBaseMs: 0, retryMaxMs: 0, logAttempts: false });

    assert.equal(calls, 1);
    assert.equal(result.result, 'broken');
    assert.equal(result.attempts, 1);
  });
});
