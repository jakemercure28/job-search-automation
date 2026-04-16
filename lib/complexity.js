'use strict';

const { safeFetch, sleep } = require('./utils');
const { detectAts } = require('./atsDetector');
const { SCRAPER_DELAY_MS } = require('../config/constants');
const log = require('./logger')('pipeline');

// Standard Greenhouse field names that don't count as "custom questions"
const STANDARD_FIELDS = new Set([
  'first_name', 'last_name', 'preferred_name', 'email', 'phone',
  'resume', 'resume_text', 'cover_letter', 'cover_letter_text',
]);

// Platform defaults when we can't check via API
const PLATFORM_DEFAULTS = {
  workday: 'complex',
};

const SIMPLE_GREENHOUSE_LABEL_PATTERNS = [
  /linkedin/i,
  /visa sponsorship/i,
  /require sponsorship/i,
  /authorized to work/i,
  /legally authorized/i,
  /work authorization/i,
  /u\.s\. work authorization/i,
  /clearance eligibility/i,
  /security clearance/i,
  /export controls/i,
  /united states citizen|citizen or national|permanent residence/i,
  /history with anduril/i,
  /employed by anduril|company that anduril has acquired/i,
  /conflict of interest/i,
  /how did you hear about anduril/i,
  /country/i,
  /location/i,
  /website|portfolio|github/i,
  /gender/i,
  /pronoun/i,
  /sexual orientation/i,
  /hispanic|latino/i,
  /race|ethnicity/i,
  /veteran/i,
  /disability/i,
  /privacy/i,
  /consent/i,
  /education/i,
  /school/i,
  /degree/i,
  /field of study/i,
  /graduation/i,
];

const SIMPLE_GREENHOUSE_FIELD_TYPES = new Set([
  'input_text',
  'multi_value_single_select',
  'checkbox',
  'input_hidden',
]);

function extractBuiltInApplyUrl(html) {
  if (!html) return null;

  const preferredMatches = Array.from(
    String(html).matchAll(/<a[^>]+href="([^"]+)"[^>]*@click="applyClick"[^>]*>/gi),
    (match) => match[1]
  );
  const candidates = preferredMatches.length
    ? preferredMatches
    : Array.from(
        String(html).matchAll(/<a[^>]+href="([^"]+)"[^>]*>/gi),
        (match) => match[1]
      );

  for (const candidate of candidates) {
    const decoded = candidate
      .replace(/&amp;/g, '&')
      .trim();
    if (!decoded || decoded.startsWith('/')) continue;
    const ats = detectAts(decoded);
    if (ats?.platform) return decoded;
  }

  return null;
}

