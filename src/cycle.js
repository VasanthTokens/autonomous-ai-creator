'use strict';

const { v4: uuidv4 } = require('uuid');
const { discoverCandidates } = require('./discovery');
const { judge } = require('./editorial');
const { writePost } = require('./generator');
const memory = require('./memory');

/**
 * Runs one autonomous think-cycle for an agent:
 *  1. Discover live candidates
 *  2. Apply editorial judgment (accept/reject with reasons)
 *  3. If something clears the bar, write it in persona voice
 *  4. Persist the post + update memory (seen topics, rejected log)
 * At most one post is published per cycle, mirroring how the persona
 * publishes over time rather than dumping everything at once.
 */
async function runCycle(agentId) {
  const state = memory.load(agentId);
  if (!state) return null;

  const persona = state.persona;
  const candidates = await discoverCandidates(persona);
  const { ranked, rejected } = judge(candidates, persona, state);

  // Record rejections + mark every considered item as "seen" so we don't
  // re-litigate the same topic in a future cycle.
  const newlySeen = new Set(state.seenTopicKeys || []);
  for (const r of rejected) {
    state.rejectedTopics.push(r);
    newlySeen.add(r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  }

  if (ranked.length === 0) {
    state.seenTopicKeys = Array.from(newlySeen);
    memory.save(agentId, state);
    return { published: false, reason: 'No candidate cleared the editorial bar this cycle.' };
  }

  const top = ranked[0];
  const recentTitles = state.posts.slice(-5).map(p => p.topicTitle);

  const { text, usedLLM, provider } = await writePost({
    persona,
    candidate: top.candidate,
    matchedKeywords: top.matchedKeywords,
    recentTitles
  });

  const draftedBy = provider === 'anthropic'
    ? 'Drafted by the persona\'s configured Claude model in its fixed voice.'
    : provider === 'groq'
      ? 'Drafted by the persona\'s configured free-tier LLM (Groq) in its fixed voice.'
      : 'Drafted via the persona\'s rule-based voice template (no LLM key configured).';

  const rationale =
    `Selected "${top.candidate.title}" over ${ranked.length - 1} other candidate(s) considered this cycle ` +
    `because it matched ${persona.name}'s beat on ${top.matchedKeywords.join(', ')} and is recent ` +
    `(published ${top.candidate.publishedAt}). Conviction: ${top.conviction}/100. ${persona.editorialBar} ` +
    draftedBy;

  const post = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    text,
    topicTitle: top.candidate.title,
    rationale,
    conviction: top.conviction,
    sources: [top.candidate.url].filter(Boolean)
  };

  state.posts.push(post);
  newlySeen.add(top.fp);
  state.seenTopicKeys = Array.from(newlySeen);
  memory.save(agentId, state);

  return { published: true, post };
}

module.exports = { runCycle };
