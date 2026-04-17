'use strict';

const { getJobById } = require('../db');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1_048_576) { req.destroy(); reject(new Error('request body too large')); return; }
      body += c;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
  });
}

function jsonOk(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function jsonError(res, status, msg) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: msg }));
}

function route(handler) {
  return async (req, res, db, url) => {
    try { await handler(req, res, db, url); }
    catch (e) { jsonError(res, 500, e.message); }
  };
}

function postRoute(handler) {
  return route(async (req, res, db) => {
    const body = await parseBody(req);
    await handler(body, res, db);
  });
}

function requireJob(db, id, res) {
  const job = getJobById(db, id);
  if (!job) { jsonError(res, 404, 'job not found'); return null; }
  return job;
}

module.exports = {
  parseBody,
  jsonOk,
  jsonError,
  route,
  postRoute,
  requireJob,
};
