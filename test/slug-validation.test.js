'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.join(__dirname, '..');

describe('slug validation configuration', () => {
  it('loads company slugs through active-profile config', () => {
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slug-profile-'));
    fs.writeFileSync(path.join(profileDir, 'companies.js'), `
'use strict';
module.exports = {
  GREENHOUSE_COMPANIES: ['gh-one', 'gh-two'],
  LEVER_COMPANIES: ['lever-one'],
  WORKABLE_COMPANIES: [],
  ASHBY_COMPANIES: [],
  WORKDAY_COMPANIES: [],
  RIPPLING_COMPANIES: ['rippling-one'],
};
`);

    const output = execFileSync(process.execPath, ['-e', `
process.env.JOB_PROFILE_DIR = ${JSON.stringify(profileDir)};
const { atsBatches } = require('./scripts/validate-slugs');
console.log(JSON.stringify(Object.fromEntries(atsBatches().map(([name, items]) => [name, items.length]))));
`], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, JOB_PROFILE_DIR: profileDir },
    });

    assert.deepEqual(JSON.parse(output), {
      Greenhouse: 2,
      Lever: 1,
      Ashby: 0,
      Workable: 0,
      Workday: 0,
      Rippling: 1,
    });
  });

  it('does not hard-code the example companies file', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'validate-slugs.js'), 'utf8');
    assert.match(source, /require\('\.\.\/config\/companies'\)/);
    assert.doesNotMatch(source, /profiles\/example\/companies\.js/);
  });
});

