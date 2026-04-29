'use strict';

const fs = require('fs');
const path = require('path');
const { scoreRejectionLikelihood, callGemini } = require('../scorer');
const { renderDashboard, COLORS } = require('./dashboard-html');
const applicant = require('../config/applicant');
const { GEMINI_DAILY_LIMIT, DAILY_TARGET } = require('../config/constants');
const { parseCompanyTags, serializeCompanyTags } = require('./company-tags');
const { FILTER_DEFS, postedTimestamp } = require('./html/helpers');
const { logEvent, getJobById, getGlobalStats, getAppliedByCompany } = require('./db');
const { toLocalDateString, getScraperHealth, getTodayActivityCounts, getDailyManualApplyCounts, buildDailyDigest, getTrackerData } = require('./dashboard-insights');
const { isAccessible, computeApplicantYoe } = require('./seniority');
const { getApplicationPrep, prepareApplication } = require('./application-prep');
const { renderApplicationPrepPage } = require('./html/application-prep');
const { renderHelpPage } = require('./html/help-page');
const { jsonOk, jsonError, route, postRoute, requireJob } = require('./routes/_helpers');
const { parseDashboardSearchOptions, applyDashboardSearch } = require('./dashboard-search');
const { listApplyImages } = require('./apply-images');
const { buildJobBookmarkletScript } = require('./bookmarklet');
const { loadCanonicalClusters, saveCanonicalClusters, buildClusterRule } = require('./canonical-clusters');
const { generateTailoredResume, getTailoredResume } = require('./tailored-resume');
const {
  getAutoApplyAttemptById,
  listAutoApplyAttempts,
  resolveAttemptArtifactPath,
  summarizeAutoApplyAttempts,
} = require('./auto-apply-receipts');

function buildApplicationPrepPayload(job, prep) {
  return {
    jobId: job.id,
    title: job.title,
    company: job.company,
    platform: job.platform,
    complexity: job.apply_complexity || null,
    workflow: prep?.workflow || (job.apply_complexity === 'simple' ? 'simple-auto' : 'manual'),
    applyUrl: prep?.apply_url || job.url,
    summary: prep?.summary || null,
    generatedAt: prep?.generated_at || null,
    questions: prep?.questions || [],
    answers: prep?.answers || {},
    voiceChecks: prep?.voiceChecks || {},
    profile: applicant,
  };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const handlePipeline = postRoute(async ({ id, value }, res, db) => {
  const VALID_PIPELINE = ['', 'applied', 'phone_screen', 'interview', 'onsite', 'offer', 'closed', 'rejected'];
  if (!VALID_PIPELINE.includes(value)) { jsonError(res, 400, 'bad pipeline value'); return; }
  const current = db.prepare("SELECT stage, status FROM jobs WHERE id=?").get(id);
  const fromStage = current?.stage || null;

  db.transaction(() => {
    if (!value) {
      db.prepare("UPDATE jobs SET status='pending', stage=NULL, updated_at=datetime('now') WHERE id=?").run(id);
      logEvent(db, id, 'stage_change', fromStage, null);
    } else if (value === 'closed') {
      db.prepare(`
        UPDATE jobs SET
          status='closed',
          stage='closed',
          updated_at=datetime('now')
        WHERE id=?
      `).run(id);
      logEvent(db, id, 'stage_change', fromStage, 'closed');
    } else if (value === 'rejected') {
      db.prepare(`
        UPDATE jobs SET
          status='rejected',
          stage='rejected',
          rejected_from_stage=?,
          rejected_at=datetime('now'),
          updated_at=datetime('now')
        WHERE id=?
      `).run(fromStage, id);
      logEvent(db, id, 'stage_change', fromStage, 'rejected');
    } else {
      db.prepare(`
        UPDATE jobs SET
          status='applied',
          stage=?,
          applied_at=COALESCE(applied_at, datetime('now')),
          updated_at=datetime('now')
        WHERE id=?
      `).run(value, id);
      logEvent(db, id, 'stage_change', fromStage, value);
    }
  })();

  if (value === 'applied' || value === 'rejected') {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    scoreRejectionLikelihood(job)
      .then(text => {
        db.prepare("UPDATE jobs SET rejection_reasoning=?, updated_at=datetime('now') WHERE id=?")
          .run(text, id);
      })
      .catch(() => {}); // non-critical, silent on failure
  }

  jsonOk(res, { ok: true });
});

const handleMarkOutreach = postRoute(async ({ id, clear }, res, db) => {
  if (clear) {
    db.prepare("UPDATE jobs SET reached_out_at=NULL, updated_at=datetime('now') WHERE id=?").run(id);
    logEvent(db, id, 'outreach', 'reached_out', null);
    jsonOk(res, { ok: true, reached_out_at: null });
  } else {
    db.prepare("UPDATE jobs SET reached_out_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(id);
    logEvent(db, id, 'outreach', null, 'reached_out');
    const row = db.prepare("SELECT reached_out_at FROM jobs WHERE id=?").get(id);
    if (!row) { jsonError(res, 404, 'job not found'); return; }
    jsonOk(res, { ok: true, reached_out_at: row.reached_out_at });
  }
});


const handleArchive = postRoute(async ({ id }, res, db) => {
  db.transaction(() => {
    db.prepare("UPDATE jobs SET status='archived', updated_at=datetime('now') WHERE id=?").run(id);
    logEvent(db, id, 'status_change', null, 'archived');
  })();
  jsonOk(res, { ok: true });
});

const handleJobDescription = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = db.prepare('SELECT title, company, url, description FROM jobs WHERE id = ?').get(id);
  if (!job) { jsonError(res, 404, 'not found'); return; }
  jsonOk(res, job);
});

