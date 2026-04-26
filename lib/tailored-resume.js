'use strict';

const fs = require('fs');
const path = require('path');

const { baseDir } = require('../config/paths');
const { callGemini } = require('./gemini');
const { renderResumeMarkdownToHtml, writeResumePdf } = require('../scripts/generate-resume');
const log = require('./logger')('resume');

const TAILORED_RESUME_DIR = 'tailored-resumes';

function nowIso() {
  return new Date().toISOString();
}

function readUtf8(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trim() : '';
}

function safeJobId(jobId) {
  return String(jobId || '').replace(/[^A-Za-z0-9._-]/g, '_');
}

function artifactPaths(jobId, profileDir = baseDir) {
  const dir = path.join(profileDir, TAILORED_RESUME_DIR, safeJobId(jobId));
  return {
    dir,
    markdown: path.join(dir, 'resume.md'),
    html: path.join(dir, 'resume.html'),
    pdf: path.join(dir, 'resume.pdf'),
    metadata: path.join(dir, 'metadata.json'),
  };
}

function selectSourceResumeVariant(job = {}, profileDir = baseDir) {
  const haystack = `${job.title || ''}\n${job.company || ''}\n${job.description || ''}`.toLowerCase();
  const candidates = [
    {
      variant: 'ai',
      fileName: 'resume-ai.md',
      score: /\b(ai|ml|machine learning|llm|generative ai|genai|agentic|model evaluation|model serving)\b/.test(haystack) ? 2 : 0,
    },
    {
      variant: 'devops',
      fileName: 'resume-devops.md',
      score: /\b(devops|sre|site reliability|platform|infra|infrastructure|kubernetes|terraform|cloud|aws|reliability|observability|ci\/cd|cicd)\b/.test(haystack) ? 2 : 0,
    },
    {
      variant: 'base',
      fileName: 'resume.md',
      score: 1,
    },
  ];

  const selected = candidates
    .filter((candidate) => fs.existsSync(path.join(profileDir, candidate.fileName)))
    .sort((left, right) => right.score - left.score)[0] || candidates[candidates.length - 1];

  return {
    variant: selected.variant,
    fileName: selected.fileName,
    path: path.join(profileDir, selected.fileName),
  };
}

function parseGeminiJson(text) {
  const trimmed = String(text || '').trim();
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {}
    }
    const resumeMatch = cleaned.match(/"resume_markdown"\s*:\s*"([\s\S]*?)"\s*,\s*"summary"\s*:/);
    if (resumeMatch) {
      const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]*)"/);
      const keywordsMatch = cleaned.match(/"keywords"\s*:\s*\[([\s\S]*?)\]/);
      const keywords = keywordsMatch
        ? keywordsMatch[1].split(',').map((value) => value.trim().replace(/^"|"$/g, '')).filter(Boolean)
        : [];
      return {
        resume_markdown: resumeMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
        summary: summaryMatch ? summaryMatch[1] : 'Generated tailored resume.',
        keywords,
      };
    }
    const markdownStart = cleaned.indexOf('# ');
    if (markdownStart >= 0) {
      const tail = cleaned.slice(markdownStart);
      const nextJsonField = tail.search(/"\s*,\s*"(summary|keywords)"\s*:/);
      const resumeMarkdown = (nextJsonField >= 0 ? tail.slice(0, nextJsonField) : tail)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/"\s*[,}]*\s*$/g, '')
        .trim();
      const summaryMatch = cleaned.match(/"summary"\s*:\s*"([^"]*)"/);
      return {
        resume_markdown: resumeMarkdown,
        summary: summaryMatch ? summaryMatch[1] : 'Generated tailored resume.',
        keywords: [],
      };
    }
    if (cleaned.startsWith('# ')) {
      return {
        resume_markdown: cleaned,
        summary: 'Generated tailored resume.',
        keywords: [],
      };
    }
    throw error;
  }
}

function buildPrompt({ job, sourceResume, context, careerDetail }) {
  return `You are tailoring a resume for a specific job.

Rules:
- Use only facts present in the source resume, profile context, and career detail below.
- Do not invent employers, titles, dates, degrees, certifications, tools, metrics, ownership, or outcomes.
- Keep the resume in Markdown using the same structure as the source resume.
- Preserve the candidate identity and contact line from the source resume.
- Tailor by selecting, reordering, and lightly rewriting existing truthful bullets for relevance.
- If a job keyword is not supported by the source material, omit it.
- Return either valid JSON with escaped newlines or the full tailored Markdown resume only.
- If returning JSON, use this shape:
{"resume_markdown":"full tailored resume markdown with escaped newline characters","summary":"one sentence describing the tailoring focus","keywords":["keyword one","keyword two"]}

Job:
Title: ${job.title || ''}
Company: ${job.company || ''}
Platform: ${job.platform || ''}
Location: ${job.location || ''}
URL: ${job.url || ''}
Description:
${job.description || ''}

Source resume:
${sourceResume}

Profile context:
${context || '(none)'}

Career detail:
${careerDetail || '(none)'}`;
}

