/**
 * sidepanel/sidepanel.js
 * All UI logic for the SightLite side panel.
 *
 * Communicates with the service worker via chrome.runtime.sendMessage.
 * Receives push updates (timeline_update, perception_update, confirm_required)
 * via chrome.runtime.onMessage.
 *
 * No eval, no innerHTML from untrusted sources, no remote scripts.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────
const goalInput     = document.getElementById('goal-input');
const btnRun        = document.getElementById('btn-run');
const btnPause      = document.getElementById('btn-pause');
const btnStop       = document.getElementById('btn-stop');
const btnClear      = document.getElementById('btn-clear');
const btnDiag       = document.getElementById('btn-diag-toggle');
const diagLabel     = document.getElementById('diag-label');
const statusPill    = document.getElementById('status-pill');
const statusDot     = document.getElementById('status-dot');
const statusLabel   = document.getElementById('status-label');
const percMode      = document.getElementById('perc-mode');
const percInf       = document.getElementById('perc-inf');
const percCount     = document.getElementById('perc-count');
const timeline      = document.getElementById('timeline');
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMsg    = document.getElementById('confirm-msg');
const btnCancel     = document.getElementById('btn-cancel-action');
const btnConfirm    = document.getElementById('btn-confirm-action');

// ── State ─────────────────────────────────────────────────────────────────
let agentRunning = false;
let diagnosticsOn = true;

// Restore diagnostics preference
chrome.storage.local.get(['diagnosticsEnabled'], r => {
  diagnosticsOn = r.diagnosticsEnabled !== false;
  diagLabel.textContent = diagnosticsOn ? 'On' : 'Off';
});

// ── Run agent ─────────────────────────────────────────────────────────────
btnRun.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  if (!goal) {
    goalInput.focus();
    goalInput.style.borderColor = '#ef4444';
    setTimeout(() => goalInput.style.borderColor = '', 1500);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { addEntry('error', '✗ No active tab found'); return; }

  // Clear previous session
  clearTimeline();
  setRunning(true);

  chrome.runtime.sendMessage({ type: 'agent_start', goal, tabId: tab.id });
});

// ── Stop ──────────────────────────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'agent_stop' });
});

// ── Pause ─────────────────────────────────────────────────────────────────
btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'agent_pause' }, r => {
    if (r?.paused) {
      btnPause.textContent = '⏸ Paused — Resume';
      setStatus('waiting', 'Paused');
    } else {
      btnPause.textContent = '⏸ Pause';
    }
  });
});

// ── Clear session ─────────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  clearTimeline();
  resetPerception();
  setStatus('idle', 'Ready');
  setRunning(false);
});

// ── Diagnostics toggle ────────────────────────────────────────────────────
btnDiag.addEventListener('click', () => {
  diagnosticsOn = !diagnosticsOn;
  diagLabel.textContent = diagnosticsOn ? 'On' : 'Off';
  chrome.storage.local.set({ diagnosticsEnabled: diagnosticsOn });
});

// ── Enter key in textarea ─────────────────────────────────────────────────
goalInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    btnRun.click();
  }
});

// ── Confirm dialog ────────────────────────────────────────────────────────
btnCancel.addEventListener('click', () => {
  confirmOverlay.hidden = true;
  chrome.runtime.sendMessage({ type: 'confirm_destructive', confirmed: false });
});
btnConfirm.addEventListener('click', () => {
  confirmOverlay.hidden = true;
  chrome.runtime.sendMessage({ type: 'confirm_destructive', confirmed: true });
});

// ── Incoming messages from service worker ────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case 'timeline_update':
      handleTimelineUpdate(msg);
      break;

    case 'perception_update':
      updatePerception(msg.source, msg.inferenceMs, msg.count);
      break;

    case 'confirm_required':
      showConfirmDialog(msg);
      break;

    case 'ai_response':
      handleAIResponse(msg);
      break;
  }
});

function handleTimelineUpdate({ status, entry }) {
  if (!entry) return;

  const s = (status ?? '').toLowerCase();

  // Map status → dot class
  const dotClass = {
    observing:  'observe',
    perceiving: 'perceive',
    planning:   'plan',
    acting:     'act',
    completed:  'complete',
    error:      'error',
    stopped:    'stopped',
    waiting:    'wait',
  }[s] || 'wait';

  addEntry(dotClass, entry.label, entry.detail, entry.ts);

  // Update status pill
  const labels = {
    idle:       'Ready',
    observing:  'Observing',
    perceiving: 'Perceiving',
    planning:   'Planning',
    acting:     'Acting',
    waiting:    'Waiting',
    completed:  'Completed',
    stopped:    'Stopped',
    error:      'Error',
  };
  setStatus(s, labels[s] || s);

  // Update running state
  if (['completed','stopped','error'].includes(s)) {
    setRunning(false);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────
function setRunning(running) {
  agentRunning = running;
  btnRun.disabled   = running;
  btnStop.disabled  = !running;
  btnPause.disabled = !running;
  goalInput.disabled = running;
  if (!running) {
    btnPause.textContent = '⏸ Pause';
  }
}

const STATUS_DOT_CLASS = {
  idle: 'idle', observing: 'running', perceiving: 'perceiving',
  planning: 'planning', acting: 'acting',
  completed: 'completed', stopped: 'stopped', error: 'error', waiting: 'idle',
};

function setStatus(key, label) {
  statusDot.className = 'status-dot ' + (STATUS_DOT_CLASS[key] ?? 'idle');
  statusLabel.textContent = label ?? key;
}

function updatePerception(source, inferenceMs, count) {
  const mode = source === 'vision' ? 'Vision' : 'DOM Fallback';
  percMode.textContent  = mode;
  percMode.className    = 'perc-v ' + (source === 'vision' ? 'vision' : 'dom');
  percInf.textContent   = inferenceMs > 0 ? `${inferenceMs} ms` : '< 1 ms';
  percCount.textContent = String(count ?? 0);
}

function resetPerception() {
  percMode.textContent  = '—';
  percMode.className    = 'perc-v';
  percInf.textContent   = '—';
  percCount.textContent = '—';
}

function addEntry(dotClass, label, detail, ts) {
  // Remove empty placeholder
  timeline.querySelector('.tl-empty')?.remove();

  const entry = document.createElement('div');
  entry.className = 'tl-entry';

  // Connector
  const connector = document.createElement('div');
  connector.className = 'tl-connector';
  const dot = document.createElement('div');
  dot.className = `tl-dot ${dotClass}`;
  const line = document.createElement('div');
  line.className = 'tl-line';
  connector.appendChild(dot);
  connector.appendChild(line);

  // Body
  const body = document.createElement('div');
  body.className = 'tl-body';
  const lbl = document.createElement('div');
  lbl.className = 'tl-label';
  // Safe text-only assignment — no innerHTML
  lbl.textContent = String(label ?? '').slice(0, 200);
  body.appendChild(lbl);

  if (detail) {
    const det = document.createElement('div');
    det.className = 'tl-detail';
    det.textContent = String(detail).slice(0, 200);
    body.appendChild(det);
  }

  // Timestamp
  const time = document.createElement('div');
  time.className = 'tl-ts';
  time.textContent = formatTs(ts ?? Date.now());

  entry.appendChild(connector);
  entry.appendChild(body);
  entry.appendChild(time);
  timeline.appendChild(entry);

  // Auto-scroll to bottom
  timeline.scrollTop = timeline.scrollHeight;
}

function clearTimeline() {
  while (timeline.firstChild) timeline.removeChild(timeline.firstChild);
  const empty = document.createElement('div');
  empty.className = 'tl-empty';
  empty.textContent = 'Run the agent to see activity here.';
  timeline.appendChild(empty);
}

function showConfirmDialog(msg) {
  // Safe text assignment only
  const action = String(msg.action ?? '').slice(0, 40);
  const target = String(msg.target ?? '').slice(0, 80);
  confirmMsg.textContent =
    `Action: ${action}\nTarget: "${target}"\nThis may be a destructive or irreversible action.`;
  confirmOverlay.hidden = false;
}

function formatTs(ts) {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function handleAIResponse(msg) {
  if (msg.status === 'error') {
    addEntry('error', '✗ AI Error', msg.text);
    return;
  }

  // Clear timeline for AI response
  clearTimeline();

  const entry = document.createElement('div');
  entry.className = 'tl-entry ai-response';
  entry.style.cssText = 'background:#ffffff; border:2px solid #14b8a6; border-radius:10px; padding:16px; margin:12px 0; box-shadow:0 2px 12px rgba(20,184,166,0.12);';

  const header = document.createElement('div');
  header.style.cssText = 'color:#14b8a6; font-weight:600; margin-bottom:8px; font-size:14px;';
  header.textContent = msg.mode === 'explain' ? '🔍 Explanation' : '💡 Answer';

  const query = document.createElement('div');
  query.style.cssText = 'color:#64748b; font-size:12px; margin-bottom:12px; font-style:italic; padding:8px; background:#f8fafc; border-radius:6px;';
  query.textContent = '"' + (msg.query || '').slice(0, 150) + (msg.query.length > 150 ? '...' : '') + '"';

  const response = document.createElement('div');
  response.style.cssText = 'color:#1e293b; line-height:1.6; font-size:13px; white-space:pre-wrap;';
  response.textContent = msg.text;

  entry.appendChild(header);
  entry.appendChild(query);
  entry.appendChild(response);
  timeline.appendChild(entry);

  // Auto-scroll to show response
  timeline.scrollTop = timeline.scrollHeight;
}
