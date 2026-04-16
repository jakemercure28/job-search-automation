'use strict';

/**
 * Run JD market research analysis for a profile.
 * Reads jobs from DB, calls Gemini, writes market-research-cache.json.
 * Skips if cache is less than 48 hours old.
 *
 * Uses JOB_PROFILE_DIR and JOB_DB_PATH env vars (same as other pipeline scripts).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { callGemini } = require('./lib/gemini');

const PROFILE_DIR = process.env.JOB_PROFILE_DIR || path.join(__dirname, 'profiles', 'example');
const DB_PATH = process.env.JOB_DB_PATH || path.join(PROFILE_DIR, 'jobs.db');
const CACHE_PATH = path.join(PROFILE_DIR, 'market-research-cache.json');
const RESUME_PATH = path.join(PROFILE_DIR, 'resume-ai.md');
const CACHE_TTL_MS = 48 * 60 * 60 * 1000;

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    }
  } catch (_) {}
  return null;
}

async function main() {
  const cache = loadCache();
  if (cache && cache.generatedAt && Date.now() - cache.generatedAt < CACHE_TTL_MS) {
    const ageHours = ((Date.now() - cache.generatedAt) / 3600000).toFixed(1);
    console.log(`[market-research] Cache is ${ageHours}h old (< 48h), skipping.`);
    return;
  }

  const db = new Database(DB_PATH, { readonly: true });

  const jobs = db.prepare(`
    SELECT title, company, description, score, posted_at, location
    FROM jobs
    WHERE status != 'archived' AND description IS NOT NULL AND length(description) > 100
    ORDER BY score DESC, created_at DESC
  `).all();

  db.close();

  if (jobs.length === 0) {
    console.log('[market-research] No jobs with descriptions found, skipping.');
    return;
  }

  const resume = fs.existsSync(RESUME_PATH) ? fs.readFileSync(RESUME_PATH, 'utf8') : '';

  const jdBlock = jobs.map((j, i) =>
    `[JD ${i + 1}] ${j.company} — ${j.title} (score:${j.score}, location:${j.location || 'not specified'})\n${(j.description || '').slice(0, 600)}`
  ).join('\n\n---\n\n');

  const prompt = `You are a job market analyst. Analyze these ${jobs.length} job descriptions for a DevOps/Infrastructure/Platform engineer role and compare them against the candidate's resume.

CANDIDATE RESUME:
${resume}

JOB DESCRIPTIONS (each prefixed with score 1-10, where 10 = best fit):
${jdBlock}

Return ONLY a valid JSON object (no markdown, no explanation, no code fences). Schema:
{
  "summary": "3-5 sentence strategic take on what the market is asking for vs what this candidate offers. Be specific and actionable.",
  "top_skills": [{"skill": "string", "count": number, "pct": number}],
  "gap_analysis": [{"skill": "string", "count": number, "pct": number, "note": "brief explanation"}],
  "resume_strengths": [{"skill": "string", "count": number}],
  "trending": ["string"],
  "location_breakdown": {"remote": number, "hybrid": number, "in_person": number, "not_specified": number, "top_cities": [{"city": "string", "count": number}]},
  "sample_size": ${jobs.length},
  "skill_clusters": [
    {
      "name": "string",
      "emoji": "string",
      "skills": ["string"],
      "applicant_match_pct": number,
      "anchor_skill": "string",
      "anchor_note": "string",
      "job_count": number
    }
  ],
  "strategy_score": {
    "idp_pct": number,
    "ops_pct": number,
    "pivot_direction": "builder | operator | balanced",
    "pivot_note": "string"
  },
  "emerging_high_score": [
    {
      "term": "string",
      "job_count": number,
      "note": "string"
    }
  ]
}

Rules:
- top_skills: top 20 skills/technologies by frequency across all JDs, sorted by count desc. count = number of JDs mentioning it, pct = percentage of total JDs.
  IMPORTANT: Track "ECS/Fargate" as its own explicit skill. Count a JD toward "ECS/Fargate" only if it specifically mentions ECS, Fargate, ECS Fargate, or Amazon ECS. Generic AWS mentions (Lambda, S3, IAM, etc.) without ECS/Fargate do NOT count. A JD mentioning Fargate counts for BOTH "AWS" and "ECS/Fargate".
- gap_analysis: skills appearing in >= 15% of JDs that are NOT present or underrepresented on the resume. Max 10 items. Sorted by count desc.
- resume_strengths: skills from the resume that appear in >= 20% of JDs. Max 10 items. Sorted by count desc.
- trending: 5-8 emerging/newer terms or concepts appearing in JDs that signal where the market is heading in 2026. These should be things like new frameworks, methodologies, or terminology not yet mainstream.
- location_breakdown: categorize each JD's location field. "remote" = fully remote (includes "Remote", "Work from Home", "Anywhere"). "hybrid" = mix of remote and office days mentioned. "in_person" = on-site only, no remote option. "not_specified" = location field is blank, null, or ambiguous. top_cities: list the top 10 most common specific cities/metros mentioned across all JDs, each with a count of how many JDs mention that city/metro.
- skill_clusters: Analyze actual co-occurrence patterns across all ${jobs.length} JDs. Group skills into 3-4 archetypes based on which skills appear together most often. Do NOT use pre-defined clusters — derive them from the data. Expected patterns to look for: GPU/Ray/Vector DB skills clustering together (AI infra), GitOps/IDP/Backstage clustering together (Platform), AWS/Terraform/SRE/Observability (Scale Infra), FedRAMP/Zero Trust/Compliance (Security). For each cluster: name = descriptive archetype name, emoji = single emoji, skills = the 6-8 skills with tightest co-occurrence, applicant_match_pct = what % of cluster skills appear on the candidate resume (0-100), anchor_skill = the ONE missing skill that would most increase match (must not be on resume), anchor_note = 1 sentence on why that skill unlocks the cluster (cite co-occurrence frequency), job_count = how many JDs primarily belong to this cluster.
- strategy_score: For each JD, determine if it primarily emphasizes (a) building platforms/IDPs/internal tooling/developer experience (IDP/builder), or (b) managing/operating/reliability/incident response (Ops/operator). idp_pct = % of JDs skewing builder. ops_pct = % skewing operator. These should sum to ~100. pivot_direction: "builder" if idp_pct > 55, "operator" if ops_pct > 55, else "balanced". pivot_note = 1 sentence on what this ratio signals about the 2026 market direction.
- emerging_high_score: Look specifically at JDs with score >= 9. Find terms, concepts, or technologies that appear in those high-score JDs but are rare or absent in lower-scored JDs. These are signals of what employers most value in 2026. Up to 8 terms, sorted by job_count desc. term = the keyword/concept, job_count = how many score-9+ JDs contain it, note = 1 sentence on why it signals value.
- All counts and pcts must be real numbers based on actual analysis of the JDs provided.`;

  console.log(`[market-research] Running analysis on ${jobs.length} jobs...`);

  const raw = await callGemini(prompt, 3, 5000);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const data = JSON.parse(cleaned);

  const result = { generatedAt: Date.now(), jobCount: jobs.length, data };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2));

  console.log(`[market-research] Done. Analyzed ${jobs.length} jobs, cache written to ${CACHE_PATH}`);
}

main().catch(err => {
  console.error('[market-research] Error:', err.message);
  process.exit(1);
});