function upsertTailoredResumeRow(db, row) {
  db.prepare(`
    INSERT INTO tailored_resumes (
      job_id, status, source_variant, source_resume_path, resume_md_path,
      resume_html_path, resume_pdf_path, metadata_path, keywords_json,
      summary, error, generated_at, updated_at
    ) VALUES (
      @job_id, @status, @source_variant, @source_resume_path, @resume_md_path,
      @resume_html_path, @resume_pdf_path, @metadata_path, @keywords_json,
      @summary, @error, @generated_at, datetime('now')
    )
    ON CONFLICT(job_id) DO UPDATE SET
      status=excluded.status,
      source_variant=excluded.source_variant,
      source_resume_path=excluded.source_resume_path,
      resume_md_path=excluded.resume_md_path,
      resume_html_path=excluded.resume_html_path,
      resume_pdf_path=excluded.resume_pdf_path,
      metadata_path=excluded.metadata_path,
      keywords_json=excluded.keywords_json,
      summary=excluded.summary,
      error=excluded.error,
      generated_at=excluded.generated_at,
      updated_at=datetime('now')
  `).run(row);
}

function parseTailoredResumeRow(row) {
  if (!row) return null;
  let keywords = [];
  try { keywords = JSON.parse(row.keywords_json || '[]'); } catch (_) {}
  return { ...row, keywords };
}

function getTailoredResume(db, jobId) {
  return parseTailoredResumeRow(db.prepare('SELECT * FROM tailored_resumes WHERE job_id = ?').get(jobId));
}

async function generateTailoredResume(db, job, {
  force = false,
  profileDir = baseDir,
  renderPdf = true,
  gemini = callGemini,
} = {}) {
  if (!job?.id) throw new Error('job id required');

  const jlog = log.child({ jobId: job.id, company: job.company });

  const existing = getTailoredResume(db, job.id);
  if (existing && existing.status === 'ready' && existing.resume_pdf_path && fs.existsSync(existing.resume_pdf_path) && !force) {
    jlog.debug('Using cached resume', { variant: existing.source_variant });
    return existing;
  }

  const paths = artifactPaths(job.id, profileDir);
  const source = selectSourceResumeVariant(job, profileDir);
  jlog.info('Generation started', { variant: source.variant, renderPdf });
  const t = log.timer();
  const generatedAt = nowIso();

  try {
    upsertTailoredResumeRow(db, {
      job_id: job.id,
      status: 'generating',
      source_variant: source.variant,
      source_resume_path: source.path,
      resume_md_path: paths.markdown,
      resume_html_path: paths.html,
      resume_pdf_path: renderPdf ? paths.pdf : null,
      metadata_path: paths.metadata,
      keywords_json: '[]',
      summary: null,
      error: null,
      generated_at: generatedAt,
    });

    const sourceResume = readUtf8(source.path);
    if (!sourceResume) throw new Error(`Source resume not found: ${source.fileName}`);

    const prompt = buildPrompt({
      job,
      sourceResume,
      context: readUtf8(path.join(profileDir, 'context.md')),
      careerDetail: readUtf8(path.join(profileDir, 'career-detail.md')),
    });

    const response = await gemini(prompt);
    const parsed = parseGeminiJson(response);
    const resumeMarkdown = String(parsed.resume_markdown || '').trim();
    if (!resumeMarkdown.startsWith('# ')) {
      throw new Error('Tailored resume response did not include full markdown resume');
    }

    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 24)
      : [];
    const summary = String(parsed.summary || '').trim();
    const html = renderResumeMarkdownToHtml(resumeMarkdown, { profileDir });

    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.markdown, resumeMarkdown + '\n');
    fs.writeFileSync(paths.html, html);
    if (renderPdf) {
      await writeResumePdf({ html, outputPath: paths.pdf });
    }

    const metadata = {
      jobId: job.id,
      title: job.title || null,
      company: job.company || null,
      url: job.url || null,
      generatedAt,
      sourceVariant: source.variant,
      sourceResumePath: source.path,
      keywords,
      summary,
    };
    fs.writeFileSync(paths.metadata, JSON.stringify(metadata, null, 2) + '\n');

    upsertTailoredResumeRow(db, {
      job_id: job.id,
      status: 'ready',
      source_variant: source.variant,
      source_resume_path: source.path,
      resume_md_path: paths.markdown,
      resume_html_path: paths.html,
      resume_pdf_path: renderPdf ? paths.pdf : null,
      metadata_path: paths.metadata,
      keywords_json: JSON.stringify(keywords),
      summary,
      error: null,
      generated_at: generatedAt,
    });

    jlog.info('Generation done', { variant: source.variant, keywords: keywords.length, ms: t() });
    return getTailoredResume(db, job.id);
  } catch (error) {
    jlog.error('Generation failed', { error: error.message, variant: source.variant, ms: t() });
    upsertTailoredResumeRow(db, {
      job_id: job.id,
      status: 'failed',
      source_variant: source.variant,
      source_resume_path: source.path,
      resume_md_path: paths.markdown,
      resume_html_path: paths.html,
      resume_pdf_path: renderPdf ? paths.pdf : null,
      metadata_path: paths.metadata,
      keywords_json: '[]',
      summary: null,
      error: error.message,
      generated_at: generatedAt,
    });
    throw error;
  }
}

module.exports = {
  artifactPaths,
  buildPrompt,
  generateTailoredResume,
  getTailoredResume,
  parseGeminiJson,
  selectSourceResumeVariant,
};
