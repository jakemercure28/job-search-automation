'use strict';

const { sleep, safeFetch, stripHtml } = require('../lib/utils');
const { MAX_DESCRIPTION_LENGTH } = require('../config/constants');
const { matchesSearchTerms } = require('../lib/scraper-utils');
const { SCRAPER_DELAY_RSS_MS } = require('../config/constants');

/**
 * Extract text content from an XML tag, handling both CDATA and plain text.
 * Returns empty string if tag not found.
 */
function extractTag(xml, tagName) {
  const cdataRe = new RegExp(`<${tagName}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tagName}>`);
  const plainRe = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`);
  const match = xml.match(cdataRe) || xml.match(plainRe);
  return match ? match[1].trim() : '';
}

async function scrapeWWR() {
  const jobs = [];
  const feeds = [
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
    'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss',
  ];

  for (const feedUrl of feeds) {
    const res = await safeFetch(feedUrl, {}, `wwr/${feedUrl}`);
    if (!res) { await sleep(SCRAPER_DELAY_RSS_MS); continue; }

    let xml;
    try { xml = await res.text(); } catch { await sleep(SCRAPER_DELAY_RSS_MS); continue; }

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    for (const item of items) {
      const title = extractTag(item, 'title');
      const link = extractTag(item, 'link');
      const pubDate = extractTag(item, 'pubDate');
      const desc = extractTag(item, 'description');

      if (!title || !link) continue;

      // WWR title format: "Company Name: Job Title"
      const colonIdx = title.indexOf(':');
      const company = colonIdx > 0 ? title.slice(0, colonIdx).trim() : '';
      const jobTitle = colonIdx > 0 ? title.slice(colonIdx + 1).trim() : title;

      if (!matchesSearchTerms(jobTitle)) continue;

      jobs.push({
        id: `wwr-${Buffer.from(link).toString('base64').slice(0, 16)}`,
        platform: 'WeWorkRemotely',
        title: jobTitle,
        company,
        url: link,
        postedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        description: stripHtml(desc).slice(0, MAX_DESCRIPTION_LENGTH),
        location: 'Remote',
      });
    }

    await sleep(SCRAPER_DELAY_RSS_MS);
  }

  return jobs;
}

module.exports = { scrapeWWR };
