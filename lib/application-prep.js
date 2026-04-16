'use strict';

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile: execFileCb } = require('child_process');

const { baseDir } = require('../config/paths');
const applicant = require('../config/applicant');
const { callGemini } = require('./gemini');
const { checkVoiceText } = require('./voice-check');
const { classifyComplexity } = require('./complexity');

const APPLICANT_FULL_NAME = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ') || 'the applicant';
const APPLICANT_FIRST_NAME = applicant.firstName || 'the applicant';

const execFile = promisify(execFileCb);
const repoDir = path.join(baseDir, '..', '..');

const START_DATE_OFFSET_DAYS = 14;
const STANDARD_FIELD_RE = /\b(first|last|full)\s*name\b|email|phone|resume|cover letter/i;

let _profileSources = null;

function readUtf8(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
}

function getProfileSources() {
  if (_profileSources) return _profileSources;
  _profileSources = {
    resume: readUtf8(path.join(baseDir, 'resume.md')),
    context: readUtf8(path.join(baseDir, 'context.md')),
    career: readUtf8(path.join(baseDir, 'career-detail.md')),
    voice: readUtf8(path.join(repoDir, '.context', 'people', 'voice.md')),
  };
  return _profileSources;
}

function nowIso() {
  return new Date().toISOString();
}

function soonDate(days = START_DATE_OFFSET_DAYS) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isEmailOnlyJob(job) {
  const url = String(job.url || '').trim();
  return /^mailto:/i.test(url) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url);
}

function supportedPrepPlatform(job) {
  const lowerId = String(job.id || '').toLowerCase();
  const platform = String(job.platform || '').toLowerCase();
  const url = String(job.url || '').toLowerCase();
  if (lowerId.startsWith('greenhouse-') || platform.includes('greenhouse') || url.includes('greenhouse')) return 'greenhouse';
  if (lowerId.startsWith('ashby-') || platform.includes('ashby') || url.includes('ashbyhq.com')) return 'ashby';
  if (lowerId.startsWith('lever-') || platform.includes('lever') || url.includes('lever.co')) return 'lever';
  return null;
}

