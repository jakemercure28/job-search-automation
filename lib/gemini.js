'use strict';

const log = require('./logger')('gemini');
const {
  GEMINI_RATE_DELAY_MS,
  GEMINI_RETRY_BASE_DELAY_MS,
  GEMINI_429_DELAY_MS,
  GEMINI_MAX_RETRIES,
  GEMINI_MAX_OUTPUT_TOKENS,
} = require('../config/constants');

const MODEL = 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

let lastCallAt = 0;

function trackApiCall() {
  try {
    const { getDb } = require('./db');
    const db = getDb();
    const today = new Date().toLocaleDateString('en-CA');
    db.prepare(`
      INSERT INTO api_usage (date, model, call_count) VALUES (?, ?, 1)
      ON CONFLICT(date, model) DO UPDATE SET call_count = call_count + 1
    `).run(today, MODEL);
  } catch (e) {
    // silently fail — tracking must never break scoring
  }
}

async function callGemini(prompt, retries = GEMINI_MAX_RETRIES, maxTokens = GEMINI_MAX_OUTPUT_TOKENS) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set.');

  const attempt = GEMINI_MAX_RETRIES - retries;

  const wait = GEMINI_RATE_DELAY_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt = Date.now();

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      const delay = res.status === 429
        ? GEMINI_429_DELAY_MS
        : GEMINI_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn('Rate limited, retrying', { status: res.status, delaySec: delay/1000, retriesLeft: retries });
      await new Promise(r => setTimeout(r, delay));
      return callGemini(prompt, retries - 1, maxTokens);
    }
    throw new Error(data.error?.message || `Gemini error ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  trackApiCall();
  return text;
}

module.exports = { callGemini, MODEL };
