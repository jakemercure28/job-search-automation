#!/usr/bin/env node
/**
 * generate-resume.js
 * Generates a resume PDF from a profile's resume.md
 *
 * Usage: node generate-resume.js
 * Output: profiles/example/resume.pdf (default), or JOB_PROFILE_DIR/resume.pdf
 */

'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profileDir = process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example');
const RESUME_SCALE = parseFloat(process.env.RESUME_SCALE) || 0.96;

// Variants to generate: [inputMd, outputPdf]
const VARIANTS = [
  ['resume.md',       'resume.pdf'],
  ['resume-devops.md','resume-devops.pdf'],
  ['resume-ai.md',    'resume-ai.pdf'],
].map(([md, pdf]) => [path.join(profileDir, md), path.join(profileDir, pdf)])
 .filter(([md]) => fs.existsSync(md));

// Load optional profile-specific CSS overrides (profiles/<name>/resume.css)
const profileCssPath = path.join(profileDir, 'resume.css');
const PROFILE_CSS = fs.existsSync(profileCssPath) ? fs.readFileSync(profileCssPath, 'utf8') : '';

// ---------------------------------------------------------------------------
// Parse resume.md into structured sections
// ---------------------------------------------------------------------------

function parseResume(md) {
  const lines = md.split('\n');
  const resume = { name: '', contact: '', sections: [] };
  let current = null;
  let i = 0;

  // First line: # Name
  while (i < lines.length && !lines[i].trim()) i++;
  resume.name = lines[i++].replace(/^#\s*/, '').trim();

  // Second non-empty line: contact
  while (i < lines.length && !lines[i].trim()) i++;
  resume.contact = lines[i++].trim();

  for (; i < lines.length; i++) {
    const line = lines[i];

    // H2 = section header (## Summary, ## Experience, etc.)
    if (/^##\s/.test(line)) {
      current = { title: line.replace(/^##\s*/, '').trim().toUpperCase(), entries: [], type: 'section' };
      resume.sections.push(current);
      continue;
    }

    if (!current) continue;

    // H3 = job header (### Title — Company / Location)
    if (/^###\s/.test(line)) {
      const raw = line.replace(/^###\s*/, '').trim();
      // "Title — Company / Location"
      const dashMatch = raw.match(/^(.+?)\s+[—–-]+\s+(.+)$/);
      current.entries.push({
        type: 'job',
        raw,
        title: dashMatch ? dashMatch[1].trim() : raw,
        company: dashMatch ? dashMatch[2].trim() : '',
        date: '',
        subtitle: '',
        bullets: [],
      });
      continue;
    }

    const lastEntry = current.entries[current.entries.length - 1];

    // **Date** line (bold date after job header)
    if (/^\*\*[A-Z][a-z]/.test(line) || /^\*\*[A-Z][a-z0-9 –-]+\*\*$/.test(line)) {
      if (lastEntry && lastEntry.type === 'job') {
        lastEntry.date = line.replace(/\*\*/g, '').trim();
        continue;
      }
    }

    // *subtitle* line (italic)
    if (/^\*[^*]/.test(line) && line.endsWith('*') && !line.startsWith('**')) {
      if (lastEntry && lastEntry.type === 'job') {
        lastEntry.subtitle = line.replace(/^\*|\*$/g, '').trim();
        continue;
      }
    }

    // Bullet point
    if (/^[-*]\s/.test(line)) {
      const text = line.replace(/^[-*]\s/, '').trim();
      if (lastEntry && lastEntry.type === 'job') {
        lastEntry.bullets.push(text);
      } else {
        // Bullets directly in section (e.g., Summary isn't really bullets but just in case)
        current.entries.push({ type: 'bullet', text });
      }
      continue;
    }

    // Plain text (Summary paragraph, Skills lines, Education)
    if (line.trim() && line !== '---') {
      // Skills lines: **Label:** content
      if (/^\*\*[A-Za-z/& ]+:\*\*/.test(line)) {
        current.entries.push({ type: 'skill', text: line.trim() });
      } else if (current.entries.length > 0 && current.entries[current.entries.length - 1].type === 'paragraph') {
        current.entries[current.entries.length - 1].text += ' ' + line.trim();
      } else {
        current.entries.push({ type: 'paragraph', text: line.trim() });
      }
    }
  }

  return resume;
}

// ---------------------------------------------------------------------------
// Render inline markdown (bold/italic) to HTML
// ---------------------------------------------------------------------------

function inlineMd(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ---------------------------------------------------------------------------
// Build HTML
// ---------------------------------------------------------------------------

function buildHtml(resume) {
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 8.6pt;
    line-height: 1.26;
    color: #222;
    padding: 0.34in 0.48in 0.2in 0.48in;
  }

  /* Header */
  .name {
    font-size: 19pt;
    font-weight: bold;
    text-align: center;
    letter-spacing: 0.5px;
  }
  .contact {
    font-size: 8.3pt;
    text-align: center;
    color: #444;
    margin-top: 2px;
    margin-bottom: 5px;
  }

  /* Section headers */
  .section-header {
    font-size: 8.6pt;
    font-weight: bold;
    color: #1a56a0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    border-bottom: 1px solid #1a56a0;
    padding-bottom: 1px;
    margin-top: 9px;
    margin-bottom: 2px;
  }

  /* Job entry */
  .job-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 7px;
  }
  .job-title-company {
    font-size: 8.6pt;
    font-weight: bold;
  }
  .job-date {
    font-size: 8.3pt;
    color: #555;
    white-space: nowrap;
    margin-left: 8px;
    flex-shrink: 0;
  }
  .job-subtitle {
    font-style: italic;
    font-size: 8.3pt;
    color: #444;
    margin-top: 0px;
    margin-bottom: 1px;
  }

  /* Bullets */
  ul {
    margin-left: 12px;
    margin-top: 1px;
    margin-bottom: 0px;
  }
  li {
    margin-bottom: 1px;
    padding-left: 1px;
  }
  li::marker {
    font-size: 6pt;
  }

  /* Summary */
  .summary-text {
    margin-top: 1px;
    margin-bottom: 1px;
  }

  /* Skills */
  .skill-line {
    margin-bottom: 0.5px;
  }

  /* Education */
  .edu-text {
    font-weight: bold;
  }

${PROFILE_CSS}
</style>
</head>
<body>

<div class="name">${inlineMd(resume.name)}</div>
<div class="contact">${inlineMd(resume.contact)}</div>
`;

  for (const section of resume.sections) {
    html += `<div class="section-header">${section.title}</div>\n`;

    for (const entry of section.entries) {
      if (entry.type === 'job') {
        // Split "Title — Company / Location" for display
        const titlePart = entry.title;
        const companyPart = entry.company;
        html += `<div class="job-header">
  <span class="job-title-company"><span class="job-title">${inlineMd(titlePart)}</span>${companyPart ? `  &nbsp; ${inlineMd(companyPart)}` : ''}</span>
  <span class="job-date">${inlineMd(entry.date)}</span>
</div>\n`;
        if (entry.subtitle) {
          html += `<div class="job-subtitle">${inlineMd(entry.subtitle)}</div>\n`;
        }
        if (entry.bullets.length > 0) {
          html += `<ul>\n`;
          for (const b of entry.bullets) {
            html += `  <li>${inlineMd(b)}</li>\n`;
          }
          html += `</ul>\n`;
        }
      } else if (entry.type === 'skill') {
        html += `<div class="skill-line">${inlineMd(entry.text)}</div>\n`;
      } else if (entry.type === 'paragraph') {
        const cls = section.title === 'SUMMARY' ? 'summary-text' : 'edu-text';
        html += `<div class="${cls}">${inlineMd(entry.text)}</div>\n`;
      } else if (entry.type === 'bullet') {
        html += `<ul><li>${inlineMd(entry.text)}</li></ul>\n`;
      }
    }
  }

  html += `</body></html>`;
  return html;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const [RESUME_PATH, OUTPUT_PATH] of VARIANTS) {
      const md = fs.readFileSync(RESUME_PATH, 'utf8');
      const resume = parseResume(md);
      const html = buildHtml(resume);

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: OUTPUT_PATH,
        format: 'Letter',
        printBackground: false,
        scale: RESUME_SCALE,
      });
      await page.close();
      console.log(`PDF generated: ${OUTPUT_PATH}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error generating PDF:', err.message);
  process.exit(1);
});
