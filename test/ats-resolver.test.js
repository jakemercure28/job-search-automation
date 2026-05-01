'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyUnsupportedUrl,
  extractBuiltInApplyUrl,
  parseWorkdayUrl,
  resolveAlternateJob,
} = require('../lib/ats-resolver');
const { normalizeScrapedJobs } = require('../scripts/resolve-ats-aliases');

function jsonResponse(data, url = 'https://example.com') {
  return {
    ok: true,
    url,
    async json() { return data; },
    async text() { return JSON.stringify(data); },
  };
}

function textResponse(text, url = 'https://example.com') {
  return {
    ok: true,
    url,
    async json() { return JSON.parse(text); },
    async text() { return text; },
  };
}

describe('ats resolver', () => {
  it('extracts Built In howToApply URLs from jobPostInit payloads', () => {
    const html = `
      <script type="module">
        Builtin.jobPostInit({"job":{"id":8633203,"howToApply":"https://careers.example.com/jobs/1?iisn=BuiltIn\\u0026iis=Job"}});
      </script>
    `;

    assert.equal(
      extractBuiltInApplyUrl(html),
      'https://careers.example.com/jobs/1?iisn=BuiltIn&iis=Job'
    );
  });

  it('resolves a RemoteOK row to Greenhouse by strict company/title board search', async () => {
    const fetch = async (url) => {
      if (url.includes('remoteok.com')) {
        return textResponse('<html><title>UJET Senior Site Reliability Engineer</title></html>', url);
      }
      if (url.includes('boards-api.greenhouse.io/v1/boards/ujet/jobs?content=true')) {
        return jsonResponse({
          jobs: [{
            id: 4677625005,
            title: 'Senior Site Reliability Engineer',
            absolute_url: 'https://job-boards.greenhouse.io/ujet/jobs/4677625005',
            updated_at: '2026-04-18T00:01:00Z',
            content: '<p>Run reliable systems</p>',
            location: { name: 'Remote' },
          }],
        }, url);
      }
      return null;
    };

    const resolution = await resolveAlternateJob({
      id: 'remoteok-1131206',
      platform: 'RemoteOK',
      title: 'Senior Site Reliability Engineer',
      company: 'UJET',
      url: 'https://remoteok.com/remote-jobs/remote-senior-site-reliability-engineer-ujet-1131206',
    }, { fetch });

    assert.equal(resolution.status, 'primary');
    assert.equal(resolution.platform, 'Greenhouse');
    assert.equal(resolution.job.id, 'greenhouse-4677625005');
    assert.equal(resolution.job.url, 'https://job-boards.greenhouse.io/ujet/jobs/4677625005');
  });

  it('parses Workday URLs into CXS lookup components', () => {
    assert.deepEqual(
      parseWorkdayUrl('https://ffive.wd5.myworkdayjobs.com/f5jobs/job/Seattle/SRE-III_RP1037204'),
      {
        subdomain: 'ffive',
        host: 'ffive.wd5.myworkdayjobs.com',
        board: 'f5jobs',
        externalPath: '/job/Seattle/SRE-III_RP1037204',
      }
    );
  });

  it('classifies known non-primary ATS URLs as unsupported', () => {
    assert.equal(classifyUnsupportedUrl('https://ats.rippling.com/overland-ai/jobs/123'), 'Rippling');
    assert.equal(classifyUnsupportedUrl('https://careers-americas.icims.com/jobs/24810/job'), 'iCIMS');
    assert.equal(classifyUnsupportedUrl('https://apply.workable.com/acme/j/123'), 'Workable');
    assert.equal(classifyUnsupportedUrl('https://search-careers.gm.com/en/jobs/jr-1/example'), 'Company Careers');
    assert.equal(classifyUnsupportedUrl('https://careers.draftkings.com/jobs/jr1/example'), 'Company Careers');
  });

  it('does not treat a board-level Greenhouse URL as a canonical job', async () => {
    const resolution = await resolveAlternateJob({
      id: 'inbound-1',
      platform: 'Inbound',
      title: 'Cloud Engineer II',
      company: 'Earnest',
      url: 'https://www.earnest.com/careers',
    }, {
      fetch: async (url) => {
        if (url === 'https://www.earnest.com/careers') {
          return textResponse('<a href="https://boards.greenhouse.io/earnest">Jobs</a>', url);
        }
        return null;
      },
    });

    assert.equal(resolution.status, 'unresolved');
  });

  it('canonicalizes a non-primary job when a Gemini candidate verifies through an ATS API', async () => {
    const resolution = await resolveAlternateJob({
      id: 'workable-1',
      platform: 'Workable',
      title: 'Senior Platform Engineer',
      company: 'Example Inc',
      url: 'https://apply.workable.com/example/j/ALT',
    }, {
      gemini: async () => JSON.stringify([
        { platform: 'Greenhouse', slug: 'acme', company: 'Acme', title: 'Senior Platform Engineer', rationale: 'Same company career board' },
      ]),
      fetch: async (url) => {
        if (url.includes('boards-api.greenhouse.io/v1/boards/example')) return jsonResponse({ jobs: [] }, url);
        if (url.includes('boards-api.greenhouse.io/v1/boards/acme/jobs?content=true')) {
          return jsonResponse({
            jobs: [{
              id: 123,
              title: 'Senior Platform Engineer',
              absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/123',
              content: '<p>Build internal platforms</p>',
              location: { name: 'Remote' },
            }],
          }, url);
        }
        return null;
      },
    });

    assert.equal(resolution.status, 'primary');
    assert.equal(resolution.platform, 'Greenhouse');
    assert.equal(resolution.job.id, 'greenhouse-123');
    assert.equal(resolution.evidence.method, 'gemini-candidate-api-verified');
  });

  it('rejects a Gemini candidate when the ATS API does not verify the title', async () => {
    const resolution = await resolveAlternateJob({
      id: 'workable-2',
      platform: 'Workable',
      title: 'Senior Platform Engineer',
      company: 'Example Inc',
      url: 'https://apply.workable.com/example/j/ALT',
    }, {
      gemini: async () => JSON.stringify([
        { platform: 'Greenhouse', slug: 'acme', company: 'Acme', title: 'Senior Platform Engineer', rationale: 'Guess' },
      ]),
      fetch: async (url) => {
        if (url.includes('boards-api.greenhouse.io')) {
          return jsonResponse({
            jobs: [{
              id: 456,
              title: 'Product Designer',
              absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/456',
            }],
          }, url);
        }
        return null;
      },
    });

    assert.notEqual(resolution.status, 'primary');
  });

  it('prefers canonical primary ATS rows over alternate duplicates in scraped batches', async () => {
    const { jobs, report } = await normalizeScrapedJobs([
      {
        id: 'builtin-1',
        platform: 'Built In',
        title: 'Platform Engineer',
        company: 'Acme',
        url: 'https://careers.example.com/job/1',
        description: 'Short',
      },
      {
        id: 'greenhouse-1',
        platform: 'Greenhouse',
        title: 'Platform Engineer',
        company: 'Acme',
        url: 'https://job-boards.greenhouse.io/acme/jobs/1',
        description: 'Primary description',
      },
    ], {
      fetch: async () => null,
      gemini: async () => '[]',
    });

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'greenhouse-1');
    assert.equal(report.some((row) => row.action === 'skipped-duplicate' && row.id === 'builtin-1'), true);
  });
});
