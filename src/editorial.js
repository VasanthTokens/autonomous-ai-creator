'use strict';

function normalize(str) {
  return (str || '').toLowerCase();
}

function fingerprint(title) {
  return normalize(title).replace(/[^a-z0-9]+/g, ' ').trim();
}

// Words whose presence confirms a story is actually about AI/ML systems,
// not just a topic that happens to share vocabulary with one (e.g. "iOS
// jailbreak" vs "LLM jailbreak"). Used to disambiguate AMBIGUOUS_KEYWORDS.
const AI_ANCHOR_WORDS = [
  'ai', 'a.i.', 'artificial intelligence', 'llm', 'large language model',
  'model', 'models', 'gpt', 'chatgpt', 'claude', 'gemini', 'llama',
  'machine learning', 'ml ', 'neural', 'transformer', 'agentic', 'agent',
  'chatbot', 'genai', 'generative ai', 'openai', 'anthropic', 'deepmind',
  'mistral', 'copilot', 'diffusion model', 'foundation model'
];

// Interest keywords that are common English/tech words outside of an AI
// context (a phone can be "jailbroken", a webapp can have an "exploit",
// any software can have a "CVE", "adversarial" shows up in game theory and
// optimization papers with nothing to do with ML). These only count as a
// real match if an AI-anchor word is also present in the same text —
// otherwise they are a false-positive match on vocabulary, not the beat.
// Each keyword carries its own accurate example for the rejection message.
const AMBIGUOUS_KEYWORDS = new Map([
  ['jailbreak', 'a phone or hardware "jailbreak" is not a model jailbreak'],
  ['exploit', 'a general software "exploit" is not necessarily an AI/model exploit'],
  ['vulnerability', 'a generic software "vulnerability" is not necessarily an AI/model vulnerability'],
  ['cve', 'a CVE in unrelated software is not an AI/model CVE'],
  ['sandbox escape', 'a sandbox escape in unrelated software is not an AI agent sandbox escape'],
  ['privilege escalation', 'privilege escalation in unrelated software is not an AI agent privilege escalation'],
  ['supply chain', 'general software supply-chain news is not AI/model supply-chain risk'],
  ['adversarial', '"adversarial" shows up often in game theory/optimization papers unrelated to adversarial ML'],
  ['guardrail', 'a non-AI "guardrail" (e.g. policy, safety rail) is not an AI guardrail'],
  ['red team', 'general security red-teaming is not necessarily AI red-teaming'],
  ['red-teaming', 'general security red-teaming is not necessarily AI red-teaming']
]);

function hasAiContext(text) {
  return AI_ANCHOR_WORDS.some(w => {
    // Use word-boundary regex, not plain substring — plain .includes() lets
    // short anchors like "ai" false-match inside unrelated words (e.g.
    // "jailbreak" contains the substring "ai").
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    return re.test(text);
  });
}

function keywordScore(candidate, persona) {
  const text = normalize(candidate.title + ' ' + (candidate.summary || ''));
  const aiContext = hasAiContext(text);
  let hits = 0;
  const matched = [];
  const filteredFalsePositives = [];

  for (const kw of persona.interests) {
    const kwLower = kw.toLowerCase();
    if (!text.includes(kwLower)) continue;

    if (AMBIGUOUS_KEYWORDS.has(kwLower) && !aiContext) {
      // Vocabulary matched, but nothing anchors it to AI/ML — treat as a
      // false positive rather than a real editorial match. Carry the
      // keyword's specific example so the rejection reason is accurate.
      filteredFalsePositives.push({ keyword: kw, example: AMBIGUOUS_KEYWORDS.get(kwLower) });
      continue;
    }

    hits += 1;
    matched.push(kw);
  }

  return { hits, matched, filteredFalsePositives };
}

function recencyScore(candidate) {
  const t = Date.parse(candidate.publishedAt);
  if (isNaN(t)) return 0;
  const ageHours = (Date.now() - t) / 36e5;
  if (ageHours < 0) return 0;
  if (ageHours <= 12) return 1;
  if (ageHours <= 48) return 0.7;
  if (ageHours <= 24 * 14) return 0.4;
  return 0.15;
}

// Converts the raw internal score into a 0-100 "conviction" number that's
// easy to reason about externally — this is what turns editorial judgment
// from an opaque yes/no into something a reader (or a judge) can see the
// gradient of.
function convictionFromScore(score) {
  return Math.max(0, Math.min(100, Math.round(score * 10)));
}

/**
 * Editorial judgment: score every candidate against the persona's interest
 * profile + recency + novelty (has this or something near-identical already
 * been published/rejected?), then apply a hard bar. This is what makes the
 * agent "reject topics that don't meet its publishing standards" rather than
 * publishing everything it finds.
 */
function judge(candidates, persona, memoryState) {
  const seenKeys = new Set(memoryState.seenTopicKeys || []);
  const scored = [];
  const rejected = [];

  for (const c of candidates) {
    const fp = fingerprint(c.title);
    if (seenKeys.has(fp)) {
      continue; // already considered before (published or rejected) — skip silently, not a fresh editorial decision
    }

    const { hits, matched, filteredFalsePositives } = keywordScore(c, persona);
    const rec = recencyScore(c);
    const engagement = Math.min((c.points || 0) / 200, 1); // HN points, capped
    const score = hits * 2 + rec * 2 + engagement;

    if (hits === 0 && filteredFalsePositives.length > 0) {
      const kwList = filteredFalsePositives.map(f => f.keyword).join(', ');
      const examples = filteredFalsePositives.map(f => f.example).join('; ');
      rejected.push({
        title: c.title,
        url: c.url,
        conviction: 0,
        reason: `Keyword(s) "${kwList}" matched on vocabulary only — no AI/ML context in the story, so this is not actually on-beat for ${persona.domain} (${examples}).`,
        consideredAt: new Date().toISOString()
      });
      continue;
    }

    if (hits === 0) {
      rejected.push({
        title: c.title,
        url: c.url,
        conviction: 0,
        reason: `No connection to ${persona.domain} coverage areas (${persona.interests.slice(0, 4).join(', ')}, ...). ${persona.editorialBar}`,
        consideredAt: new Date().toISOString()
      });
      continue;
    }

    if (rec < 0.3) {
      rejected.push({
        title: c.title,
        url: c.url,
        conviction: convictionFromScore(hits * 2 + engagement), // keyword/engagement strength minus the recency penalty that sank it
        reason: 'Too stale — relevant keywords matched, but the item is old news relative to the persona\'s "publish what\'s current" standard.',
        consideredAt: new Date().toISOString()
      });
      continue;
    }

    scored.push({ candidate: c, score, conviction: convictionFromScore(score), matchedKeywords: matched, fp });
  }

  scored.sort((a, b) => b.score - a.score);
  return { ranked: scored, rejected };
}

module.exports = { judge, fingerprint };
