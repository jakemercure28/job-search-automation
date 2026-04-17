'use strict';

// Gemini API rate limiting — stay under 15 RPM free tier (~12/min at 5s gaps)
const GEMINI_RATE_DELAY_MS = 5000;
const GEMINI_RETRY_BASE_DELAY_MS = 5000;
const GEMINI_429_DELAY_MS = 30000;
const GEMINI_MAX_RETRIES = 5;
const GEMINI_MAX_OUTPUT_TOKENS = 600;

// HTTP fetch defaults
const FETCH_TIMEOUT_MS = 12_000;

// Scraper politeness delays (ms between requests to same host)
const SCRAPER_DELAY_MS = 300;
const SCRAPER_DELAY_SLOW_MS = 400; // Workable needs more time
const SCRAPER_DELAY_RSS_MS = 500;

// Content limits
const MAX_DESCRIPTION_LENGTH = 15000;
const MAX_TRANSCRIPT_LENGTH = 15000;

// Dashboard
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT, 10) || 3131;
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'localhost';
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || `http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`;

// Score thresholds (used across UI rendering + filters)
const SCORE_STRONG = 8;
const SCORE_GOOD = 7;
const SCORE_MID = 6;
const SCORE_BORDERLINE = 5;

// Gemini free tier daily request limit
const GEMINI_DAILY_LIMIT = 500;

const DAILY_TARGET = 5;
const AI_TITLE_KW = /\b(ai|ml|mlops|machine learning|llm|nlp|voice|speech|data science)\b/i;
const AI_DESC_KW = /ai[\-\s]first|ai mindset|machine learning|mlops|large language model|\bllm\b|generative ai|ai\/ml|neural|deep learning|voice ai|speech.{0,20}(model|ai)|ai platform|ai.{0,10}(company|product|startup)|ai use|ai tools/i;

module.exports = {
  GEMINI_RATE_DELAY_MS,
  GEMINI_RETRY_BASE_DELAY_MS,
  GEMINI_429_DELAY_MS,
  GEMINI_MAX_RETRIES,
  GEMINI_MAX_OUTPUT_TOKENS,
  FETCH_TIMEOUT_MS,
  SCRAPER_DELAY_MS,
  SCRAPER_DELAY_SLOW_MS,
  SCRAPER_DELAY_RSS_MS,
  MAX_DESCRIPTION_LENGTH,
  MAX_TRANSCRIPT_LENGTH,
  DASHBOARD_PORT,
  DASHBOARD_HOST,
  DASHBOARD_BASE_URL,
  SCORE_STRONG,
  SCORE_GOOD,
  SCORE_MID,
  SCORE_BORDERLINE,
  GEMINI_DAILY_LIMIT,
  DAILY_TARGET,
  AI_TITLE_KW,
  AI_DESC_KW,
};
