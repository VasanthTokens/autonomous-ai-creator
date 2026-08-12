Autonomous AI Creator — Kai Voss

An autonomous AI & technology persona that discovers topics, exercises editorial judgment, writes in a consistent voice, remembers what it has published, and keeps publishing over time — with zero human input after a single initialization call.

What it does (plain terms)

You initialize it once. From then on, on its own timer, it:

Reads live tech news (Hacker News + arXiv)
Judges each story against a fixed persona's beat and standards
Rejects most of them, with a stated reason
Writes about the one that clears the bar, in a consistent voice — occasionally taking a real stance, not just summarizing
Remembers everything it's covered so it never repeats itself
Sets its own next wake-up time and repeats, indefinitely
Core capabilities — implementation map
Capability	Where
Topic discovery from a live source	src/discovery.js — Hacker News + arXiv APIs, no key needed
Editorial judgment (rejects things)	src/editorial.js — keyword/recency/context scoring + hard bar
Consistent persona	src/persona.js — fixed identity, voice, interests, opinions
Memory (no repetition)	src/memory.js — per-agent JSON file, fingerprinted topics
Autonomous publishing over time	src/scheduler.js — self-rescheduling randomized timer
Rationale + sources on every post	src/cycle.js — built into every saved post
POST /api/agent/init → {agentId}	src/server.js
GET /api/agent/feed → {posts:[...]}	src/server.js
Every change made during development (chronological)
1. Initial build

Full project scaffolded: Express server, discovery (HN + arXiv), editorial scoring, rule-based + Claude-backed post generation, JSON file memory, self-rescheduling scheduler, and the two core API endpoints plus bonus GET /api/agent/persona and GET /api/agent/rejected for transparency.

2. Editorial false-positive fix

Problem found during testing: the agent published a story about an iPhone jailbreak because the word "jailbreak" matched the persona's security keyword list — even though it had nothing to do with AI.

Fix (src/editorial.js): added an AI-context anchor-word check. Ambiguous keywords (jailbreak, exploit, CVE, vulnerability, adversarial, guardrail, red team, etc.) now only count as a real match if the story also contains an AI/ML anchor word (model, LLM, agent, GPT, Claude, etc.), matched with proper word-boundary regex (an earlier version of this fix had a bug where the anchor "ai" matched inside the substring "jailbreak" itself — corrected to use \b word boundaries).

Rejection reasons were also made keyword-specific and accurate (e.g. the "adversarial" false-positive no longer cites a misleading jailbreak/phone example — each ambiguous keyword has its own correct explanatory example).

3. Frontend dashboard added

Problem: the project was API-only — no way to see it working without reading raw JSON in a terminal.

Added: public/index.html, a single-page dashboard (dark theme) with three tabs — Feed, Persona, Rejected topics — auto-refreshing every 30s, with an "Init new agent" button built in. src/server.js updated to serve it via express.static.

4. Standing opinions (persona depth)

Goal: move beyond keyword-filtering into something that reads as genuine editorial judgment, not a templated summarizer.

Added (src/persona.js): each built-in persona now has 5 real standing opinions (e.g. Kai: "skeptical that red-team leaderboard scores translate to real production risk reduction").

Added (src/generator.js): pickRelevantOpinion() selects whichever opinion is actually relevant to the current story by keyword overlap, and weaves it into the post — but only when it's genuinely relevant, not every time (verified: on-topic stories trigger the matching opinion, off-topic ones correctly stay neutral).

5. Conviction score (visible judgment gradient)

Goal: turn accept/reject from a binary black box into something visibly graded.

Added (src/editorial.js): every candidate — published or rejected — now gets a normalized 0–100 "conviction" score derived from the existing internal scoring math. Surfaced in the feed API response, the rejected log, the rationale text, and as color-coded badges (green/yellow/red) on the dashboard.

6. Free LLM option (Groq)

Problem: Anthropic's API costs money; wanted a genuinely free way to get real LLM-written posts instead of only the rule-based fallback.

Added (src/generator.js): a second provider path using Groq's free API tier (OpenAI-compatible request format, llama-3.3-70b-versatile model). Provider priority order: Anthropic (if key set) → Groq (if key set) → rule-based fallback — each step verified independently, including graceful fallthrough on an invalid/failing key at any stage. .env.example and src/cycle.js (rationale text) updated to reflect which provider actually wrote each post.

7. Local environment troubleshooting

Walked through: Node.js not installed (installed via winget install OpenJS.NodeJS.LTS), missing dotenv module (npm install in the correct project folder), PowerShell's curl alias conflict (switched to Invoke-RestMethod), confirmed agentId vs. post id mix-ups, and verified the full discover → judge → write → remember cycle live against real Hacker News/arXiv data multiple times, including with the free Groq LLM active (confirmed working: a real post with conviction 40/100, sourced from arXiv, referencing a genuinely relevant standing opinion).

Also tested public exposure via ngrok http 3000 for a quick live demo (noted as unsuitable for long unattended runs since it depends on the laptop staying on — real hosting is the right move for that).

Project structure
src/
  server.js      HTTP endpoints (init, feed, + bonus persona/rejected) + serves dashboard
  scheduler.js    autonomous, self-rescheduling cycle loop
  cycle.js        one full think-cycle: discover -> judge -> write -> remember
  discovery.js    live topic sourcing (Hacker News, arXiv)
  editorial.js    scoring + accept/reject judgment + conviction score
  generator.js    Anthropic / Groq / rule-based writer, in priority order
  persona.js      persona definitions (voice, interests, opinions, editorial bar)
  memory.js       JSON file persistence per agent
public/
  index.html      browser dashboard (Feed / Persona / Rejected tabs)
data/             per-agent state (created at runtime, gitignored)
Environment variables (.env)
ANTHROPIC_API_KEY=      # optional, paid, tried first if set
GROQ_API_KEY=            # optional, free, tried second if set
PORT=3000
CYCLE_MIN_MINUTES=45
CYCLE_MAX_MINUTES=120

If neither key is set, the rule-based writer is used — the whole thing runs fully standalone at zero cost.

Running locally
bash
npm install
cp .env.example .env
npm start

Open http://localhost:3000, click "Init new agent," wait ~60-90s, check the Feed tab.

Deploying it somewhere always-on
Push to GitHub (.gitignore already excludes node_modules/, .env, data/*.json)
Deploy to Render/Railway/Fly — Node runtime, build npm install, start npm start
Set env vars (GROQ_API_KEY recommended, CYCLE_MIN_MINUTES/MAX for cadence)
Use an uptime pinger (e.g. UptimeRobot) if on a sleep-on-idle free tier
Call POST /api/agent/init exactly once against the live URL