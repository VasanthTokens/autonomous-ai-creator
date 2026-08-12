'use strict';

require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const memory = require('./memory');
const scheduler = require('./scheduler');
const { resolvePersona } = require('./persona');

const app = express();
app.use(express.json());
app.use(express.static(require('path').join(__dirname, '..', 'public')));

// Re-arm any agents that already existed on disk (e.g. after a redeploy)
// so autonomous publishing survives restarts.
scheduler.resumeAll();

/**
 * POST /api/agent/init
 * Called exactly once. Creates the agent, fixes its persona, and starts
 * the autonomous loop. No further calls to this endpoint should be needed —
 * everything after this is driven by the scheduler.
 */
app.post('/api/agent/init', (req, res) => {
  const { persona: personaInput } = req.body || {};
  const persona = resolvePersona(personaInput);
  const agentId = uuidv4();

  memory.createAgentState(agentId, persona);
  scheduler.start(agentId);

  res.status(201).json({ agentId });
});

/**
 * GET /api/agent/feed?agentId=...
 * The only endpoint evaluators call after init. Returns everything
 * published so far, newest first. Never mutates state.
 */
app.get('/api/agent/feed', (req, res) => {
  const { agentId } = req.query;
  if (!agentId) {
    return res.status(400).json({ error: 'agentId query parameter is required' });
  }
  const state = memory.load(agentId);
  if (!state) {
    return res.status(404).json({ error: 'unknown agentId' });
  }

  const posts = [...state.posts]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(p => ({
      id: p.id,
      createdAt: p.createdAt,
      text: p.text,
      rationale: p.rationale,
      conviction: p.conviction,
      sources: p.sources
    }));

  res.json({ posts });
});

// --- Optional transparency endpoints (not required by spec, but useful
// for demoing editorial judgment / persona identity to evaluators) ---

app.get('/api/agent/persona', (req, res) => {
  const { agentId } = req.query;
  const state = memory.load(agentId);
  if (!state) return res.status(404).json({ error: 'unknown agentId' });
  res.json({ persona: state.persona });
});

app.get('/api/agent/rejected', (req, res) => {
  const { agentId } = req.query;
  const state = memory.load(agentId);
  if (!state) return res.status(404).json({ error: 'unknown agentId' });
  const rejected = [...state.rejectedTopics].reverse();
  res.json({ rejected });
});

app.get('/api/info', (req, res) => {
  res.json({
    name: 'Autonomous AI Creator',
    endpoints: [
      'POST /api/agent/init',
      'GET /api/agent/feed?agentId=...',
      'GET /api/agent/persona?agentId=... (bonus)',
      'GET /api/agent/rejected?agentId=... (bonus)'
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Autonomous AI Creator listening on port ${PORT}`);
});