const handleJobApplyImages = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = requireJob(db, id, res);
  if (!job) return;

  const images = listApplyImages(job);
  jsonOk(res, {
    pre: Boolean(images.pre),
    post: Boolean(images.post),
    defaultPhase: images.pre ? 'pre' : images.post ? 'post' : null,
  });
});

const handleJobApplyImage = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = requireJob(db, id, res);
  if (!job) return;

  const phase = url.searchParams.get('phase') === 'post' ? 'post' : 'pre';
  const filePath = listApplyImages(job)[phase];
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('apply image not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : ext === '.gif'
        ? 'image/gif'
        : 'image/png';
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
});

const handleGetApplicationPrep = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = requireJob(db, id, res);
  if (!job) return;

  const prep = getApplicationPrep(db, id);
  const html = renderApplicationPrepPage({ job, prep });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

const handlePrepareApplication = postRoute(async ({ id, force }, res, db) => {
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = requireJob(db, id, res);
  if (!job) return;

  const prep = await prepareApplication(db, job, { force: Boolean(force) });
  jsonOk(res, {
    ok: true,
    prep,
    redirectUrl: `/job-application-prep?id=${encodeURIComponent(id)}`,
  });
});

const handleJobApplicationData = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = requireJob(db, id, res);
  if (!job) return;

  const prep = getApplicationPrep(db, id);
  const payload = buildApplicationPrepPayload(job, prep);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload));
});

const handleJobBookmarkletScript = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) {
    res.writeHead(400, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(`alert(${JSON.stringify('Missing job id for bookmarklet.')});`);
    return;
  }

  const job = getJobById(db, id);
  if (!job) {
    res.writeHead(404, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(`alert(${JSON.stringify(`Job not found: ${id}`)});`);
    return;
  }

  const prep = getApplicationPrep(db, id);
  const payload = buildApplicationPrepPayload(job, prep);
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(buildJobBookmarkletScript(payload));
});

const handleTailoredResume = route((req, res, db, url) => {
  const id = url.searchParams.get('id');
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const tailored = getTailoredResume(db, id);
  const type = url.searchParams.get('type') || 'pdf';
  const filePath = type === 'html'
    ? tailored?.resume_html_path
    : type === 'md'
      ? tailored?.resume_md_path
      : tailored?.resume_pdf_path;

  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('tailored resume not found');
    return;
  }

  const contentType = type === 'html'
    ? 'text/html; charset=utf-8'
    : type === 'md'
      ? 'text/markdown; charset=utf-8'
      : 'application/pdf';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': type === 'pdf' ? `inline; filename="${id}-tailored-resume.pdf"` : 'inline',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
});

const handleGenerateTailoredResume = postRoute(async ({ id, force }, res, db) => {
  if (!id) { jsonError(res, 400, 'id required'); return; }
  const job = requireJob(db, id, res);
  if (!job) return;

  try {
    const tailored = await generateTailoredResume(db, job, { force: Boolean(force) });
    jsonOk(res, {
      ok: true,
      status: tailored.status,
      resumeUrl: `/tailored-resume?id=${encodeURIComponent(id)}`,
      resumePath: tailored.resume_pdf_path,
      summary: tailored.summary,
    });
  } catch (error) {
    jsonError(res, 422, error.message || 'tailored resume failed');
  }
});

