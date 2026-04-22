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

function readApplicationOverrides(jobId) {
  const filePath = overridePathForJob(jobId);
  if (!fs.existsSync(filePath)) {
    return { path: filePath, answers: {}, questions: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      path: filePath,
      answers: parsed && typeof parsed.answers === 'object' && parsed.answers ? parsed.answers : {},
      questions: Array.isArray(parsed?.questions) ? parsed.questions : [],
    };
  } catch (_) {
    return { path: filePath, answers: {}, questions: [] };
  }
}

function ensureApplicationOverrideTemplate(job, applyUrl, unresolvedQuestions = []) {
  const dir = overrideDir();
  fs.mkdirSync(dir, { recursive: true });

  const current = readApplicationOverrides(job.id);
  const nextAnswers = { ...current.answers };
  for (const question of unresolvedQuestions) {
    if (!Object.prototype.hasOwnProperty.call(nextAnswers, question.name)) {
      nextAnswers[question.name] = '';
    }
  }

  const payload = {
    jobId: job.id,
    company: job.company,
    title: job.title,
    applyUrl: applyUrl || job.url || null,
    answers: nextAnswers,
    questions: unresolvedQuestions.map((question) => ({
      label: question.label,
      name: question.name,
      type: question.type,
      required: Boolean(question.required),
      options: Array.isArray(question.options) ? question.options : [],
    })),
  };

  fs.writeFileSync(current.path, `${JSON.stringify(payload, null, 2)}\n`);
  return current.path;
}

module.exports = {
  ensureApplicationOverrideTemplate,
  overridePathForJob,
  readApplicationOverrides,
};
