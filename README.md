# Autonomous AI Creator

An autonomous AI & technology persona that discovers topics, exercises
editorial judgment, writes in a consistent voice, remembers what it has
published, and keeps publishing over time — with zero human input after a
single initialization call.

## How it satisfies each requirement

| Requirement | Where it happens |
|---|---|
| **Topic discovery** | `src/discovery.js` pulls live candidates from two keyless public APIs: Hacker News (Algolia search, by recency) and arXiv (cs.AI / cs.CR / cs.LG, newest first). No API key required for this part. |
| **Editorial judgment** | `src/editorial.js` scores every candidate against the persona's fixed interest keywords, recency, and (for HN) engagement, then applies a hard bar. Anything with zero keyword overlap or that's too stale is **rejected with a stated reason** and logged — never silently dropped. See `GET /api/agent/rejected`. |
| **Consistent persona** | `src/persona.js` fixes name, domain, bio, voice (tone, sentence style, structure, signature phrases, closing habit) and an explicit editorial bar **once at init**, and every cycle reuses the same object — nothing about voice or interests drifts over time. |
| **Memory** | `src/memory.js` persists a JSON file per agent (`data/<agentId>.json`) holding every published post, every rejected topic, and a fingerprint set of everything ever considered, so the agent never re-covers or re-litigates the same story. |
| **Autonomous publishing over time** | `src/scheduler.js` runs one cycle almost immediately after init (so the feed isn't empty for the first hour), then re-schedules itself on a **randomized cadence** (default 45–120 min, configurable) indefinitely — no cron job or external trigger needed, and it survives process restarts (`resumeAll`). |
| **Publishing rationale** | Every post built in `src/cycle.js` includes why the topic was picked, why it's relevant now, and its source URL(s), returned directly in the `rationale` and `sources` fields of `GET /api/agent/feed`. |

### LLM usage (optional, with graceful fallback)

If you set `ANTHROPIC_API_KEY`, the agent uses Claude (`claude-sonnet-4-6`)
to actually draft each post and rationale in-character (`src/generator.js`,
`generateWithClaude`). **If no key is set, it automatically falls back to a
deterministic, persona-voiced template** so the whole system still runs
standalone with zero configuration — this satisfies "simulated publishing is
acceptable."

## API

### `POST /api/agent/init`
Call exactly once.

```json
{ "persona": { "name": "Ada", "domain": "AI Security" } }
```
`persona` is optional — omit it to get a default built-in persona
(`Kai Voss`, AI Security). You can also pass one of the built-in keys
directly: `{"persona": "ml-engineer"}` or `{"persona": "dev-advocate"}`.

Response:
```json
{ "agentId": "abc-123" }
```

### `GET /api/agent/feed?agentId=abc-123`
The only endpoint you should need to poll afterward.

```json
{
  "posts": [
    {
      "id": "p7",
      "createdAt": "2026-08-07T10:30:00Z",
      "text": "...",
      "rationale": "...",
      "sources": ["https://..."]
    }
  ]
}
```
Reverse chronological, previously returned posts stay available, empty
array if nothing has published yet.

### Bonus transparency endpoints (not required, useful for demoing)
- `GET /api/agent/persona?agentId=...` — the fixed persona definition
- `GET /api/agent/rejected?agentId=...` — every topic considered and rejected, with reasons

## Running locally

```bash
npm install
cp .env.example .env      # optionally add ANTHROPIC_API_KEY
npm start                 # listens on PORT (default 3000)
```

Then:
```bash
curl -X POST http://localhost:3000/api/agent/init \
  -H 'Content-Type: application/json' \
  -d '{"persona":{"name":"Ada","domain":"AI Security"}}'

curl "http://localhost:3000/api/agent/feed?agentId=<the id you got back>"
```
The first post typically appears within 30–90 seconds of init; after that,
new posts arrive on the randomized cadence set by `CYCLE_MIN_MINUTES` /
`CYCLE_MAX_MINUTES` (defaults 45–120 minutes) so several posts accumulate
over a 48-hour evaluation window without looking mechanically periodic.

## Deploying so it survives 48 hours unattended

Any always-on Node host works (the free tiers of Render/Railway/Fly.io are
fine — just make sure it's not a "sleep after inactivity" tier, since the
scheduler needs the process alive to fire timers):

1. Push this folder to a GitHub repo.
2. Create a new Web Service pointing at it, build command `npm install`,
   start command `npm start`.
3. Set env vars: `ANTHROPIC_API_KEY` (optional), `CYCLE_MIN_MINUTES`,
   `CYCLE_MAX_MINUTES` if you want a different cadence.
4. Call `POST /api/agent/init` **once** against the deployed URL before
   handing it to evaluators.

Note: the JSON files in `data/` are the agent's memory. On platforms with
ephemeral/non-persistent disks, attach a persistent volume mounted at
`./data` (or swap `src/memory.js` for a DB) so memory and unpublished
scheduling state survive redeploys — `resumeAll()` already re-arms any
agent it finds on disk at boot.

## Tuning the cadence for the 48-hour window

Defaults produce roughly 12–60 posts across 48 hours. To guarantee a
denser, more demo-friendly feed, lower `CYCLE_MIN_MINUTES`/
`CYCLE_MAX_MINUTES` (e.g. 15–30) before deploying.

## Project structure

```
src/
  server.js      HTTP endpoints (init, feed, + bonus persona/rejected)
  scheduler.js    autonomous, self-rescheduling cycle loop
  cycle.js        one full think-cycle: discover -> judge -> write -> remember
  discovery.js    live topic sourcing (Hacker News, arXiv)
  editorial.js    scoring + accept/reject judgment
  generator.js    Claude-backed writer with rule-based fallback
  persona.js      persona definitions (voice, interests, editorial bar)
  memory.js       JSON file persistence per agent
data/             per-agent state (created at runtime, gitignore this)
```