const handleAutoApplyAttempt = route((req, res, db, url) => {
  const id = Number.parseInt(url.searchParams.get('id') || '', 10);
  if (!Number.isInteger(id) || id <= 0) { jsonError(res, 400, 'attempt id required'); return; }
  const attempt = getAutoApplyAttemptById(db, id);
  if (!attempt) { jsonError(res, 404, 'attempt not found'); return; }
  jsonOk(res, attempt);
});

const handleAutoApplyArtifact = route((req, res, db, url) => {
  const id = Number.parseInt(url.searchParams.get('attemptId') || '', 10);
  const type = url.searchParams.get('type') || 'pre';
  if (!Number.isInteger(id) || id <= 0) { jsonError(res, 400, 'attempt id required'); return; }
  if (!['resume', 'pre', 'post'].includes(type)) { jsonError(res, 400, 'unsupported artifact type'); return; }
  const attempt = getAutoApplyAttemptById(db, id);
  if (!attempt) { jsonError(res, 404, 'attempt not found'); return; }
  const filePath = resolveAttemptArtifactPath(attempt, type);
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('artifact not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.pdf'
    ? 'application/pdf'
    : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/png';
  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
});

const handleGetCompanyNotes = route((req, res, db, url) => {
  const company = (url.searchParams.get('company') || '').toLowerCase().trim();
  if (!company) { jsonOk(res, { tags: '', notes: '' }); return; }
  let row = null;
  try { row = db.prepare("SELECT tags, notes FROM company_notes WHERE company = ?").get(company); } catch (e) { /* table may not exist */ }
  jsonOk(row ? { ...row, tags: serializeCompanyTags(row.tags) } : { tags: '', notes: '' });
});

const handleSaveCompanyNotes = postRoute(async ({ company, tags, notes }, res, db) => {
  const key = (company || '').toLowerCase().trim();
  if (!key) { jsonError(res, 400, 'company required'); return; }
  const normalizedTags = serializeCompanyTags(tags);
  db.prepare(`
    INSERT INTO company_notes (company, tags, notes, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(company) DO UPDATE SET tags=excluded.tags, notes=excluded.notes, updated_at=datetime('now')
  `).run(key, normalizedTags, notes || '');
  jsonOk(res, { ok: true });
});

function handleResume(req, res, db, url) {
  const profileDir = process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example');
  const variant = url && url.searchParams.get('variant');
  const fileMap = {
    ai:     'resume-ai.pdf',
    devops: 'resume-devops.pdf',
  };
  const fileName = fileMap[variant] || 'resume.pdf';
  const resumePath = path.join(profileDir, fileName);
  if (fs.existsSync(resumePath)) {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
    });
    fs.createReadStream(resumePath).pipe(res);
    return;
  }
  res.writeHead(404); res.end(`Resume PDF not found: ${fileName}. Run: node generate-resume.js`);
}

// ---------------------------------------------------------------------------
// Dashboard data fetchers
// ---------------------------------------------------------------------------

// Pre-built ORDER BY clauses — no user input enters SQL strings
const ORDER_BY = {
  'date-applied':  'applied_at DESC, created_at DESC',
  'date-posted':   'posted_at DESC, created_at DESC',
  'date-rejected': 'COALESCE(rejected_at, updated_at) DESC',
  'score-applied': 'score DESC, applied_at DESC, created_at DESC',
  'score-posted':  'score DESC, posted_at DESC, created_at DESC',
  'score-rejected': 'score DESC, COALESCE(rejected_at, updated_at) DESC',
};
const JOBS_PAGE_SIZE = 25;

