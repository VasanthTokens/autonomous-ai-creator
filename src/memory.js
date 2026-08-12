'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(agentId) {
  return path.join(DATA_DIR, `${agentId}.json`);
}

function load(agentId) {
  const fp = filePath(agentId);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    return null;
  }
}

function save(agentId, state) {
  const fp = filePath(agentId);
  // Atomic-ish write to avoid corrupting the file if the process is
  // interrupted mid-write during a long-running deployment.
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, fp);
}

function createAgentState(agentId, persona) {
  const state = {
    agentId,
    persona,
    createdAt: new Date().toISOString(),
    posts: [],           // published posts, newest last (we reverse on read)
    rejectedTopics: [],  // { title, reason, consideredAt, sourceUrl }
    seenTopicKeys: [],   // fingerprints of everything ever considered, to avoid repetition
    nextRunAt: null
  };
  save(agentId, state);
  return state;
}

function agentExists(agentId) {
  return fs.existsSync(filePath(agentId));
}

module.exports = { load, save, createAgentState, agentExists };
