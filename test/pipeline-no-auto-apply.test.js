'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('pipeline manual apply boundary', () => {
  it('does not import or invoke unattended apply modules', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'pipeline.js'), 'utf8');
    assert.doesNotMatch(source, /auto-applier/);
    assert.doesNotMatch(source, /run-auto-apply/);
    assert.doesNotMatch(source, /submitOne|applyOne|runBatch/);
  });
});
