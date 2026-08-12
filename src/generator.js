'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

// Groq offers a genuinely free API tier (no card required) and speaks the
// same request/response shape as OpenAI's chat completions API, which
// makes it a simple, free alternative to Anthropic for actually writing
// posts with a real LLM instead of the rule-based fallback below.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function pick(arr, seed) {
  return arr[seed % arr.length];
}

// Picks the persona opinion most relevant to this candidate (by loose
// word overlap with the story text), falling back to a rotating pick if
// nothing overlaps. This is what lets posts occasionally take a stance
// instead of just summarizing the story neutrally.
function pickRelevantOpinion(persona, candidate, seed) {
  const opinions = persona.opinions || [];
  if (opinions.length === 0) return null;
  const text = (candidate.title + ' ' + (candidate.summary || '')).toLowerCase();
  const scored = opinions.map(op => {
    const words = op.toLowerCase().split(/\W+/).filter(w => w.length > 4);
    const hits = words.filter(w => text.includes(w)).length;
    return { op, hits };
  });
  scored.sort((a, b) => b.hits - a.hits);
  if (scored[0].hits > 0) return scored[0].op;
  return pick(opinions, seed);
}

function buildSystemPrompt(persona) {
  const opinionsBlock = (persona.opinions && persona.opinions.length)
    ? `Your standing opinions (weave one in ONLY when it's actually relevant to today's topic, and only sometimes — not every post needs a hot take): ${persona.opinions.join(' | ')}`
    : '';
  return [
    `You are ${persona.name}, a ${persona.domain} persona posting on a professional feed (LinkedIn/X style).`,
    `Bio: ${persona.bio}`,
    `Voice: tone=${persona.voice.tone}; sentence style=${persona.voice.sentenceStyle}; structure=${persona.voice.structure}; closing habit=${persona.voice.closing}.`,
    `You occasionally use phrasing in the spirit of (do not repeat verbatim every time): ${persona.voice.signaturePhrases.join(' | ')}`,
    opinionsBlock,
    `You NEVER write generic AI hype ("game-changer", "revolutionary", excessive emoji). You avoid: ${persona.avoids.join('; ')}.`,
    `Write ONE short post (90-160 words), no hashtags spam (at most 1), no markdown headers. Plain text suitable for a social post.`
  ].filter(Boolean).join('\n');
}

function buildUserPrompt({ persona, candidate, matchedKeywords, recentTitles }) {
  const relevantOpinion = pickRelevantOpinion(persona, candidate, candidate.title.length);
  return [
    `Topic to cover: "${candidate.title}"`,
    candidate.summary ? `Context/summary: ${candidate.summary}` : '',
    `Source: ${candidate.url}`,
    `Why this matched your beat: ${matchedKeywords.join(', ')}`,
    relevantOpinion ? `If it genuinely fits, this standing opinion of yours is relevant here: "${relevantOpinion}"` : '',
    recentTitles.length ? `You already covered these recently, do not repeat them: ${recentTitles.join(' | ')}` : '',
    `Write the post now, in character, following your voice rules exactly.`
  ].filter(Boolean).join('\n');
}

async function generateWithAnthropic(ctx) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system: buildSystemPrompt(ctx.persona),
        messages: [{ role: 'user', content: buildUserPrompt(ctx) }]
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    return textBlock ? textBlock.text.trim() : null;
  } catch (e) {
    return null;
  }
}

// Free alternative to Anthropic. Get a free key at https://console.groq.com
// and set GROQ_API_KEY in .env — no credit card required for the free tier.
async function generateWithGroq(ctx) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 400,
        messages: [
          { role: 'system', content: buildSystemPrompt(ctx.persona) },
          { role: 'user', content: buildUserPrompt(ctx) }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return text ? text.trim() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Deterministic, persona-voiced fallback writer used when no API key is
 * configured at all. Keeps the whole system runnable standalone (as
 * required: "simulated publishing is acceptable"). Injects a relevant
 * standing opinion about half the time, so even the no-LLM fallback takes
 * a stance sometimes instead of purely summarizing.
 */
function generateFallback({ persona, candidate, matchedKeywords }) {
  const seed = candidate.title.length + matchedKeywords.length;
  const opener = pick(persona.voice.signaturePhrases, seed);
  const focusKw = matchedKeywords[0];
  const relevantOpinion = pickRelevantOpinion(persona, candidate, seed);
  const takeStance = relevantOpinion && (seed % 2 === 0); // roughly half the time

  const opinionSentence = takeStance
    ? ` For what it's worth, I'm ${relevantOpinion} — this story is a data point either way.`
    : '';

  const body =
    `${opener} "${candidate.title}" (via ${candidate.source}) touches on ${focusKw}, ` +
    `an area I track closely in ${persona.domain}. ${candidate.summary ? trimSummary(candidate.summary) + ' ' : ''}` +
    `The part worth sitting with: this isn't an isolated data point, it's a signal about how ${focusKw} ` +
    `is trending in practice right now, not just in theory.${opinionSentence} ${persona.voice.closing.includes('takeaway')
      ? 'Takeaway: if you work anywhere near this, it is worth a closer read before it becomes conventional wisdom.'
      : 'Worth a closer look before it becomes conventional wisdom.'}`;
  return body;
}

function trimSummary(s) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > 220 ? t.slice(0, 217) + '...' : t;
}

/**
 * Tries a real LLM first (Anthropic if configured, else the free Groq
 * tier if configured), and only falls back to the rule-based template if
 * neither key is set or both calls fail. This means the project runs
 * fully standalone with zero cost, but automatically upgrades to a real
 * model the moment either key is present.
 */
async function writePost(ctx) {
  const viaAnthropic = await generateWithAnthropic(ctx);
  if (viaAnthropic) return { text: viaAnthropic, usedLLM: true, provider: 'anthropic' };

  const viaGroq = await generateWithGroq(ctx);
  if (viaGroq) return { text: viaGroq, usedLLM: true, provider: 'groq' };

  return { text: generateFallback(ctx), usedLLM: false, provider: 'rule-based' };
}

module.exports = { writePost };

