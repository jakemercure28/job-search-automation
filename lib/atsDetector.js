'use strict';

// Detects if a URL is a direct ATS link.
// Returns { platform, company } if matched, otherwise null.
const ATS_PATTERNS = [
  {
    platform: 'Ashby',
    // https://jobs.ashbyhq.com/{company}/...
    re: /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/,
  },
  {
    platform: 'Greenhouse',
    // https://boards.greenhouse.io/{company}/jobs/...
    // https://job-boards.greenhouse.io/{company}/...
    re: /^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/,
  },
  {
    platform: 'Lever',
    // https://jobs.lever.co/{company}/...
    re: /^https?:\/\/jobs\.lever\.co\/([^/?#]+)/,
  },
  {
    platform: 'Workable',
    // https://apply.workable.com/{company}/...
    re: /^https?:\/\/apply\.workable\.com\/([^/?#]+)/,
  },
  {
    platform: 'Workday',
    // https://company.wd5.myworkdayjobs.com/... or https://company.myworkdayjobs.com/...
    re: /^https?:\/\/([^/.]+)\.(?:wd\d+\.|)myworkdayjobs\.com\//,
  },
  {
    platform: 'Rippling',
    // https://ats.rippling.com/{company}/jobs/...
    re: /^https?:\/\/ats\.rippling\.com\/([^/?#]+)\//,
  },
];

function detectAts(url) {
  if (!url) return null;
  if (/[?&]gh_jid=\d+/.test(url)) {
    return { platform: 'Greenhouse', company: null };
  }
  for (const { platform, re } of ATS_PATTERNS) {
    const m = url.match(re);
    if (m) return { platform, company: m[1] };
  }
  return null;
}

module.exports = { detectAts };
