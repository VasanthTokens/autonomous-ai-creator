'use strict';

const memory = require('./memory');
const { runCycle } = require('./cycle');

const timers = new Map(); // agentId -> timeout handle

function minutes(n) {
  return n * 60 * 1000;
}

function randomDelayMs() {
  const min = parseInt(process.env.CYCLE_MIN_MINUTES || '45', 10);
  const max = parseInt(process.env.CYCLE_MAX_MINUTES || '120', 10);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const mins = lo + Math.random() * (hi - lo);
  return minutes(mins);
}

function scheduleNext(agentId) {
  const delay = randomDelayMs();
  const state = memory.load(agentId);
  if (state) {
    state.nextRunAt = new Date(Date.now() + delay).toISOString();
    memory.save(agentId, state);
  }
  const handle = setTimeout(async () => {
    try {
      await runCycle(agentId);
    } catch (e) {
      // Swallow errors so the loop never dies — an autonomous agent that
      // crashes on a bad HTTP fetch defeats the point.
      console.error(`[scheduler] cycle error for ${agentId}:`, e.message);
    }
    scheduleNext(agentId);
  }, delay);
  handle.unref(); // don't keep process alive purely for this timer
  timers.set(agentId, handle);
}

/**
 * Start autonomous operation for an agent. Fires one cycle almost
 * immediately (so the feed isn't empty for the first hour of evaluation),
 * then continues on a randomized cadence indefinitely.
 */
function start(agentId) {
  if (timers.has(agentId)) return; // already running
  // First cycle fires quickly (30-90s) so evaluators see activity right away.
  const firstDelay = 30_000 + Math.random() * 60_000;
  const handle = setTimeout(async () => {
    try {
      await runCycle(agentId);
    } catch (e) {
      console.error(`[scheduler] initial cycle error for ${agentId}:`, e.message);
    }
    scheduleNext(agentId);
  }, firstDelay);
  handle.unref();
  timers.set(agentId, handle);
}

/** Re-arm scheduling for agents found on disk when the process restarts. */
function resumeAll() {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) return;
  for (const file of fs.readdirSync(dataDir)) {
    if (file.endsWith('.json')) {
      const agentId = file.replace(/\.json$/, '');
      start(agentId);
    }
  }
}

module.exports = { start, resumeAll };
