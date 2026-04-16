'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { detectAts } = require('../lib/atsDetector');
const {
  classifyGreenhouse,
  detectJobPlatform,
  extractBuiltInApplyUrl,
  isSimpleGreenhouseQuestion,
  parseGreenhouseJob,
} = require('../lib/complexity');

describe('ATS detection', () => {
  it('detects built-in jobs that link directly to supported ATSes', () => {
    assert.deepEqual(
      detectAts('https://job-boards.greenhouse.io/halcyon/jobs/5842441004'),
      { platform: 'Greenhouse', company: 'halcyon' }
    );

    assert.deepEqual(
      detectAts('https://jobs.ashbyhq.com/Solvd/00fdc6ea-b992-4772-b999-d4dca8efbdc1/application'),
      { platform: 'Ashby', company: 'Solvd' }
    );

    assert.deepEqual(
      detectAts('https://gsk.wd5.myworkdayjobs.com/GSKCareers/job/Seattle-Sixth-Ave/Senior-AI-ML-Platform-Engineer_431250'),
      { platform: 'Workday', company: 'gsk' }
    );
  });

  it('detects custom-domain greenhouse links by gh_jid', () => {
    assert.deepEqual(
      detectAts('https://example.applytojob.com/apply/foo?gh_jid=123456'),
      { platform: 'Greenhouse', company: null }
    );
  });
});

describe('complexity helpers', () => {
  it('maps built-in ATS links onto their real platform', () => {
    assert.equal(
      detectJobPlatform({
        id: 'builtin-123',
        platform: 'Built In',
        url: 'https://jobs.ashbyhq.com/Solvd/00fdc6ea-b992-4772-b999-d4dca8efbdc1/application',
      }),
      'ashby'
    );

    assert.equal(
      detectJobPlatform({
        id: 'builtin-456',
        platform: 'Built In',
        url: 'https://job-boards.greenhouse.io/halcyon/jobs/5842441004',
      }),
      'greenhouse'
    );
  });

  it('treats common greenhouse dropdowns as simple', () => {
    assert.equal(
      isSimpleGreenhouseQuestion({
        label: 'Will you now or in the future require visa sponsorship to work in the United States?',
        required: true,
        fields: [
          {
            name: 'question_15745397004',
            type: 'multi_value_single_select',
          },
        ],
      }),
      true
    );

    assert.equal(
      isSimpleGreenhouseQuestion({
        label: 'LinkedIn Profile',
        required: false,
        fields: [
          {
            name: 'question_15745395004',
            type: 'input_text',
          },
        ],
      }),
      true
    );

    assert.equal(
      isSimpleGreenhouseQuestion({
        label: 'EXPORT CONTROLS - This position requires access to information and technology that is subject to U.S. export controls.',
        required: true,
        fields: [
          {
            name: 'question_export_controls',
            type: 'multi_value_single_select',
          },
        ],
      }),
      true
    );

    assert.equal(
      isSimpleGreenhouseQuestion({
        label: 'CLEARANCE ELIGIBILITY - This position requires eligibility to obtain and maintain a U.S. security clearance.',
        required: true,
        fields: [
          {
            name: 'question_clearance',
            type: 'multi_value_single_select',
          },
        ],
      }),
      true
    );

    assert.equal(
      isSimpleGreenhouseQuestion({
        label: 'How did you hear about Anduril?',
        required: true,
        fields: [
          {
            name: 'question_source',
            type: 'multi_value_single_select',
          },
        ],
      }),
      true
    );
  });

  it('keeps essay-style greenhouse questions complex', () => {
    assert.equal(
      isSimpleGreenhouseQuestion({
        label: 'Why do you want to work here?',
        required: true,
        fields: [
          {
            name: 'question_essay',
            type: 'textarea',
          },
        ],
      }),
      false
    );
  });

  it('parses standard greenhouse URLs and gh_jid custom domains', () => {
    assert.deepEqual(
      parseGreenhouseJob({
        id: 'builtin-1',
        company: 'Halcyon',
        url: 'https://job-boards.greenhouse.io/halcyon/jobs/5842441004',
      }),
      { boardToken: 'halcyon', jobId: '5842441004' }
    );

    assert.deepEqual(
      parseGreenhouseJob({
        id: 'builtin-2',
        company: 'Curative AI, Inc.',
        url: 'https://curativeai.applytojob.com/apply/foo?gh_jid=999888777',
      }),
      { boardToken: 'curativeaiinc', jobId: '999888777' }
    );
  });

  it('extracts supported ATS apply links from Built In job pages', () => {
    const html = `
      <div x-data="applyForm">
        <a href="https://boards.greenhouse.io/andurilindustries/jobs/5057941007?gh_jid=5057941007&amp;gh_src=d29cd2417us" target="_blank" @click="applyClick">Apply</a>
      </div>
    `;

    assert.equal(
      extractBuiltInApplyUrl(html),
      'https://boards.greenhouse.io/andurilindustries/jobs/5057941007?gh_jid=5057941007&gh_src=d29cd2417us'
    );
  });

  it('ignores optional custom greenhouse follow-up fields during classification', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          questions: [
            {
              label: 'How did you hear about Anduril?',
              required: true,
              fields: [{ name: 'question_source', type: 'multi_value_single_select' }],
            },
            {
              label: 'If other, please specify',
              required: false,
              fields: [{ name: 'question_other', type: 'input_text' }],
            },
          ],
        };
      },
    });

    try {
      const result = await classifyGreenhouse({
        id: 'greenhouse-5057941007',
        company: 'Anduril',
        url: 'https://boards.greenhouse.io/andurilindustries/jobs/5057941007?gh_jid=5057941007',
      });
      assert.equal(result, 'simple');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
