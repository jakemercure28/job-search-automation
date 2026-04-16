'use strict';

const path = require('path');

const baseDir = process.env.JOB_PROFILE_DIR || path.join(__dirname, '..', 'profiles', 'example');
const dbPath = process.env.JOB_DB_PATH || path.join(baseDir, 'jobs.db');
const jobsJsonPath = path.join(baseDir, 'jobs.json');
const publicDir = path.join(__dirname, '..', 'public');
const transcriptsDir = path.join(__dirname, '..', 'transcripts');

module.exports = { baseDir, dbPath, jobsJsonPath, publicDir, transcriptsDir };
