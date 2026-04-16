'use strict';

const path = require('path');

const { DASHBOARD_PORT, DAILY_TARGET, GEMINI_DAILY_LIMIT } = require('../../config/constants');
const { baseDir, dbPath, jobsJsonPath, publicDir } = require('../../config/paths');
const { escapeHtml } = require('../utils');

function renderCard({ eyebrow, title, body, bullets = [], code = '', html = '' }) {
  return `
    <article class="help-page-card">
      ${eyebrow ? `<div class="help-page-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
      <h3>${escapeHtml(title)}</h3>
      ${body ? `<p>${body}</p>` : ''}
      ${bullets.length ? `<ul>${bullets.map((item) => `<li>${item}</li>`).join('')}</ul>` : ''}
      ${code ? `<pre><code>${escapeHtml(code)}</code></pre>` : ''}
      ${html}
    </article>
  `;
}

function renderMiniTable(rows) {
  return `
    <div class="help-page-table">
      ${rows.map(([label, value]) => `
        <div class="help-page-table-row">
          <div class="help-page-table-label">${escapeHtml(label)}</div>
          <div class="help-page-table-value">${value}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHelpPage() {
  const profileName = path.basename(baseDir);
  const scheduleVerifiedAt = 'Generated from the active config';
  const architectureDiagram = [
    'host cron / launchd',
    '    |',
    '    +--> run-daily.sh',
    '    |      +--> load repo .env + profile .env',
    '    |      +--> node scraper.js',
    '    |      +--> node pipeline.js',
    '    |      +--> node check-descriptions.js',
    '    |      +--> node check-closed.js',
    '    |      +--> node run-market-research.js',
    '    |      +--> node retry-unscored.js',
    '    |',
    '    +--> run-score-retry.sh',
    '    |      +--> node retry-unscored.js',
    '    |',
    '    +--> LaunchAgent -> start-dashboard.sh -> node dashboard.js',
    '                          +--> GET / renders HTML from lib/html/*',
    '                          +--> POST routes mutate SQLite',
    '                          +--> GET /metrics and /healthz',
    '                          +--> rejection email poller every 5 minutes',
  ].join('\n');

  const routesCode = [
    'GET  /                     dashboard page',
    'GET  /help                 architecture + system docs',
    'POST /pipeline             change stage/status',
    'POST /mark-outreach        toggle reached_out_at',
    'POST /archive              archive a job',
    'GET  /resume               stream resume PDF',
    'GET  /company-notes        read company tags/notes',
    'POST /company-notes        save company tags/notes',
    'GET  /job-description      fetch full JD text',
    'GET  /job-apply-images     inspect apply screenshots',
    'GET  /job-application-prep generated application prep payload/page',
    'POST /job-application-prep generate or refresh prep',
    'GET  /job-bookmarklet.js   autofill bookmarklet payload',
    'POST /market-research      regenerate market research cache',
    'GET  /healthz              DB health probe',
    'GET  /metrics              Prometheus metrics',
  ].join('\n');

  const fileMapCode = [
    'dashboard.js                  HTTP server + route table',
    'lib/dashboard-routes.js       route handlers + dashboard data queries',
    'lib/dashboard-html.js         full dashboard HTML shell',
    'lib/html/*.js                 page fragments (filters, rows, analytics, etc.)',
    'public/dashboard.js           client-side interactions',
    'public/dashboard.css          all dashboard styling',
    'scraper.js                    scrape orchestrator',
    'scrapers/*.js                 platform-specific scrapers',
    'pipeline.js                   insert, dedupe, score, classify, auto-apply, summarize',
    'retry-unscored.js             retry transient score failures',
    'check-closed.js               recheck if posted jobs are still live',
    'run-daily.sh                  scheduled orchestration entrypoint',
    'run-score-retry.sh            hourly scoring retry entrypoint',
    'lib/db.js + lib/db/schema.js  SQLite connection, schema, migrations',
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Search Help</title>
<link rel="stylesheet" href="/public/dashboard.css?v=11">
</head>
<body>
<header class="help-page-header">
  <div class="help-page-header-inner">
    <div>
      <div class="help-page-kicker">System Guide</div>
      <h1>How This Program Works</h1>
      <p>This page documents the actual architecture of the job-search tool: scheduler, server, database, AI steps, dashboard routes, and where the moving pieces live.</p>
    </div>
    <div class="help-page-header-actions">
      <a class="help-page-link-btn" href="/">Back To Dashboard</a>
    </div>
  </div>
</header>

<main class="help-page-shell">
  <section class="help-page-hero">
    <div class="help-page-hero-copy">
      <div class="help-page-chip">Current profile: <strong>${escapeHtml(profileName)}</strong></div>
      <div class="help-page-chip">Dashboard port: <strong>${escapeHtml(String(DASHBOARD_PORT))}</strong></div>
      <div class="help-page-chip">${escapeHtml(scheduleVerifiedAt)}</div>
      <h2>Mental model</h2>
      <p>This is a local-first Node app with no frontend framework and no separate API service. A scheduler kicks off scripts, those scripts update SQLite files in the active profile, and the dashboard is a plain HTTP server that reads the same DB and renders HTML on demand.</p>
    </div>
    <div class="help-page-diagram">
      <div class="help-page-diagram-label">End-to-end flow</div>
      <pre><code>${escapeHtml(architectureDiagram)}</code></pre>
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Runtime</div>
      <h2>What Is Running And When</h2>
    </div>
    <div class="help-page-grid help-page-grid-3">
      ${renderCard({
        eyebrow: 'Host cron',
        title: 'Suggested scheduled jobs',
        body: 'The pipeline is designed to run under host cron (or launchd / systemd). A typical cron setup looks like:',
        bullets: [
          '<code>7 8 * * *</code> runs <code>run-daily.sh</code>',
          '<code>7 14 * * *</code> runs <code>run-daily.sh</code>',
          '<code>7 20 * * *</code> runs <code>run-daily.sh</code>',
          '<code>30 * * * *</code> runs <code>run-score-retry.sh</code>',
          'Redirect stdout and stderr to a log file of your choice',
        ],
      })}
      ${renderCard({
        eyebrow: 'LaunchAgent',
        title: 'Dashboard process supervision',
        body: 'The UI is kept alive by a macOS LaunchAgent, not by cron. The LaunchAgent calls <code>start-dashboard.sh</code>, which kills anything already on the port and then execs Node.',
        bullets: [
          '<code>RunAtLoad=true</code> so it starts when the user session loads',
          '<code>KeepAlive=true</code> so launchd restarts it if it crashes',
          'stdout and stderr both go to <code>/tmp/job-search-dashboard.log</code>',
          'The process working directory is the repo root',
        ],
      })}
      ${renderCard({
        eyebrow: 'In-process background work',
        title: 'Rejection email polling',
        body: 'When the dashboard boots, it also tries to start Gmail rejection syncing inside the same Node process.',
        bullets: [
          'Default initial delay: <code>10s</code>',
          'Default poll interval: <code>5 minutes</code>',
          'It only starts if Gmail credentials are present in the environment',
          'Matched rejection emails mark the job <code>stage=rejected</code> and <code>status=archived</code>',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Pipeline</div>
      <h2>What <code>run-daily.sh</code> Actually Does</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'Per-profile loop',
        title: 'Profile isolation is env-driven',
        body: 'The script loops through <code>profiles/*/</code> and only processes directories that have their own <code>.env</code>. For each profile it unsets the profile-specific env vars, sources repo <code>.env</code>, then sources that profile&apos;s <code>.env</code>.',
        bullets: [
          'The active DB path comes from <code>JOB_DB_PATH</code>',
          'The active profile directory comes from <code>JOB_PROFILE_DIR</code>',
          'The dashboard port comes from <code>DASHBOARD_PORT</code>',
          'If no env overrides are present, the app falls back to <code>profiles/example</code>',
        ],
      })}
      ${renderCard({
        eyebrow: 'Execution order',
        title: 'One scheduled run is a chain of scripts',
        bullets: [
          '<code>node scraper.js</code> writes the current profile&apos;s <code>jobs.json</code>',
          '<code>node pipeline.js</code> inserts new jobs, dedupes them, scores them, classifies apply complexity, and may auto-apply',
          '<code>node check-descriptions.js</code> flags suspiciously short job descriptions',
          '<code>node check-closed.js</code> checks whether active jobs have been taken down on their ATS',
          '<code>node run-market-research.js</code> refreshes the market research cache',
          '<code>node retry-unscored.js --limit=25</code> retries transient AI failures',
          'After the profile loop, the repo also runs <code>node validate-slugs.js --broken-only</code> and <code>node update-context.js</code>',
        ],
      })}
      ${renderCard({
        eyebrow: 'Scraping',
        title: 'How jobs get collected',
        body: 'The scrape layer fans out across platform-specific scrapers in parallel, validates the results, deduplicates by URL inside the batch, filters by recency and allowed location, then writes JSON for the pipeline step.',
        bullets: [
          'Current orchestrator includes Greenhouse, Lever, Workable, Wellfound, RemoteOK, Jobicy, Arbeitnow, WeWorkRemotely, Ashby, Workday, Built In, and Rippling',
          'The recency filter uses <code>MAX_AGE_DAYS</code> from the profile config',
          'The profile company lists and search terms live under <code>profiles/&lt;name&gt;/companies.js</code>',
        ],
      })}
      ${renderCard({
        eyebrow: 'Scoring and automation',
        title: 'What happens in <code>pipeline.js</code>',
        bullets: [
          'Dedupes by normalized <code>title + company</code> before insert',
          'Auto-archives some reposted or duplicate records',
          'Scores pending unscored jobs with Gemini and stores <code>score</code> plus reasoning',
          'Auto-archives low scores at or below <code>AUTO_ARCHIVE_THRESHOLD</code> (default fallback <code>4</code>)',
          'Classifies application complexity for scored jobs',
          'Runs the auto-applier for eligible simple ATS jobs',
          'Generates a one-line daily summary and stores it in <code>metadata</code>',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Storage</div>
      <h2>Where The State Lives</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'SQLite',
        title: 'One DB file per profile',
        body: 'This app uses <code>better-sqlite3</code> with a singleton connection. On startup it enables WAL mode, a busy timeout, foreign keys, and then applies schema migrations automatically.',
        html: renderMiniTable([
          ['Active profile dir', `<code>${escapeHtml(baseDir)}</code>`],
          ['Active DB path', `<code>${escapeHtml(dbPath)}</code>`],
          ['Current jobs JSON path', `<code>${escapeHtml(jobsJsonPath)}</code>`],
          ['Static public assets', `<code>${escapeHtml(publicDir)}</code>`],
        ]),
      })}
      ${renderCard({
        eyebrow: 'Core tables',
        title: 'Important tables and what they mean',
        bullets: [
          '<code>jobs</code>: main source of truth for listings, scores, stage, notes, outreach, and apply metadata',
          '<code>metadata</code>: small key/value store for things like <code>schema_version</code> and <code>daily_summary</code>',
          '<code>events</code>: audit trail for stage changes, outreach toggles, archive actions, and auto-apply events',
          '<code>company_notes</code>: tags and notes shared across all jobs from the same company',
          '<code>api_usage</code>: daily AI call counts, used for the dashboard API budget indicator',
          '<code>auto_apply_log</code>: receipts from auto-apply attempts, including dry runs and failures',
          '<code>application_preps</code>: generated question/answer packs for the bookmarklet and prep page',
          '<code>rejection_email_log</code>: audit log of inbox scans and match outcomes',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Server</div>
      <h2>How The Dashboard Is Built</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'Rendering model',
        title: 'Server-rendered HTML, no framework',
        body: 'The dashboard is plain Node HTTP, not Express and not React. <code>dashboard.js</code> owns the route table, and <code>lib/dashboard-html.js</code> assembles the page from modules under <code>lib/html/</code>.',
        bullets: [
          'The browser gets server-rendered HTML plus one CSS file and one JS file',
          'Chart.js is loaded from a CDN for the analytics chart',
          'There is no build step, bundler, or client-side router',
          'The Help page is now just another first-class server route',
        ],
      })}
      ${renderCard({
        eyebrow: 'Route surface',
        title: 'HTTP endpoints in the dashboard process',
        body: 'Most of the app is exposed through a small route table in <code>dashboard.js</code>:',
        code: routesCode,
      })}
      ${renderCard({
        eyebrow: 'Request flow',
        title: 'What happens on page load',
        bullets: [
          '<code>handleDashboardPage()</code> validates the requested filter and sort',
          'It queries SQLite for the filtered job set',
          'It separately queries counts, daily chart values, company tags, API usage, slug health, and optional analytics data',
          'The response is assembled into one HTML string and returned as <code>text/html</code>',
        ],
      })}
      ${renderCard({
        eyebrow: 'Mutations',
        title: 'What happens when you click things',
        bullets: [
          'Pipeline dropdown calls <code>POST /pipeline</code>, which updates <code>status</code>, <code>stage</code>, and sometimes <code>applied_at</code> or <code>rejected_at</code>',
          'Outreach button calls <code>POST /mark-outreach</code>, which toggles <code>reached_out_at</code>',
          'Archive calls <code>POST /archive</code>, which flips <code>status</code> to <code>archived</code>',
          'Those mutations also write rows into <code>events</code> so analytics has a timeline',
          'Moving a job to <code>applied</code> or <code>rejected</code> also triggers background rejection-likelihood reasoning',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">AI</div>
      <h2>Where AI Is Used And What It Produces</h2>
    </div>
    <div class="help-page-grid help-page-grid-3">
      ${renderCard({
        eyebrow: 'Scoring',
        title: 'Job fit scoring',
        bullets: [
          'Jobs are scored on a <code>1-10</code> scale',
          'The dashboard budget indicator uses a daily cap of <code>${escapeHtml(String(GEMINI_DAILY_LIMIT))}</code> calls',
          'Failures are tracked with <code>score_attempts</code>, <code>last_score_attempt_at</code>, and <code>score_error</code>',
          'Hourly retry jobs exist specifically so transient model failures do not leave jobs unscored forever',
        ],
      })}
      ${renderCard({
        eyebrow: 'Application support',
        title: 'Prep generation and autofill',
        bullets: [
          'Application prep stores question sets, answers, voice checks, workflow hints, and summaries in <code>application_preps</code>',
          'The bookmarklet pulls that payload from <code>/job-bookmarklet.js</code> and tries to fill ATS forms in the browser',
          'This supports Greenhouse, Lever, and Ashby best',
        ],
      })}
      ${renderCard({
        eyebrow: 'Automation',
        title: 'Auto-apply rules',
        bullets: [
          'Auto-apply is enabled by config and can be disabled with <code>AUTO_APPLY_ENABLED=false</code>',
          'Score threshold is profile-configurable (default <code>8</code>)',
          'Daily cap is profile-configurable (default <code>10</code>)',
          'Only simple applications on supported ATS platforms are eligible',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Job lifecycle</div>
      <h2>How A Single Job Moves Through The System</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'Typical happy path',
        title: 'Most common flow',
        bullets: [
          'Scraper finds a job and writes it to profile <code>jobs.json</code>',
          'Pipeline inserts it into <code>jobs</code> as <code>status=pending</code>',
          'AI adds <code>score</code> and reasoning',
          'Apply complexity is classified as simple or complex',
          'You review it in the dashboard and move it to <code>Applied</code> or archive it',
          'Later stage updates flow through <code>Phone Screen</code>, <code>Interview</code>, <code>Onsite</code>, and <code>Offer</code>',
        ],
      })}
      ${renderCard({
        eyebrow: 'Terminal paths',
        title: 'Ways a job leaves active views',
        bullets: [
          'Low scores can be auto-archived during scoring',
          'Manual archive hides the job but keeps the record',
          '<code>Rejected</code> sets <code>stage=rejected</code> and archives it',
          '<code>Closed</code> is set by <code>check-closed.js</code> when the ATS says the posting is gone',
          'Rejection email sync can also mark applied jobs as rejected automatically',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Navigation</div>
      <h2>What The Dashboard Shows You</h2>
    </div>
    <div class="help-page-grid help-page-grid-3">
      ${renderCard({
        eyebrow: 'Main tabs',
        title: 'Primary filters',
        bullets: [
          '<code>All</code>: every non-archived job',
          '<code>Pending</code>: jobs not yet applied/responded/archived',
          '<code>Applied</code>: jobs with <code>status in (applied, responded)</code>',
          '<code>Interviewing</code>: jobs in phone screen, interview, onsite, or offer',
        ],
      })}
      ${renderCard({
        eyebrow: 'Menu pages',
        title: 'Secondary views',
        bullets: [
          '<code>Stats</code>: funnel, score calibration, comparisons',
          '<code>Auto-Apply Log</code>: recent automated submission attempts',
          '<code>Event Log</code>: audit trail from the <code>events</code> table',
          '<code>Market Research</code>: JD aggregate analysis cache',
          '<code>Help</code>: this page',
        ],
      })}
      ${renderCard({
        eyebrow: 'Top drawer',
        title: 'Live metrics in the header',
        bullets: [
          'Today&apos;s <code>Applied</code> count is manual applies only and compares against the daily target of <code>${escapeHtml(String(DAILY_TARGET))}</code>',
          'The drawer also shows today&apos;s <code>Auto-Applied</code>, <code>Rejected</code>, and <code>Closed</code> counts',
          'API usage reads from <code>api_usage</code>',
          'Per-platform scrape counts exclude jobs already archived out of your queue',
        ],
      })}
    </div>
  </section>

  <section class="help-page-section">
    <div class="help-page-section-head">
      <div class="help-page-kicker">Code map</div>
      <h2>Files Worth Reading First</h2>
    </div>
    <div class="help-page-grid help-page-grid-2">
      ${renderCard({
        eyebrow: 'Architecture map',
        title: 'Key source files',
        code: fileMapCode,
      })}
      ${renderCard({
        eyebrow: 'Good manual commands',
        title: 'Useful entrypoints when debugging',
        code: [
          'npm run daily',
          'npm run retry-unscored',
          'node dashboard.js',
          'node sync-rejection-emails.js --dry-run',
          'node validate-slugs.js --broken-only',
          'node check-closed.js',
        ].join('\n'),
      })}
    </div>
  </section>
</main>
</body>
</html>`;
}

module.exports = { renderHelpPage };