function fetchFilteredJobs(db, filter, sort, level) {
  const sortMode = sort === 'date' ? 'date' : 'score';
  const dateKey = filter === 'rejected' ? 'rejected' : 'posted';
  const scoreKey = filter === 'applied' ? 'applied' : dateKey;
  const orderKey = sortMode === 'date' ? dateKey : scoreKey;
  const orderBy = ORDER_BY[`${sortMode}-${orderKey}`];

  const filterQueries = {
    'all':          () => db.prepare(`SELECT * FROM jobs WHERE status NOT IN ('archived','rejected','closed') ORDER BY ${orderBy}`).all(),
    'not-applied':  () => db.prepare(`SELECT * FROM jobs WHERE status NOT IN ('applied','responded','archived','closed') AND COALESCE(stage, '') NOT IN ('closed', 'rejected') ORDER BY ${orderBy}`).all(),
    'applied':      () => db.prepare(`SELECT * FROM jobs WHERE status IN ('applied','responded') AND stage != 'closed' ORDER BY ${orderBy}`).all(),
    'interviewing': () => db.prepare(`SELECT * FROM jobs WHERE stage IN ('phone_screen','interview','onsite','offer') ORDER BY ${orderBy}`).all(),
    'rejected':     () => db.prepare(`SELECT * FROM jobs WHERE stage = 'rejected' ORDER BY ${orderBy}`).all(),
    'closed':       () => db.prepare(`SELECT * FROM jobs WHERE stage = 'closed' ORDER BY updated_at DESC`).all(),
    'analytics':    () => [],
    'auto-apply-log': () => [],
    'activity-log': () => [],
    'archived':     () => db.prepare(`SELECT * FROM jobs WHERE status = 'archived' ORDER BY ${orderBy}`).all(),
  };

  let jobs = (filterQueries[filter] || filterQueries['all'])();
  attachTailoredResumeStatus(db, jobs);
  if (level === '1') jobs = jobs.filter(j => isAccessible(j.title, j.description));
  // Re-sort by JS timestamp when date sort is active — SQL ORDER BY posted_at
  // fails for text values like "Posted Yesterday" vs ISO dates.
  if (sortMode === 'date' && orderKey === 'posted') {
    jobs.sort((a, b) => postedTimestamp(b.posted_at) - postedTimestamp(a.posted_at));
  }
  return jobs;
}

function attachTailoredResumeStatus(db, jobs) {
  if (!jobs.length) return;
  const rows = db.prepare('SELECT job_id, status, resume_pdf_path FROM tailored_resumes').all();
  const byJobId = new Map(rows.map((row) => [row.job_id, row]));
  for (const job of jobs) {
    const row = byJobId.get(job.id);
    if (!row) continue;
    job.tailored_resume_status = row.status;
    job.tailored_resume_pdf_path = row.resume_pdf_path;
  }
}

function paginateJobs(jobs, requestedPage) {
  const totalItems = jobs.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / JOBS_PAGE_SIZE));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (page - 1) * JOBS_PAGE_SIZE;
  const endIndex = Math.min(startIndex + JOBS_PAGE_SIZE, totalItems);

  return {
    jobs: jobs.slice(startIndex, endIndex),
    pagination: {
      page,
      pageSize: JOBS_PAGE_SIZE,
      totalItems,
      totalPages,
      startItem: totalItems ? startIndex + 1 : 0,
      endItem: endIndex,
    },
  };
}

function fetchDashboardContext(db) {
  const appliedByCompany = getAppliedByCompany(db);

  const globalStats = getGlobalStats(db);
  const todayStr = toLocalDateString();
  const dailyDigest = buildDailyDigest(db, todayStr);

  const dailyCounts = getDailyManualApplyCounts(db).map(row => ({ ...row, target: DAILY_TARGET }));
  Object.assign(globalStats, getTodayActivityCounts(db, todayStr));
  globalStats.dailyTarget = DAILY_TARGET;

  const usageRow = db.prepare("SELECT COALESCE(SUM(call_count), 0) as used FROM api_usage WHERE date = ?").get(todayStr);
  const apiUsage = { used: usageRow ? usageRow.used : 0, limit: GEMINI_DAILY_LIMIT };

  const scraperHealth = getScraperHealth(db, todayStr);

  const companyTags = {};
  try {
    for (const row of db.prepare("SELECT company, tags FROM company_notes WHERE tags IS NOT NULL AND tags != ''").all()) {
      companyTags[row.company.toLowerCase().trim()] = parseCompanyTags(row.tags);
    }
  } catch (e) { /* company_notes table may not exist yet */ }

  return { appliedByCompany, dailyDigest, globalStats, dailyCounts, apiUsage, scraperHealth, companyTags };
}

