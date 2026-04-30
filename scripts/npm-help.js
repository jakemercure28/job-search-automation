#!/usr/bin/env node
'use strict';

const { filterCommandGroups } = require('../lib/npm-command-docs');

function parseArgs(argv) {
  const filters = [];
  let json = false;
  let help = false;

  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else {
      filters.push(arg);
    }
  }

  return { filters, help, json };
}

function formatFlags(flags) {
  return flags.length ? flags.join(', ') : 'none';
}

function formatCommandHelp(groups, { filter = '' } = {}) {
  const lines = ['NPM Commands'];
  if (filter) lines.push(`Filter: ${filter}`);
  lines.push('');

  if (!groups.length) {
    lines.push('No commands matched.');
    return lines.join('\n');
  }

  for (const group of groups) {
    lines.push(group.title);
    lines.push(`  ${group.description}`);
    lines.push('');

    for (const item of group.commands) {
      lines.push(`  ${item.command}`);
      lines.push(`    What: ${item.description}`);
      lines.push(`    Use when: ${item.when}`);
      lines.push(`    Flags: ${formatFlags(item.flags)}`);
      lines.push('');
    }
  }

  lines.push('Use `npm run help -- --json` for machine-readable output.');
  return lines.join('\n');
}

function printUsage() {
  console.log(`Usage: npm run help -- [filter] [--json]

Prints documentation for package scripts. Filters match group names, commands,
descriptions, use cases, and flags.

Examples:
  npm run help
  npm run help -- apply
  npm run help -- scoring
  npm run help -- --json
`);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }

  const filter = args.filters.join(' ').trim();
  const groups = filterCommandGroups(filter);

  if (args.json) {
    console.log(JSON.stringify({ filter, groups }, null, 2));
    return;
  }

  console.log(formatCommandHelp(groups, { filter }));
}

if (require.main === module) {
  main();
}

module.exports = {
  formatCommandHelp,
  main,
  parseArgs,
};