async function resolveBuiltInAtsJob(job) {
  const url = String(job?.url || '');
  if (!/https?:\/\/[a-z0-9-]+\.builtin\.com\/job\//i.test(url)) return null;

  const res = await safeFetch(url, {}, `builtin-job-${job.id || job.company || 'unknown'}`);
  if (!res) return null;

  try {
    const html = await res.text();
    const applyUrl = extractBuiltInApplyUrl(html);
    if (!applyUrl) return null;
    const ats = detectAts(applyUrl);
    if (!ats?.platform) return null;
    return {
      url: applyUrl,
      platform: ats.platform,
    };
  } catch {
    return null;
  }
}

function slugifyCompany(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectJobPlatform(job) {
  const ats = detectAts(job.url || '');
  if (ats?.platform) return ats.platform.toLowerCase();

  const lowerId = String(job.id || '').toLowerCase();
  if (lowerId.startsWith('greenhouse-')) return 'greenhouse';
  if (lowerId.startsWith('lever-')) return 'lever';
  if (lowerId.startsWith('ashby-')) return 'ashby';
  if (lowerId.startsWith('workday-')) return 'workday';
  if (lowerId.startsWith('rippling-')) return 'rippling';

  const platform = String(job.platform || '').toLowerCase();
  if (platform.includes('greenhouse')) return 'greenhouse';
  if (platform.includes('lever')) return 'lever';
  if (platform.includes('ashby')) return 'ashby';
  if (platform.includes('workday')) return 'workday';
  if (platform.includes('rippling')) return 'rippling';

  return null;
}

function parseGreenhouseJob(job) {
  const url = String(job.url || '');
  const standard = url.match(/greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (standard) {
    return { boardToken: standard[1], jobId: standard[2] };
  }

  const ghJid = url.match(/[?&]gh_jid=(\d+)/);
  if (ghJid) {
    return {
      boardToken: slugifyCompany(job.company),
      jobId: ghJid[1],
    };
  }

  if (String(job.id || '').startsWith('greenhouse-')) {
    return {
      boardToken: slugifyCompany(job.company),
      jobId: String(job.id).replace('greenhouse-', ''),
    };
  }

  return null;
}

function isSimpleGreenhouseQuestion(question) {
  const label = String(question?.label || '').trim();
  const fields = Array.isArray(question?.fields) ? question.fields : [];
  const customFields = fields.filter(field => !STANDARD_FIELDS.has(field.name));

  if (!customFields.length) return true;
  if (!SIMPLE_GREENHOUSE_LABEL_PATTERNS.some(pattern => pattern.test(label))) return false;

  return customFields.every((field) => {
    if (field.type === 'textarea') return false;
    return SIMPLE_GREENHOUSE_FIELD_TYPES.has(field.type);
  });
}


/**
 * Check if a Greenhouse job has custom essay questions.
 * Returns 'simple', 'complex', or null on failure.
 */
async function classifyGreenhouse(job) {
  const parsed = parseGreenhouseJob(job);
  if (!parsed?.boardToken || !parsed?.jobId) return null;

  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${parsed.boardToken}/jobs/${parsed.jobId}?questions=true`;

  const res = await safeFetch(apiUrl, {}, `greenhouse-questions-${parsed.jobId}`);
  if (!res) return null;

  try {
    const data = await res.json();
    const questions = data.questions || [];

    for (const q of questions) {
      if (!q.required) continue;
      if (!isSimpleGreenhouseQuestion(q)) return 'complex';
    }

    return 'simple';
  } catch {
    return null;
  }
}

/**
 * Check if an Ashby job has custom questions.
 * Fetches the apply page HTML and looks for custom field paths (question_* pattern).
 * Ashby embeds field metadata in the server-rendered HTML as serialized React state.
 * Returns 'simple', 'complex', or null on failure.
 */
async function classifyAshby(job) {
  const m = job.url && job.url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const [, company, jobId] = m;

  const applyUrl = `https://jobs.ashbyhq.com/${company}/${jobId}/application`;
  const res = await safeFetch(applyUrl, {}, `ashby-apply-${jobId}`);
  if (!res) return null;

  try {
    const html = await res.text();
    // Custom question fields have paths like "question_1234567890"
    // Standard fields use _systemfield_* paths or known names (phone, cover_letter)
    if (/"path":"question_/.test(html)) return 'complex';
    // 404 or error page
    if (/not found|404|error/i.test(html) && !/"path":"_systemfield_/.test(html)) return null;
    return 'simple';
  } catch {
    return null;
  }
}

/**
 * Check if a Lever job has custom question cards (essay fields).
 * Fetches the apply page HTML and looks for card-field inputs.
 * Returns 'simple', 'complex', or null on failure.
 */
async function classifyLever(job) {
  const m = job.url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  const [, company, jobId] = m;

  // Lever's apply page HTML includes the card template data even before React hydrates.
  // Custom question cards use name="cards[...][fieldN]" in the server-rendered markup.
  const applyUrl = `https://jobs.lever.co/${company}/${jobId}/apply`;
  const res = await safeFetch(applyUrl, {}, `lever-apply-${jobId}`);
  if (!res) return null;

  try {
    const html = await res.text();
    // Any card field input means custom questions exist
    if (/name="cards\[/.test(html)) return 'complex';
    // Check for 404 page
    if (/couldn't find anything|404/i.test(html) && !html.includes('postings-form')) return null;
    return 'simple';
  } catch {
    return null;
  }
}

/**
 * Classify application complexity for a batch of jobs.
 * Only processes jobs where apply_complexity IS NULL.
 */
async function classifyComplexity(jobs, db) {
  if (!jobs.length) return;

  const update = db.prepare("UPDATE jobs SET apply_complexity=?, updated_at=datetime('now') WHERE id=?");
  const updateResolved = db.prepare("UPDATE jobs SET url=?, platform=?, updated_at=datetime('now') WHERE id=?");
  let classified = 0;

  for (const job of jobs) {
    if (String(job.platform || '').toLowerCase().includes('built in') && !detectAts(job.url || '')) {
      const resolved = await resolveBuiltInAtsJob(job);
      if (resolved?.url) {
        job.url = resolved.url;
        job.platform = resolved.platform;
        updateResolved.run(resolved.url, resolved.platform, job.id);
      }
    }

    const platform = detectJobPlatform(job);
    let complexity = PLATFORM_DEFAULTS[platform] || null;

    if (platform === 'greenhouse') {
      complexity = await classifyGreenhouse(job);
      await sleep(SCRAPER_DELAY_MS);
    } else if (platform === 'lever') {
      complexity = await classifyLever(job);
      await sleep(SCRAPER_DELAY_MS);
    } else if (platform === 'ashby') {
      complexity = await classifyAshby(job);
      await sleep(SCRAPER_DELAY_MS);
    }

    if (complexity) {
      update.run(complexity, job.id);
      classified++;
    }
  }

  if (classified > 0) {
    log.info('Classified job complexity', { count: classified });
  }
}

module.exports = {
  classifyComplexity,
  classifyGreenhouse,
  classifyAshby,
  classifyLever,
  detectJobPlatform,
  extractBuiltInApplyUrl,
  isSimpleGreenhouseQuestion,
  parseGreenhouseJob,
  resolveBuiltInAtsJob,
};