function parseJsonLoose(text) {
  const trimmed = String(text || '').trim();
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

function normalizeFieldType(type = '') {
  const lower = String(type || '').toLowerCase();
  if (['textarea', 'input_text', 'short_answer', 'text', 'url', 'number', 'email', 'tel'].includes(lower)) return 'text';
  if (['multi_value_single_select', 'select', 'radio'].includes(lower)) return 'select';
  if (['multi_value_multi_select', 'checkbox'].includes(lower)) return 'multi_select';
  return lower || 'text';
}

function normalizeExtractedFields(customFields = []) {
  const normalized = [];

  for (const raw of customFields) {
    const label = String(raw.label || raw.labelText || raw.name || '').trim().replace(/\s+/g, ' ');
    const name = String(raw.name || '').trim();
    if (!label || !name) continue;

    if (STANDARD_FIELD_RE.test(`${label} ${name}`) && !/linkedin/i.test(label)) continue;

    const rawOptions = Array.isArray(raw.options) ? raw.options.map(String).map(s => s.trim()).filter(Boolean) : [];
    const type = normalizeFieldType(raw.type);

    // Raw DOM extraction from Ashby emits one line per radio/checkbox option without
    // grouping them under the actual question. Those entries are too noisy to trust.
    if ((raw.type === 'radio' || raw.type === 'checkbox') && rawOptions.length === 0) continue;

    normalized.push({
      label,
      name,
      type,
      required: Boolean(raw.required),
      options: rawOptions,
    });
  }

  const deduped = new Map();
  for (const field of normalized) {
    const key = field.name;
    if (!deduped.has(key)) {
      deduped.set(key, { ...field });
      continue;
    }
    const existing = deduped.get(key);
    existing.required = existing.required || field.required;
    if (!existing.options.length && field.options.length) existing.options = [...field.options];
  }

  return [...deduped.values()];
}

function chooseOption(options, preferredValues = []) {
  if (!Array.isArray(options) || options.length === 0) return preferredValues[0] || null;
  const lowered = options.map(option => ({ option, lower: option.toLowerCase() }));
  for (const preferred of preferredValues) {
    const target = String(preferred || '').toLowerCase();
    const exact = lowered.find(item => item.lower === target);
    if (exact) return exact.option;
    const includes = lowered.find(item => item.lower.includes(target) || target.includes(item.lower));
    if (includes) return includes.option;
  }
  return null;
}

function heuristicAnswer(field) {
  const label = field.label.toLowerCase();
  const options = field.options || [];

  if (/linkedin/.test(label)) return applicant.linkedin || null;
  if (/preferred first name/.test(label)) return applicant.firstName || null;
  if (/how did you hear/.test(label)) {
    if (field.type === 'multi_select') {
      return [chooseOption(options, ['Careers website', 'Motive Careers Page', 'Company website', 'Job board', 'LinkedIn'])].filter(Boolean);
    }
    return chooseOption(options, ['Careers website', 'Motive Careers Page', 'Company website', 'Job board', 'LinkedIn']);
  }
  if (/worked for .* before|ever worked for .* before/.test(label)) return chooseOption(options, ['No']) || 'No';
  if (/legally authorized|authorized to lawfully work|authorized to work/.test(label)) return chooseOption(options, ['Yes']) || 'Yes';
  if (/visa sponsorship|immigration sponsorship|require employment visa sponsorship|require sponsorship/.test(label)) return chooseOption(options, ['No']) || 'No';
  if (/second citizenship/.test(label)) return chooseOption(options, ['None']) || 'None';
  if (/current country of employment|country of employment|citizenship/.test(label)) {
    return chooseOption(options, ['United States']) || 'United States';
  }
  if (/privacy policy|i acknowledge|i agree/.test(label)) return chooseOption(options, ['I acknowledge', 'I agree']) || 'I agree';
  if (/time zone/.test(label)) {
    if (field.type === 'multi_select') return [chooseOption(options, ['Eastern Standard Time', 'Eastern'])].filter(Boolean);
    return chooseOption(options, ['Eastern Standard Time', 'Eastern']) || 'Eastern Standard Time';
  }
  if (/base compensation/.test(label)) return '160000';
  if (/notice period/.test(label)) return chooseOption(options, ['1-2 weeks', '2 weeks']) || '1-2 weeks';
  if (/current job level/.test(label)) return chooseOption(options, ['Senior']) || 'Senior';
  if (/preferred start date/.test(label)) return soonDate();
  if (/active clearance/.test(label)) return chooseOption(options, ['No']) || 'No';
  if (/outside employment|advisory commitments|outside work/.test(label)) return chooseOption(options, ['No']) || 'No';
  if (/heard of .* before applying/.test(label)) return chooseOption(options, ['Yes']) || 'Yes';
  if (/highest level of education/.test(label)) return chooseOption(options, ['Bachelor']) || 'Bachelor’s degree';
  if (/remote or hybrid environment/.test(label)) return chooseOption(options, ['Yes, hybrid', 'Yes']) || 'Yes, hybrid';
  if (/which environment best describes/.test(label)) return chooseOption(options, ['Leans deep, but adaptable']) || 'Leans deep, but adaptable';
  if (/most recent employer/.test(label)) return process.env.APPLICANT_CURRENT_COMPANY || null;
  if (/website/.test(label) && !field.required) return '';

  return null;
}

function splitResolvedFields(fields) {
  const resolved = {};
  const unresolved = [];

  for (const field of fields) {
    const value = heuristicAnswer(field);
    if (value === null || value === undefined) unresolved.push(field);
    else resolved[field.name] = value;
  }

  return { resolved, unresolved };
}

function buildDraftPrompt(job, fields, sources) {
  const fieldBlock = JSON.stringify(fields.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options,
  })), null, 2);

  return `You are preparing job application answers for ${APPLICANT_FULL_NAME}.

Return ONLY a valid JSON object. Keys must be the field names exactly as provided.
Values must be:
- a string for text/select fields
- an array of strings for multi-select fields

Job:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
URL: ${job.url}

Job description:
${String(job.description || '').slice(0, 5000)}

Resume:
${sources.resume}

Context:
${sources.context}

Career detail:
${sources.career.slice(0, 9000)}

Voice rules:
${sources.voice}

Questions:
${fieldBlock}

Requirements:
- For select fields, choose one of the provided options or a short prefix that would match it cleanly.
- For multi-select fields, return an array of selected option strings.
- For open text answers, write in the applicant's voice as described in Voice rules above. Specific, direct, human. No dash connectors.
- Keep answers compact. Usually 1 to 4 sentences max.
- If an optional field should be left blank, return an empty string.
- Do not add any explanation outside the JSON.
`;
}

