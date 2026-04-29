'use strict';

const { loadDashboardEnv } = require('../lib/env');
loadDashboardEnv(require('path').join(__dirname, '..'));

const { getDb } = require('../lib/db');
const { syncRejectionEmails } = require('../lib/rejection-email-sync');

function readFlagValue(arg, name) {
  const prefix = `--${name}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : null;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    classifyOnly: false,
    replay: false,
  };
  const matchTerms = [];

  for (const arg of argv) {
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--classify-only') {
      options.classifyOnly = true;
      continue;
    }
    if (arg === '--replay') {
      options.replay = true;
      continue;
    }
    if (arg === '--skip-trash') {
      options.skipTrash = true;
      continue;
    }

    const lookbackDays = readFlagValue(arg, 'lookback-days');
    if (lookbackDays != null) {
      options.lookbackDays = Number.parseInt(lookbackDays, 10);
      continue;
    }

    const maxMessages = readFlagValue(arg, 'max-messages');
    if (maxMessages != null) {
      options.maxMessages = Number.parseInt(maxMessages, 10);
      continue;
    }

    const mailbox = readFlagValue(arg, 'mailbox');
    if (mailbox != null) {
      options.mailbox = mailbox;
      continue;
    }

    const match = readFlagValue(arg, 'match');
    if (match != null && match.trim()) {
      matchTerms.push(match.trim().toLowerCase());
    }
  }

  if (options.classifyOnly) options.dryRun = true;
  if (matchTerms.length) {
    options.messageFilter = (message) => {
      const text = [message.subject, message.fromAddress, message.raw].filter(Boolean).join('\n').toLowerCase();
      return matchTerms.some((term) => text.includes(term));
    };
  }

  return options;
}

async function main() {
  const db = getDb();
  const summary = await syncRejectionEmails(db, parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(summary) + '\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
