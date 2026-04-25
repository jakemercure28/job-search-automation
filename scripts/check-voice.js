#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { checkVoiceText, renderScore } = require('../lib/voice-check');

function loadEnv() {
  const envFiles = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'profiles', 'example', '.env'),
  ];
  for (const f of envFiles) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

async function main() {
  loadEnv();

  let text = process.argv[2];
  if (!text) text = fs.readFileSync('/dev/stdin', 'utf8').trim();
  if (!text) {
    console.error('Usage: node scripts/check-voice.js "text to check"');
    process.exit(1);
  }

  const result = await checkVoiceText(text);

  console.log('\nVoice check\n' + '='.repeat(50));
  if (result.issues.length === 0) {
    console.log('Local:   no violations found');
  } else {
    console.log(`Local:   ${result.issues.length} issue(s) found`);
    for (const issue of result.issues) {
      const label = {
        kill_word: 'Kill-list word',
        dash: 'Dash connector',
        banned_opener: 'Banned opener',
        low_burstiness: 'Low burstiness',
      }[issue.type] || issue.type;
      console.log(`  [${label}] ${issue.detail}`);
    }
  }

  if (!result.sapling) {
    console.log('Sapling: no API key set (add SAPLING_API_KEY to .env)');
  } else if (result.sapling.error) {
    console.log(`Sapling: error — ${result.sapling.error}`);
  } else {
    console.log(`Sapling: ${renderScore(result.sapling.score)}`);
    const flagged = (result.sapling.sentence_scores || [])
      .filter(s => s.score > 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (flagged.length > 0) {
      console.log('\nFlagged sentences:');
      for (const { sentence, score } of flagged) {
        console.log(`  ${(score * 100).toFixed(0)}%  "${sentence.slice(0, 80)}${sentence.length > 80 ? '...' : ''}"`);
      }
    } else if (result.sapling.score >= 0.5) {
      console.log('  (sentence-level model found no specific culprit — overall token statistics are flagging the text as too fluent/structured. Add more roughness: fragments, asides, informal phrasing.)');
    }
  }

  if (!result.huggingface) {
    console.log('HuggingFace: no API key set (add HUGGINGFACE_API_KEY to .env)');
  } else if (result.huggingface.error) {
    console.log(`HuggingFace: error — ${result.huggingface.error}`);
  } else {
    console.log(`HuggingFace: ${renderScore(result.huggingface.score)}`);
  }

  console.log('');
  if (!result.passed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
