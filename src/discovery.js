'use strict';

/**
 * Topic discovery pulls candidates from live, keyless public sources so the
 * whole system works with zero API keys configured:
 *   - Hacker News (Algolia search API) for "what's happening right now"
 *   - arXiv (cs.AI / cs.CR / cs.LG) for fresh research
 * Each candidate is normalized into { title, url, source, publishedAt, summary }.
 */

async function safeFetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function safeFetchText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

async function fetchHackerNews(interestKeywords) {
  const candidates = [];
  // Query a handful of interest keywords against HN's search API, most-recent first.
  const queries = interestKeywords.slice(0, 5);
  for (const q of queries) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=6`;
    const data = await safeFetchJson(url);
    if (!data || !Array.isArray(data.hits)) continue;
    for (const hit of data.hits) {
      if (!hit.title) continue;
      candidates.push({
        title: hit.title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'Hacker News',
        publishedAt: hit.created_at || new Date().toISOString(),
        summary: hit.story_text ? hit.story_text.slice(0, 400) : '',
        points: hit.points || 0
      });
    }
  }
  return candidates;
}

function parseArxivEntries(xml) {
  if (!xml) return [];
  const entries = [];
  const entryBlocks = xml.split('<entry>').slice(1);
  for (const block of entryBlocks) {
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1];
    const link = (block.match(/<id>([\s\S]*?)<\/id>/) || [])[1];
    const published = (block.match(/<published>([\s\S]*?)<\/published>/) || [])[1];
    if (title) {
      entries.push({
        title: title.replace(/\s+/g, ' ').trim(),
        url: link ? link.trim() : '',
        source: 'arXiv',
        publishedAt: published || new Date().toISOString(),
        summary: summary ? summary.replace(/\s+/g, ' ').trim().slice(0, 500) : '',
        points: 0
      });
    }
  }
  return entries;
}

async function fetchArxiv() {
  const url = 'http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CR+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=15';
  const xml = await safeFetchText(url);
  return parseArxivEntries(xml);
}

async function discoverCandidates(persona) {
  const [hn, arxiv] = await Promise.all([
    fetchHackerNews(persona.interests),
    fetchArxiv()
  ]);
  const all = [...hn, ...arxiv];
  // De-dupe by normalized title
  const seen = new Set();
  const unique = [];
  for (const c of all) {
    const key = c.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  return unique;
}

module.exports = { discoverCandidates };
