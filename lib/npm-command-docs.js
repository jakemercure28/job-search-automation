'use strict';

const COMMAND_GROUPS = [
  {
    id: 'daily',
    title: 'Daily workflow',
    description: 'Normal refresh commands for keeping the active profile up to date.',
    commands: [
      {
        command: 'npm run daily',
        description: 'Runs the scheduled multi-profile daily workflow.',
        when: 'Use this for the full scheduled scrape, pipeline, scoring retry, closed-job checks, market research, slug validation, and context update chain.',
        flags: [],
      },
      {
        command: 'npm run refresh',
        description: 'Runs the local active-profile refresh flow.',
        when: 'Use this from your MacBook when you want the current profile refreshed without looping over every profile.',
        flags: [
          '--skip-descriptions',
          '--skip-closed-check',
          '--skip-market-research',
          '--skip-rejection-sync',
          '--with-slug-check',
        ],
      },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Start and use the local dashboard server.',
    commands: [
      {
        command: 'npm start',
        description: 'Starts the dashboard HTTP server.',
        when: 'Use this when you want to inspect jobs, move pipeline stages, view analytics, or use the web help page.',
        flags: [],
      },
    ],
  },
  {
    id: 'scraping-scoring',
    title: 'Scraping and scoring',
    description: 'Lower-level pipeline pieces for collecting, importing, and scoring jobs.',
    commands: [
      {
        command: 'npm run scrape',
        description: 'Collects jobs from configured sources and writes the active profile jobs JSON file.',
        when: 'Use this when you only need to refresh scraped listings before deciding whether to import them.',
        flags: [],
      },
      {
        command: 'npm run pipeline',
        description: 'Imports the active jobs JSON file, dedupes records, scores jobs, and classifies application complexity.',
        when: 'Use this after scraping, or after manually editing the active jobs JSON file.',
        flags: [],
      },
      {
        command: 'npm run score',
        description: 'Runs the standalone scorer against JSON job input.',
        when: 'Use this for direct scoring experiments outside the normal database pipeline.',
        flags: [],
      },
      {
        command: 'npm run retry-unscored',
        description: 'Retries scoring for jobs that are still missing scores.',
        when: 'Use this after transient AI failures or when you want to chip away at unscored jobs without a full pipeline run.',
        flags: ['--limit=<n>'],
      },
    ],
  },
  {
    id: 'application',
    title: 'Application workflow',
    description: 'Manual and assisted application commands.',
    commands: [
      {
        command: 'npm run apply -- list',
        description: 'Lists active jobs with score, status, stage, and URL.',
        when: 'Use this to pick the next job for manual prep or application work.',
        flags: ['--status=<status>', '--company=<text>', '--title=<text>', '--min-score=<n>', '--limit=<n>', '--json'],
      },
      {
        command: 'npm run apply -- prep --job=<id>',
        description: 'Generates application prep for one job.',
        when: 'Use this before filling a manual application or using the bookmarklet payload.',
        flags: ['--force', '--json'],
      },
      {
        command: 'npm run apply -- resume --job=<id>',
        description: 'Generates a tailored resume artifact for one job.',
        when: 'Use this when an application needs a job-specific resume before submission.',
        flags: ['--force', '--no-pdf', '--json'],
      },
      {
        command: 'npm run apply -- show --job=<id>',
        description: 'Shows one job URL plus prep and tailored-resume status.',
        when: 'Use this to verify what has already been generated before applying.',
        flags: ['--json'],
      },
      {
        command: 'npm run apply -- apply --job=<id>',
        description: 'Opens a headed browser, fills supported ATS forms, and pauses for review and submission.',
        when: 'Use this for supported Greenhouse, Lever, or Ashby applications that should be assisted but not blindly submitted.',
        flags: ['--force', '--skip-resume'],
      },
      {
        command: 'npm run resume',
        description: 'Regenerates the base resume PDF from the active profile resume markdown.',
        when: 'Use this after editing the base resume markdown or stylesheet.',
        flags: [],
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    description: 'Occasional support commands for inbox sync, generated assets, validation, and tests.',
    commands: [
      {
        command: 'npm run sync-rejections',
        description: 'Runs a one-shot Gmail rejection email sync.',
        when: 'Use this to update applied jobs from rejection emails without waiting for the dashboard poller.',
        flags: ['--dry-run', '--classify-only', '--replay', '--skip-trash', '--lookback-days=<n>', '--max-messages=<n>', '--mailbox=<name>', '--match=<text>'],
      },
      {
        command: 'npm run build:bookmarklet',
        description: 'Builds the browser bookmarklet from the current environment.',
        when: 'Use this after changing dashboard URL settings or bookmarklet source code.',
        flags: [],
      },
      {
        command: 'npm run validate-slugs',
        description: 'Checks configured ATS company slugs.',
        when: 'Use this when scraper coverage looks suspicious or after editing company slug lists.',
        flags: ['--ats <name>', '--broken-only'],
      },
      {
        command: 'npm run validate-slugs:broken',
        description: 'Checks configured ATS company slugs and prints only broken entries.',
        when: 'Use this for a quieter health check focused on fixes you need to make.',
        flags: [],
      },
      {
        command: 'npm test',
        description: 'Runs the Node test suite.',
        when: 'Use this before committing changes.',
        flags: [],
      },
    ],
  },
];

function cloneGroups(groups) {
  return groups.map((group) => ({
    ...group,
    commands: group.commands.map((command) => ({ ...command, flags: [...command.flags] })),
  }));
}

function searchableText(value) {
  if (Array.isArray(value)) return value.join(' ');
  return value == null ? '' : String(value);
}

function commandMatches(command, needle) {
  return [
    command.command,
    command.description,
    command.when,
    command.flags,
  ].some((value) => searchableText(value).toLowerCase().includes(needle));
}

function groupMatches(group, needle) {
  return [
    group.id,
    group.title,
    group.description,
  ].some((value) => searchableText(value).toLowerCase().includes(needle));
}

function getCommandGroups() {
  return cloneGroups(COMMAND_GROUPS);
}

function filterCommandGroups(query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return getCommandGroups();

  const exactGroupMatches = COMMAND_GROUPS.filter((group) => {
    return group.id.toLowerCase() === needle || group.title.toLowerCase() === needle;
  });
  if (exactGroupMatches.length) return cloneGroups(exactGroupMatches);

  return COMMAND_GROUPS
    .map((group) => {
      if (groupMatches(group, needle)) {
        return {
          ...group,
          commands: group.commands.map((command) => ({ ...command, flags: [...command.flags] })),
        };
      }

      const commands = group.commands
        .filter((command) => commandMatches(command, needle))
        .map((command) => ({ ...command, flags: [...command.flags] }));
      return commands.length ? { ...group, commands } : null;
    })
    .filter(Boolean);
}

function flattenCommands(groups = COMMAND_GROUPS) {
  return groups.flatMap((group) => group.commands.map((command) => ({
    group: group.id,
    groupTitle: group.title,
    ...command,
    flags: [...command.flags],
  })));
}

module.exports = {
  filterCommandGroups,
  flattenCommands,
  getCommandGroups,
};
