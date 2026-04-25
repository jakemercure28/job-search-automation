'use strict';

const KILL_LIST = [
  'delve', 'dive into', 'seamless', 'robust', 'tapestry', 'testament',
  'synergy', 'elevate', 'multifaceted', 'pivotal', 'realm', 'cutting-edge',
  'spearheaded', 'furthermore', 'moreover', 'additionally', 'cutting edge',
  'not only', 'it\'s important to note', 'in today\'s', 'proven track record',
  'i\'m drawn to', 'i am drawn to', 'i appreciate the opportunity',
  'passionate about', 'excited to', 'strong passion', 'deeply passionate',
];

const BANNED_OPENERS = [
  /^my background is/i,
  /^i('ve| have) spent (my career|the last|years)/i,
  /^i have (extensive|significant|deep|strong) experience/i,
  /^throughout my career/i,
  /^i('m| am) (also )?(drawn to|excited by|passionate about|enthusiastic about)/i,
  /^i find (this|that|it)/i,
  /^as (a|an) (senior|experienced|seasoned)/i,
  /^in my experience/i,
  /^i have a proven/i,
  /^with (my|over|more than) \d/i,
];

const DASH_PATTERN = /\s[—–-]{1,2}\s/g;

function localCheck(text) {
  const issues = [];
  const lower = String(text || '').toLowerCase();

  for (const word of KILL_LIST) {
    if (lower.includes(word)) {
      issues.push({ type: 'kill_word', detail: `"${word}"` });
    }
  }

  const dashMatches = text.match(DASH_PATTERN);
  if (dashMatches) {
    issues.push({ type: 'dash', detail: `${dashMatches.length} dash connector(s) found` });
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    for (const pattern of BANNED_OPENERS) {
      if (pattern.test(trimmed)) {
        issues.push({ type: 'banned_opener', detail: `"${trimmed.slice(0, 60)}..."` });
        break;
      }
    }
  }

  const lengths = sentences.map(s => s.trim().split(/\s+/).length).filter(n => n > 2);
  if (lengths.length >= 3) {
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lengths.length;
    const stddev = Math.sqrt(variance);
    if (stddev < 4) {
      issues.push({ type: 'low_burstiness', detail: `sentence length std dev is ${stddev.toFixed(1)} (want > 4, higher = more varied)` });
    }
  }

  return issues;
}

async function saplingCheck(text, apiKey = process.env.SAPLING_API_KEY) {
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.sapling.ai/api/v1/aidetect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: apiKey, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { error: `Sapling API error ${res.status}: ${body.slice(0, 100)}` };
    }

    const data = await res.json();
    return {
      score: data.score,
      sentence_scores: data.sentence_scores || [],
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function huggingFaceCheck(text, apiKey = process.env.HUGGINGFACE_API_KEY) {
  if (!apiKey) return null;

  try {
    const res = await fetch(
      'https://router.huggingface.co/hf-inference/models/openai-community/roberta-base-openai-detector',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      return { error: `HuggingFace API error ${res.status}: ${body.slice(0, 100)}` };
    }

    const data = await res.json();
    // Response is double-nested: [[{label, score}, ...]]
    const entries = Array.isArray(data[0]) ? data[0] : data;
    const aiEntry = entries.find(d => d.label === 'Fake') ?? entries.find(d => d.label === 'ChatGPT');
    if (!aiEntry) return { error: 'Unexpected response format from HuggingFace' };

    return { score: aiEntry.score };
  } catch (e) {
    return { error: e.message };
  }
}

function renderScore(score) {
  if (score < 0.02) return `${(score * 100).toFixed(1)}% AI  (looks human)`;
  if (score < 0.3) return `${(score * 100).toFixed(0)}% AI  (borderline)`;
  return `${(score * 100).toFixed(0)}% AI  (flagging — rewrite)`;
}

const SAPLING_THRESHOLD = 0.02;
const HF_THRESHOLD = 0.3;

async function checkVoiceText(text, apiKey = process.env.SAPLING_API_KEY) {
  const issues = localCheck(text);
  const [sapling, huggingface] = await Promise.all([
    saplingCheck(text, apiKey),
    huggingFaceCheck(text),
  ]);

  const localFailed = issues.some(i => i.type !== 'low_burstiness');
  const saplingFailed = Boolean(sapling && !sapling.error && sapling.score >= SAPLING_THRESHOLD);
  const hfFailed = Boolean(huggingface && !huggingface.error && huggingface.score >= HF_THRESHOLD);

  return {
    text,
    issues,
    sapling,
    huggingface,
    passed: !localFailed && !saplingFailed && !hfFailed,
  };
}

module.exports = {
  BANNED_OPENERS,
  DASH_PATTERN,
  KILL_LIST,
  checkVoiceText,
  huggingFaceCheck,
  localCheck,
  renderScore,
  saplingCheck,
};