function buildRewritePrompt(job, field, currentAnswer, voiceResult, sources) {
  const issueLines = [];
  for (const issue of voiceResult.issues) issueLines.push(`- ${issue.type}: ${issue.detail}`);
  if (voiceResult.sapling?.score != null) issueLines.push(`- sapling_score: ${(voiceResult.sapling.score * 100).toFixed(0)}% AI`);
  if (voiceResult.sapling?.error) issueLines.push(`- sapling_error: ${voiceResult.sapling.error}`);

  return `Rewrite this application answer so it reads like ${APPLICANT_FULL_NAME} and passes the voice check.

Job:
Title: ${job.title}
Company: ${job.company}

Question:
${field.label}

Current answer:
${currentAnswer}

Problems to fix:
${issueLines.join('\n') || '- too polished'}

Voice rules:
${sources.voice}

Additional requirements:
- No dash connectors.
- Use uneven sentence length.
- Include at least one fragment or aside if it helps lower the polish.
- Keep it concise and specific.
- Return the rewritten answer only. No quotes, no bullets, no JSON.
`;
}

async function draftAnswersWithGemini(job, unresolvedFields) {
  if (!unresolvedFields.length) return {};
  const sources = getProfileSources();
  const prompt = buildDraftPrompt(job, unresolvedFields, sources);
  return parseJsonLoose(await callGemini(prompt, 3, 1800));
}

async function voicePolish(job, field, answer) {
  const sources = getProfileSources();
  let current = String(answer || '').trim();
  let voiceResult = await checkVoiceText(current);

  for (let attempt = 0; attempt < 3 && !voiceResult.passed; attempt += 1) {
    current = (await callGemini(buildRewritePrompt(job, field, current, voiceResult, sources), 2, 220)).trim();
    voiceResult = await checkVoiceText(current);
  }

  return {
    answer: current,
    voiceResult,
  };
}

async function validateAnswers(job, fields, draftedAnswers) {
  const answers = { ...draftedAnswers };
  const voiceChecks = {};

  for (const field of fields) {
    const value = answers[field.name];
    if (value == null || value === '') continue;
    if (field.type !== 'text') continue;
    const result = await voicePolish(job, field, value);
    answers[field.name] = result.answer;
    voiceChecks[field.name] = {
      passed: result.voiceResult.passed,
      issues: result.voiceResult.issues,
      sapling: result.voiceResult.sapling,
    };
  }

  return { answers, voiceChecks };
}

async function runApplyExtract(jobId) {
  const scriptPath = path.join(repoDir, 'scripts', 'apply-extract.js');
  const { stdout } = await execFile(process.execPath, [scriptPath, jobId], {
    cwd: repoDir,
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
  });
  return parseJsonLoose(stdout);
}

function buildPrepSummary(job, prep) {
  if (prep.workflow === 'simple-auto') return 'No custom questions detected. Keep this on the fast path.';
  if (prep.status === 'unsupported') return prep.error || prep.page_issue || 'This form needs manual review.';
  if (prep.workflow === 'email') return 'Email-style application. Use the saved draft and attached resume.';
  const questionCount = Array.isArray(prep.questions) ? prep.questions.length : 0;
  return `${questionCount} custom field${questionCount === 1 ? '' : 's'} prepared. Use the job-specific bookmarklet first, then fall back to copy/paste if the site is weird.`;
}

function parsePrepRow(row) {
  if (!row) return null;
  return {
    ...row,
    questions: row.questions_json ? JSON.parse(row.questions_json) : [],
    answers: row.answers_json ? JSON.parse(row.answers_json) : {},
    voiceChecks: row.voice_checks_json ? JSON.parse(row.voice_checks_json) : {},
  };
}

function getApplicationPrep(db, jobId) {
  return parsePrepRow(db.prepare('SELECT * FROM application_preps WHERE job_id = ?').get(jobId));
}

