'use strict';

const fs = require('fs');
const path = require('path');

const { baseDir } = require('../config/paths');

function overrideDir() {
  return path.join(baseDir, 'auto-apply-overrides');
}

function overridePathForJob(jobId) {
  return path.join(overrideDir(), `${jobId}.json`);
}

function readApplicationOverridePayload(jobId) {
  const filePath = overridePathForJob(jobId);
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      jobId,
      company: null,
      title: null,
      applyUrl: null,
      answers: {},
      questions: [],
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      path: filePath,
      jobId: parsed?.jobId || jobId,
      company: parsed?.company || null,
      title: parsed?.title || null,
      applyUrl: parsed?.applyUrl || null,
      answers: parsed && typeof parsed.answers === 'object' && parsed.answers ? parsed.answers : {},
      questions: Array.isArray(parsed?.questions) ? parsed.questions : [],
    };
  } catch (_) {
    return {
      path: filePath,
      jobId,
      company: null,
      title: null,
      applyUrl: null,
      answers: {},
      questions: [],
    };
  }
}

function readApplicationOverrides(jobId) {
  const payload = readApplicationOverridePayload(jobId);
  return {
    path: payload.path,
    answers: payload.answers,
    questions: payload.questions,
  };
}

function mergeQuestions(currentQuestions = [], nextQuestions = []) {
  const merged = new Map();

  for (const question of [...currentQuestions, ...nextQuestions]) {
    if (!question?.name) continue;
    merged.set(question.name, {
      label: question.label,
      name: question.name,
      type: question.type,
      required: Boolean(question.required),
      options: Array.isArray(question.options) ? question.options : [],
    });
  }

  return [...merged.values()];
}

function writeApplicationOverrides(job, applyUrl, answers = {}, questions = []) {
  const dir = overrideDir();
  fs.mkdirSync(dir, { recursive: true });

  const current = readApplicationOverridePayload(job.id);

  const payload = {
    jobId: job.id,
    company: job.company || current.company,
    title: job.title || current.title,
    applyUrl: applyUrl || current.applyUrl || job.url || null,
    answers,
    questions: mergeQuestions(current.questions, questions),
  };

  fs.writeFileSync(current.path, `${JSON.stringify(payload, null, 2)}\n`);
  return current.path;
}

function upsertApplicationOverrides(job, applyUrl, updates = {}, questions = []) {
  const current = readApplicationOverridePayload(job.id);
  return writeApplicationOverrides(job, applyUrl, {
    ...current.answers,
    ...updates,
  }, questions);
}

function ensureApplicationOverrideTemplate(job, applyUrl, unresolvedQuestions = []) {
  const current = readApplicationOverridePayload(job.id);
  const nextAnswers = { ...current.answers };
  for (const question of unresolvedQuestions) {
    if (!Object.prototype.hasOwnProperty.call(nextAnswers, question.name)) {
      nextAnswers[question.name] = null;
    }
  }

  return writeApplicationOverrides(job, applyUrl, nextAnswers, unresolvedQuestions);
}

module.exports = {
  ensureApplicationOverrideTemplate,
  overridePathForJob,
  readApplicationOverrides,
  upsertApplicationOverrides,
  writeApplicationOverrides,
};