function parseAutoApplyFilters(url) {
  const status = (url.searchParams.get('autoStatus') || '').trim() || null;
  const platform = (url.searchParams.get('autoPlatform') || '').trim() || null;
  const mode = (url.searchParams.get('autoMode') || '').trim() || null;
  const failureClass = (url.searchParams.get('autoFailureClass') || '').trim() || null;
  const minScore = Number.parseInt(url.searchParams.get('autoMinScore') || '', 10);
  const days = Number.parseInt(url.searchParams.get('autoDays') || '', 10);
  return {
    status,
    platform,
    mode,
    failureClass,
    minScore: Number.isInteger(minScore) ? Math.min(Math.max(minScore, 1), 9) : null,
    days: Number.isInteger(days) && days > 0 ? days : null,
  };
}

function fetchAnalyticsData(db, autoApplyFilters = {}) {
  const allTimeStats = {
    applied:      db.prepare("SELECT COUNT(*) n FROM jobs WHERE applied_at IS NOT NULL").get().n,
    rejected:     db.prepare("SELECT COUNT(*) n FROM jobs WHERE stage='rejected'").get().n,
    phoneScreens: db.prepare("SELECT COUNT(*) n FROM jobs WHERE stage='phone_screen' OR rejected_from_stage='phone_screen'").get().n,
    interviewing: db.prepare("SELECT COUNT(*) n FROM jobs WHERE stage IN ('interview','onsite') OR rejected_from_stage IN ('interview','onsite')").get().n,
    offers:       db.prepare("SELECT COUNT(*) n FROM jobs WHERE stage='offer'").get().n,
    pending:      db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='pending'").get().n,
  };

  const STAGE_ORDER = ['applied', 'phone_screen', 'interview', 'onsite', 'offer'];
  const funnel = { applied: allTimeStats.applied };
  for (let i = 1; i < STAGE_ORDER.length; i++) {
    const stages = STAGE_ORDER.slice(i);
    const placeholders = stages.map(() => '?').join(',');
    funnel[STAGE_ORDER[i]] = db.prepare(`
      SELECT COUNT(*) as n FROM jobs
      WHERE stage IN (${placeholders})
      OR (stage = 'rejected' AND rejected_from_stage IN (${placeholders}))
    `).get(...stages, ...stages).n;
  }

  const scoreCalibration = db.prepare(`
    SELECT score,
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('applied','responded') THEN 1 ELSE 0 END) as applied,
      SUM(CASE WHEN stage IN ('phone_screen','interview','onsite','offer') THEN 1 ELSE 0 END) as advanced,
      SUM(CASE WHEN stage = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM jobs WHERE score IS NOT NULL
    GROUP BY score ORDER BY score
  `).all();

  const recentEvents = db.prepare(`
    SELECT e.event_type, e.from_value, e.to_value, e.created_at,
      j.company, j.title
    FROM events e JOIN jobs j ON e.job_id = j.id
    ORDER BY e.created_at DESC
  `).all();

  const rejectionInsights = db.prepare(`
    SELECT e.from_value as rejected_from,
      j.company, j.title, j.score, j.posted_at, j.applied_at,
      ROUND(julianday(e.created_at) - julianday(j.applied_at), 1) as days_to_reject,
      ROUND(julianday(j.applied_at) - julianday(j.posted_at), 1) as posting_age
    FROM events e JOIN jobs j ON e.job_id = j.id
    WHERE e.to_value = 'rejected'
    ORDER BY e.created_at DESC
  `).all();

  const autoApplyAttempts = listAutoApplyAttempts(db, {
    limit: 200,
    status: autoApplyFilters.status,
    platform: autoApplyFilters.platform,
    mode: autoApplyFilters.mode,
    failureClass: autoApplyFilters.failureClass,
    minScore: autoApplyFilters.minScore,
    days: autoApplyFilters.days,
  });
  const autoApplySummary = summarizeAutoApplyAttempts(autoApplyAttempts);

  return {
    allTimeStats,
    funnel,
    scoreCalibration,
    recentEvents,
    rejectionInsights,
    autoApplyAttempts,
    autoApplySummary,
    autoApplyFilters,
  };
}

// ---------------------------------------------------------------------------
// Market research
// ---------------------------------------------------------------------------

const MARKET_RESEARCH_PROFILE_DIR = process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example');
const MARKET_RESEARCH_CACHE_PATH = path.join(MARKET_RESEARCH_PROFILE_DIR, 'market-research-cache.json');
const RESUME_PATH_FOR_RESEARCH = path.join(MARKET_RESEARCH_PROFILE_DIR, 'resume-ai.md');