function saveApplicationPrep(db, jobId, prep) {
  const payload = {
    job_id: jobId,
    status: prep.status || 'ready',
    workflow: prep.workflow || 'autofill',
    apply_url: prep.apply_url || null,
    page_issue: prep.page_issue || null,
    questions_json: JSON.stringify(prep.questions || []),
    answers_json: JSON.stringify(prep.answers || {}),
    voice_checks_json: JSON.stringify(prep.voiceChecks || {}),
    summary: prep.summary || '',
    error: prep.error || null,
    generated_at: prep.generated_at || nowIso(),
  };

  db.prepare(`
    INSERT INTO application_preps (
      job_id, status, workflow, apply_url, page_issue,
      questions_json, answers_json, voice_checks_json,
      summary, error, generated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      workflow = excluded.workflow,
      apply_url = excluded.apply_url,
      page_issue = excluded.page_issue,
      questions_json = excluded.questions_json,
      answers_json = excluded.answers_json,
      voice_checks_json = excluded.voice_checks_json,
      summary = excluded.summary,
      error = excluded.error,
      generated_at = excluded.generated_at,
      updated_at = datetime('now')
  `).run(
    payload.job_id,
    payload.status,
    payload.workflow,
    payload.apply_url,
    payload.page_issue,
    payload.questions_json,
    payload.answers_json,
    payload.voice_checks_json,
    payload.summary,
    payload.error,
    payload.generated_at
  );

  return getApplicationPrep(db, jobId);
}

async function prepareApplication(db, job, { force = false } = {}) {
  if (!force) {
    const existing = getApplicationPrep(db, job.id);
    if (existing?.status === 'ready' || existing?.status === 'unsupported') return existing;
  }

  if (!job.apply_complexity) {
    await classifyComplexity([job], db);
    job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id);
  }

  if (isEmailOnlyJob(job)) {
    return saveApplicationPrep(db, job.id, {
      status: 'ready',
      workflow: 'email',
      apply_url: job.url,
      questions: [],
      answers: {},
      voiceChecks: {},
      summary: 'Email-style application. Manual send, not ATS autofill.',
      error: null,
      generated_at: nowIso(),
    });
  }

  const detectedPlatform = supportedPrepPlatform(job);
  if (job.apply_complexity === 'simple' && detectedPlatform) {
    return saveApplicationPrep(db, job.id, {
      status: 'ready',
      workflow: 'simple-auto',
      apply_url: job.url,
      questions: [],
      answers: {},
      voiceChecks: {},
      summary: 'No custom questions detected. Keep this on the fast path.',
      error: null,
      generated_at: nowIso(),
    });
  }

  if (!detectedPlatform) {
    return saveApplicationPrep(db, job.id, {
      status: 'unsupported',
      workflow: 'manual',
      apply_url: job.url,
      questions: [],
      answers: {},
      voiceChecks: {},
      summary: 'Unsupported platform. Manual copy/paste only.',
      error: 'Unsupported platform for prep automation',
      generated_at: nowIso(),
    });
  }

  let extractResult;
  try {
    extractResult = await runApplyExtract(job.id);
  } catch (e) {
    return saveApplicationPrep(db, job.id, {
      status: 'unsupported',
      workflow: 'manual',
      apply_url: job.url,
      questions: [],
      answers: {},
      voiceChecks: {},
      summary: 'Extraction failed. Manual review required.',
      error: e.message,
      generated_at: nowIso(),
    });
  }

  const questions = normalizeExtractedFields(extractResult.customFields || []);

  if (extractResult.pageIssue) {
    return saveApplicationPrep(db, job.id, {
      status: 'unsupported',
      workflow: 'manual',
      apply_url: extractResult.applyUrl || job.url,
      page_issue: extractResult.pageIssue,
      questions,
      answers: {},
      voiceChecks: {},
      summary: extractResult.pageIssue,
      error: extractResult.pageIssue,
      generated_at: nowIso(),
    });
  }

  if (questions.length === 0) {
    return saveApplicationPrep(db, job.id, {
      status: 'ready',
      workflow: 'simple-auto',
      apply_url: extractResult.applyUrl || job.url,
      questions: [],
      answers: {},
      voiceChecks: {},
      summary: 'No custom questions detected. Keep this on the fast path.',
      error: null,
      generated_at: nowIso(),
    });
  }

  const { resolved, unresolved } = splitResolvedFields(questions);
  const drafted = unresolved.length ? await draftAnswersWithGemini(job, unresolved) : {};
  const { answers, voiceChecks } = await validateAnswers(job, questions, { ...resolved, ...drafted });

  return saveApplicationPrep(db, job.id, {
    status: 'ready',
    workflow: 'autofill',
    apply_url: extractResult.applyUrl || job.url,
    page_issue: null,
    questions,
    answers,
    voiceChecks,
    summary: buildPrepSummary(job, { status: 'ready', workflow: 'autofill', questions }),
    error: null,
    generated_at: nowIso(),
  });
}

module.exports = {
  getApplicationPrep,
  normalizeExtractedFields,
  prepareApplication,
  saveApplicationPrep,
  supportedPrepPlatform,
};
