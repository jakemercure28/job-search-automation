/**
 * scorer.js
 * Uses the Gemini API to score a job listing 1–10 against resume.md and context.md.
 *
 * Requires:  GEMINI_API_KEY environment variable
 *
 * Usage (standalone — scores jobs from stdin JSON array):
 *   echo '[{"title":"...","company":"...","description":"..."}]' | node scorer.js
 *
 * Usage (module):
 *   const { scoreJob } = require('./scorer');
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { MAX_DESCRIPTION_LENGTH, MAX_TRANSCRIPT_LENGTH } = require('./config/constants');
const createLogger = require('./lib/logger');
const { baseDir } = require('./config/paths');
const { callGemini } = require('./lib/gemini');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(filename) {
  const filePath = path.join(baseDir, filename);
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    throw new Error(`Cannot read ${filename}: ${err.message}. Make sure it exists at ${filePath}`);
  }
}

let _resume = null, _context = null;

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a single job listing against the user's resume and context.
 *
 * @param {object} job - { title, company, url, platform, description, location, postedAt }
 * @returns {Promise<{ score: number, reasoning: string }>}
 */
async function scoreJob(job) {
  if (!_resume) _resume = readFile('resume.md');
  if (!_context) _context = readFile('context.md');
  const resume = _resume;
  const context = _context;
  const prompt = `You are evaluating how well a job listing matches a candidate.

## Candidate Resume
${resume}

## Candidate Context (goals, preferences, dealbreakers)
${context}

## Job Listing
**Title:** ${job.title}
**Company:** ${job.company}
**Location:** ${job.location || 'Not specified'}

**Description:**
${job.description || 'No description available.'}

---

Score this job 1–10 based on how well it matches the candidate. Use the resume and context to make your own judgment — consider tech stack fit, seniority, role type, company fit, and anything in the candidate's stated preferences or dealbreakers.

Respond in EXACTLY this format (no other text):
SCORE: <integer 1-10>
REASONING: <2-4 sentences explaining the score>`;

  const text = await callGemini(prompt);

  const scoreMatch = text.match(/^SCORE:\s*(\d+)/m);
  const reasoningMatch = text.match(/^REASONING:\s*(.+)/ms);

  const score = scoreMatch ? Math.min(10, Math.max(1, parseInt(scoreMatch[1], 10))) : null;
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : (scoreMatch ? text : `Score parse failed. Raw: ${text.slice(0, 200)}`);

  return { score, reasoning };
}

// ---------------------------------------------------------------------------
// Rejection Transcript Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze an interview transcript to identify why the candidate was rejected.
 *
 * @param {object} job - { title, company, description, rejected_from_stage }
 * @param {string} transcript - The interview transcript text
 * @returns {Promise<string>} - Markdown analysis
 */
async function analyzeRejection(job, transcript) {
  if (!_resume) _resume = readFile('resume.md');
  if (!_context) _context = readFile('context.md');

  const trimmedTranscript = transcript.length > MAX_TRANSCRIPT_LENGTH
    ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH) + '\n\n[Transcript truncated]'
    : transcript;

  const prompt = `You are analyzing why a job candidate was rejected, based on their interview transcript.
Your goal is to identify concrete, actionable feedback from the evidence available.

## Candidate Resume
${_resume}

## Candidate Context
${_context}

## Job Details
Title: ${job.title}
Company: ${job.company}
Stage reached: ${job.rejected_from_stage || 'unknown'}
Description: ${(job.description || '').slice(0, MAX_DESCRIPTION_LENGTH)}

## Interview Transcript
${trimmedTranscript}

---

Analyze this rejection. Focus on:
1. CONCRETE moments in the transcript where the candidate struggled, gave weak answers, or missed opportunities
2. Technical gaps that surfaced during the conversation
3. Communication or behavioral signals that may have contributed
4. What the interviewer seemed to be probing for vs what the candidate delivered

Be specific. Quote or reference actual exchanges from the transcript.
Do NOT speculate about internal hiring decisions you cannot see.
Do NOT sugarcoat. The candidate wants honest, useful feedback.

Format as markdown with sections:
## Key Moments
## Technical Gaps
## Communication Notes
## What To Do Differently`;

  return await callGemini(prompt, 3, 1500);
}

// ---------------------------------------------------------------------------
// Rejection Likelihood Analysis
// ---------------------------------------------------------------------------

async function scoreRejectionLikelihood(job) {
  if (!_resume) _resume = readFile('resume.md');
  if (!_context) _context = readFile('context.md');

  const prompt = `You are a hiring manager reviewing a job application. Given the job listing and candidate profile below, identify the most likely reasons this application would be rejected.

## Candidate Resume
${_resume}

## Candidate Context
${_context}

## Job Listing
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'Not specified'}
Description: ${(job.description || '').slice(0, MAX_DESCRIPTION_LENGTH)}

---

Identify the top 2-4 most likely reasons a recruiter or hiring manager would pass on this candidate for this specific role. Be concrete — reference actual gaps between the job requirements and the candidate's profile. Do not give generic advice.

Respond in 2-4 plain sentences. No bullet points, no headers.`;

  return await callGemini(prompt, 2, 400);
}

// ---------------------------------------------------------------------------
// Standalone: score a batch from stdin
// ---------------------------------------------------------------------------

if (require.main === module) {
  const logPaths = require('./lib/log-paths');
  const log = createLogger('scorer', { logFile: logPaths.daily('scorer') });

  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', async () => {
    let jobs;
    try {
      jobs = JSON.parse(raw);
    } catch (err) {
      log.error('Could not parse stdin JSON', { error: err.message });
      process.exit(1);
    }

    if (!Array.isArray(jobs)) {
      log.error('Expected a JSON array of jobs on stdin');
      process.exit(1);
    }

    const results = [];
    for (const job of jobs) {
      try {
        const { score, reasoning } = await scoreJob(job);
        results.push({ ...job, score, reasoning });
        log.info('Scored', { company: job.company, title: job.title, score });
      } catch (err) {
        log.error('Score failed', { title: job.title, error: err.message });
        results.push({ ...job, score: null, reasoning: `Error: ${err.message}` });
      }
    }

    process.stdout.write(JSON.stringify(results, null, 2));
  });
}

module.exports = { scoreJob, analyzeRejection, scoreRejectionLikelihood, callGemini };