function loadMarketResearchCache() {
  try {
    if (fs.existsSync(MARKET_RESEARCH_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(MARKET_RESEARCH_CACHE_PATH, 'utf8'));
    }
  } catch (_) {}
  return null;
}

const handleMarketResearch = route(async (req, res, db) => {
  if (req.method === 'GET') {
    // Redirect to dashboard page — handled by handleDashboardPage
    res.writeHead(302, { Location: '/?filter=market-research' });
    res.end();
    return;
  }

  // POST — run analysis
  const jobs = db.prepare(`
    SELECT title, company, description, score, posted_at, location
    FROM jobs
    WHERE status != 'archived' AND description IS NOT NULL AND length(description) > 100
    ORDER BY score DESC, created_at DESC
  `).all();

  const resume = fs.existsSync(RESUME_PATH_FOR_RESEARCH)
    ? fs.readFileSync(RESUME_PATH_FOR_RESEARCH, 'utf8')
    : '';
  const canonicalClusters = loadCanonicalClusters(MARKET_RESEARCH_PROFILE_DIR);

  const jdBlock = jobs.map((j, i) =>
    `[JD ${i+1}] ${j.company} — ${j.title} (score:${j.score}, location:${j.location || 'not specified'})\n${(j.description || '').slice(0, 600)}`
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
${buildClusterRule(canonicalClusters, jobs.length)}
- strategy_score: For each JD, determine if it primarily emphasizes (a) building platforms/IDPs/internal tooling/developer experience (IDP/builder), or (b) managing/operating/reliability/incident response (Ops/operator). idp_pct = % of JDs skewing builder. ops_pct = % skewing operator. These should sum to ~100. pivot_direction: "builder" if idp_pct > 55, "operator" if ops_pct > 55, else "balanced". pivot_note = 1 sentence on what this ratio signals about the 2026 market direction.
- emerging_high_score: Look specifically at JDs with score >= 9. Find terms, concepts, or technologies that appear in those high-score JDs but are rare or absent in lower-scored JDs. These are signals of what employers most value in 2026. Up to 8 terms, sorted by job_count desc. term = the keyword/concept, job_count = how many score-9+ JDs contain it, note = 1 sentence on why it signals value.
- All counts and pcts must be real numbers based on actual analysis of the JDs provided.`;

  const raw = await callGemini(prompt, 3, 5000);

  // Strip markdown fences if Gemini wraps the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const data = JSON.parse(cleaned);

  if (!canonicalClusters && data.skill_clusters && data.skill_clusters.length > 0) {
    saveCanonicalClusters(MARKET_RESEARCH_PROFILE_DIR, data.skill_clusters);
  }

  const cache = { generatedAt: Date.now(), jobCount: jobs.length, data };
  fs.writeFileSync(MARKET_RESEARCH_CACHE_PATH, JSON.stringify(cache, null, 2));

  res.writeHead(302, { Location: '/?filter=market-research' });
  res.end();
});

// ---------------------------------------------------------------------------
// Dashboard page handler
// ---------------------------------------------------------------------------

function loadSlugHealth() {
  try {
    const p = path.join(__dirname, '..', 'slug-health.json');
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Check if dismissed for this run
    const dp = path.join(__dirname, '..', 'slug-health-dismissed.json');
    if (fs.existsSync(dp)) {
      const dismissed = JSON.parse(fs.readFileSync(dp, 'utf8'));
      if (dismissed.ts === data.timestamp) data._dismissed = true;
    }
    return data;
  } catch { return null; }
}

const handleDismissSlugBanner = postRoute(async (_body, res) => {
  try {
    const p = path.join(__dirname, '..', 'slug-health.json');
    const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
    const dp = path.join(__dirname, '..', 'slug-health-dismissed.json');
    fs.writeFileSync(dp, JSON.stringify({ ts: data.timestamp }));
    jsonOk(res, { ok: true });
  } catch (e) { jsonError(res, 500, e.message); }
});

function loadJdHealth() {
  try {
    const p = path.join(__dirname, '..', 'jd-health.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function handleDashboardPage(req, res, db, url) {
  const requestedFilter = url.searchParams.get('filter') || 'all';
  const rawFilter = requestedFilter === 'auto-apply-log' ? 'auto-applies' : requestedFilter;
  const allowedFilters = FILTER_DEFS.map(f => f.id);
  const filter = allowedFilters.includes(rawFilter) ? rawFilter : 'all';
  const rawSort = url.searchParams.get('sort');
  const requestedSort = rawSort === 'date' ? 'date' : 'score';
  const sort = filter === 'rejected' && !rawSort ? 'date' : requestedSort;
  const level = url.searchParams.get('level') === '1' ? '1' : null;
  const searchOptions = parseDashboardSearchOptions(url);
  const rawPage = Number.parseInt(url.searchParams.get('page') || '1', 10);
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const isPaginatedListView = !['analytics', 'auto-applies', 'activity-log', 'market-research'].includes(filter);
  const autoApplyFilters = parseAutoApplyFilters(url);

  const baseJobs = fetchFilteredJobs(db, filter, sort, level);
  const allJobs = isPaginatedListView
    ? applyDashboardSearch(baseJobs, searchOptions)
    : baseJobs;
  const { jobs, pagination } = isPaginatedListView
    ? paginateJobs(allJobs, requestedPage)
    : { jobs: allJobs, pagination: null };
  const context = fetchDashboardContext(db);
  // myLevel badge should reflect accessible jobs in the current view, not all jobs
  const baseJobsForLevel = level === '1' ? baseJobs : fetchFilteredJobs(db, filter, sort, null);
  const jobsForLevel = isPaginatedListView
    ? level === '1'
      ? allJobs
      : applyDashboardSearch(baseJobsForLevel, searchOptions)
    : baseJobsForLevel;
  context.globalStats.myLevel = jobsForLevel.filter(j => isAccessible(j.title, j.description)).length;
  const analyticsData = ['analytics', 'auto-applies', 'activity-log'].includes(filter)
    ? fetchAnalyticsData(db, autoApplyFilters)
    : null;
  const marketResearchData = filter === 'market-research'
    ? {
        cache: loadMarketResearchCache(),
        jobCount: db.prepare("SELECT COUNT(*) as n FROM jobs WHERE score >= 7 AND description IS NOT NULL AND length(description) > 100").get()?.n || 0,
        allJobs: db.prepare("SELECT title, description, score, status, applied_at, stage, rejected_from_stage FROM jobs WHERE status != 'archived'").all(),
        applicantYoe: computeApplicantYoe(MARKET_RESEARCH_PROFILE_DIR),
      }
    : null;

  const slugHealth = loadSlugHealth();
  const jdHealth = loadJdHealth();
  const html = renderDashboard({ jobs, pagination, filter, sort, level, searchOptions, ...context, analyticsData, marketResearchData, slugHealth, jdHealth });
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleHelpPage(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(renderHelpPage());
}

function handleTrackerApi(req, res, db) {
  const url = new URL(req.url, 'http://localhost');
  const period = ['7d', '30d', '90d', 'all'].includes(url.searchParams.get('period'))
    ? url.searchParams.get('period')
    : '30d';
  const rows = getTrackerData(db, period);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(rows));
}

const handleInsightsApi = route((req, res, db) => {
  const todayStr = toLocalDateString();
  const counts = getTodayActivityCounts(db, todayStr);
  const digest = buildDailyDigest(db, todayStr);
  const scraperHealth = getScraperHealth(db, todayStr);
  const dailyCounts = getDailyManualApplyCounts(db).map(row => ({ ...row, target: DAILY_TARGET }));
  jsonOk(res, { ...counts, dailyDigest: digest, scraperHealth, dailyCounts });
});

module.exports = {
  handlePipeline,
  handleMarkOutreach,
  handleArchive,
  handleResume,
  handleGetCompanyNotes,
  handleSaveCompanyNotes,
  handleJobDescription,
  handleJobApplyImages,
  handleJobApplyImage,
  handleGetApplicationPrep,
  handlePrepareApplication,
  handleJobApplicationData,
  handleJobBookmarkletScript,
  handleTailoredResume,
  handleGenerateTailoredResume,
  handleAutoApplyAttempt,
  handleAutoApplyArtifact,
  handleDashboardPage,
  handleHelpPage,
  fetchFilteredJobs,
  handleMarketResearch,
  handleDismissSlugBanner,
  handleTrackerApi,
  handleInsightsApi,
};
