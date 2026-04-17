'use strict';

const path = require('path');
const { baseDir } = require('../../config/paths');

const AI_TITLE_KW = /\b(ai|ml|mlops|machine learning|llm|nlp|voice|speech|data science)\b/i;
const AI_DESC_KW  = /ai[\-\s]first|ai mindset|machine learning|mlops|large language model|\bllm\b|generative ai|ai\/ml|neural|deep learning|voice ai|speech.{0,20}(model|ai)|ai platform/i;

function pickResume(job) {
  const isAi = AI_TITLE_KW.test(job.title || '') || AI_DESC_KW.test((job.description || '').slice(0, 1500));
  return path.join(baseDir, isAi ? 'resume-ai.pdf' : 'resume.pdf');
}

module.exports = {
  AI_TITLE_KW,
  AI_DESC_KW,
  pickResume,
};
