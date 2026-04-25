/**
 * dashboard.js
 * Local web dashboard for job search review.
 * Usage: node dashboard.js
 * Then open http://localhost:3131 in your browser.
 */

'use strict';

const { loadDashboardEnv } = require('./lib/env');
loadDashboardEnv(__dirname);

const http = require('http');
const fs = require('fs');
const path = require('path');

const { getDb } = require('./lib/db');
const { DASHBOARD_PORT } = require('./config/constants');
const { publicDir } = require('./config/paths');
const log = require('./lib/logger')('dashboard');
const metrics = require('./lib/metrics');
const { startRejectionEmailPoller } = require('./lib/rejection-email-sync');
const { recordStatusSnapshot } = require('./lib/dashboard-insights');
const {
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
  handleMarketResearch,
  handleDismissSlugBanner,
  handleTrackerApi,
} = require('./lib/dashboard-routes');

const PORT = DASHBOARD_PORT;
const db = getDb();

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.pdf': 'application/pdf',
};

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const routes = {
  'POST /pipeline':          handlePipeline,
  'POST /mark-outreach':     handleMarkOutreach,

  'POST /archive':           handleArchive,
  'GET /resume':             handleResume,
  'GET /company-notes':      handleGetCompanyNotes,
  'POST /company-notes':     handleSaveCompanyNotes,
  'GET /job-description':    handleJobDescription,
  'GET /job-apply-images':   handleJobApplyImages,
  'GET /job-apply-image':    handleJobApplyImage,
  'GET /job-application-prep': handleGetApplicationPrep,
  'POST /job-application-prep': handlePrepareApplication,
  'GET /job-application-data': handleJobApplicationData,
  'GET /job-bookmarklet.js': handleJobBookmarkletScript,
  'GET /tailored-resume':    handleTailoredResume,
  'POST /tailored-resume':   handleGenerateTailoredResume,
  'GET /auto-apply-attempt':  handleAutoApplyAttempt,
  'GET /auto-apply-artifact': handleAutoApplyArtifact,
  'POST /market-research':   handleMarketResearch,
  'POST /dismiss-slug-banner': handleDismissSlugBanner,
  'GET /api/tracker':        handleTrackerApi,
  'GET /help':               handleHelpPage,
  'GET /':                   handleDashboardPage,
};

// Refresh gauge metrics from DB periodically
function refreshGauges() {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    for (const row of db.prepare('SELECT platform, COUNT(*) as n FROM jobs WHERE date(created_at) = ? GROUP BY platform').all(today)) {
      metrics.jobsScraped.set({ platform: row.platform }, row.n);
    }
    for (const row of db.prepare("SELECT status, COUNT(*) as n FROM jobs GROUP BY status").all()) {
      metrics.jobsByStatus.set({ status: row.status }, row.n);
    }
    for (const row of db.prepare("SELECT COALESCE(stage, 'none') as stage, COUNT(*) as n FROM jobs WHERE status != 'archived' GROUP BY stage").all()) {
      metrics.jobsByStage.set({ stage: row.stage }, row.n);
    }
    recordStatusSnapshot(db);
  } catch (e) { /* metrics must never crash the server */ }
}
refreshGauges();
setInterval(refreshGauges, 60_000);

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    try {
      db.prepare('SELECT 1').get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // Prometheus metrics endpoint
  if (req.method === 'GET' && url.pathname === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(metrics.serialize());
    return;
  }

  // Serve static files from /public/
  if (req.method === 'GET' && url.pathname.startsWith('/public/')) {
    const filePath = path.join(publicDir, url.pathname.replace('/public/', ''));
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext];
    if (mime && fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    res.writeHead(404); res.end('not found');
    return;
  }

  // API routes
  const handler = routes[`${req.method} ${url.pathname}`];
  if (handler) {
    await handler(req, res, db, url);
    const duration = (Date.now() - start) / 1000;
    metrics.httpRequestsTotal.inc({ method: req.method, path: url.pathname, status: res.statusCode });
    metrics.httpRequestDuration.observe({ method: req.method, path: url.pathname }, duration);
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  log.info('Dashboard running', { url: `http://localhost:${PORT}` });
});

startRejectionEmailPoller(db);
