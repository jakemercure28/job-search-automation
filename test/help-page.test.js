'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { renderHelpPage } = require('../lib/html/help-page');

describe('help page', () => {
  it('renders the npm command reference from the shared catalog', () => {
    const html = renderHelpPage();

    assert.match(html, /NPM Commands/);
    assert.match(html, /Which Command To Run/);
    assert.match(html, /npm run daily/);
    assert.match(html, /npm run refresh/);
    assert.match(html, /npm run apply -- prep --job=&lt;id&gt;/);
    assert.match(html, /--skip-rejection-sync/);
  });
});
