'use strict';

const CLOSED_TEXT_PATTERNS = [
  /job you are looking for is no longer open/i,
  /job not found/i,
  /no longer (accepting|open|available)/i,
  /job (has been|is) (closed|removed|filled|expired)/i,
  /position (has been|is) (filled|closed)/i,
  /posting.*(expired|removed|closed)/i,
];

const LISTING_PAGE_PATTERNS = [
  /current openings/i,
  /open roles/i,
  /showing \d+ results out of total/i,
  /view all open positions/i,
];

const STANDARD_FIELD_PATTERNS = [
  /first[_\s-]?name/i,
  /last[_\s-]?name/i,
  /full[_\s-]?name/i,
  /^name$/i,
  /email/i,
  /phone/i,
  /resume/i,
  /\bcv\b/i,
  /linkedin/i,
  /location/i,
  /country/i,
];

function matchesStandardField(text) {
  return STANDARD_FIELD_PATTERNS.some((pattern) => pattern.test(text));
}

async function snapshotApplicationPage(page) {
  return page.evaluate((patterns) => {
    const fieldNodes = [...document.querySelectorAll('input, textarea, select')];
    const fieldMeta = fieldNodes.map((node) => ({
      tag: node.tagName.toLowerCase(),
      type: (node.type || '').toLowerCase(),
      id: node.id || '',
      name: node.name || '',
      placeholder: node.getAttribute('placeholder') || '',
      ariaLabel: node.getAttribute('aria-label') || '',
    }));

    const standardFieldCount = fieldMeta.filter((field) => {
      const combined = [field.id, field.name, field.placeholder, field.ariaLabel].join(' ');
      return patterns.some((source) => new RegExp(source, 'i').test(combined));
    }).length;

    return {
      title: document.title,
      url: window.location.href,
      text: document.body.innerText.slice(0, 4000),
      totalFieldCount: fieldMeta.length,
      fileInputCount: fieldMeta.filter((field) => field.type === 'file').length,
      standardFieldCount,
      submitLikeText: [...document.querySelectorAll('button, a')]
        .map((node) => (node.innerText || '').trim())
        .filter(Boolean)
        .filter((text) => /apply|submit/i.test(text))
        .slice(0, 20),
    };
  }, STANDARD_FIELD_PATTERNS.map((pattern) => pattern.source));
}

function detectApplicationPageIssue(platform, snapshot, { sourceUrl = '', jobId = '' } = {}) {
  const pageText = snapshot.text || '';
  const pageUrl = snapshot.url || '';

  if (CLOSED_TEXT_PATTERNS.some((pattern) => pattern.test(pageText))) {
    return 'Job is no longer available';
  }

  if (platform === 'greenhouse' && pageUrl.includes('error=true')) {
    return 'Greenhouse redirected to an error page for this job';
  }

  const redirectedAwayFromJob = Boolean(
    jobId
      && sourceUrl
      && pageUrl !== sourceUrl
      && !pageUrl.includes(jobId)
      && LISTING_PAGE_PATTERNS.some((pattern) => pattern.test(pageText))
  );

  if (redirectedAwayFromJob) {
    return `Redirected away from job ${jobId} to a listing page`;
  }

  const hasLikelyApplicationForm = snapshot.fileInputCount > 0 || snapshot.standardFieldCount >= 2;
  if (!hasLikelyApplicationForm) {
    return `Application form not detected on the ${platform} page`;
  }

  return null;
}

module.exports = {
  detectApplicationPageIssue,
  matchesStandardField,
  snapshotApplicationPage,
};
