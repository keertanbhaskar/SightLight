/**
 * agent/state.js
 * Explicit agent state machine. Single source of truth for all runtime state.
 * No scattered booleans anywhere else in the codebase.
 */

// ── Safety limits ──────────────────────────────────────────────────────────
export const LIMITS = {
  MAX_STEPS:      15,   // maximum agent steps per run
  MAX_RETRIES:    2,    // retries per step when target not found
  MAX_RUNTIME_MS: 60_000, // hard wall-clock limit (60 s)
};

// ── Valid states ───────────────────────────────────────────────────────────
export const STATUS = {
  IDLE:       'IDLE',
  OBSERVING:  'OBSERVING',
  PERCEIVING: 'PERCEIVING',
  PLANNING:   'PLANNING',
  ACTING:     'ACTING',
  WAITING:    'WAITING',
  COMPLETED:  'COMPLETED',
  STOPPED:    'STOPPED',
  ERROR:      'ERROR',
};

// ── Initial state factory ──────────────────────────────────────────────────
export function createState() {
  return {
    status:           STATUS.IDLE,
    goal:             '',
    steps:            [],        // parsed plan steps
    stepIndex:        0,
    retries:          0,
    iteration:        0,         // total perception loops executed
    startedAt:        null,      // Date.now() when run began
    detectedElements: [],        // last perception result
    selectedTarget:   null,      // element chosen by planner
    lastAction:       null,      // { type, target, ok }
    perceptionMode:   'dom',     // 'vision' | 'dom'
    inferenceMs:      0,
    error:            null,
    stopRequested:    false,
    pauseRequested:   false,
    sessionId:        null,      // optional backend session id
    timeline:         [],        // array of TimelineEntry
  };
}

// ── Timeline helpers ───────────────────────────────────────────────────────
export function timelineEntry(label, detail = '') {
  return { ts: Date.now(), label, detail };
}

// ── Transition guard ───────────────────────────────────────────────────────
// Prevents illegal status transitions from silently corrupting the loop.
const ALLOWED_FROM = {
  [STATUS.IDLE]:       [STATUS.OBSERVING, STATUS.ERROR],
  [STATUS.OBSERVING]:  [STATUS.PERCEIVING, STATUS.STOPPED, STATUS.ERROR],
  [STATUS.PERCEIVING]: [STATUS.PLANNING, STATUS.STOPPED, STATUS.ERROR],
  [STATUS.PLANNING]:   [STATUS.ACTING, STATUS.WAITING, STATUS.COMPLETED, STATUS.STOPPED, STATUS.ERROR],
  [STATUS.ACTING]:     [STATUS.WAITING, STATUS.OBSERVING, STATUS.COMPLETED, STATUS.STOPPED, STATUS.ERROR],
  [STATUS.WAITING]:    [STATUS.OBSERVING, STATUS.STOPPED, STATUS.ERROR],
  [STATUS.COMPLETED]:  [STATUS.IDLE],
  [STATUS.STOPPED]:    [STATUS.IDLE],
  [STATUS.ERROR]:      [STATUS.IDLE],
};

export function transition(state, next) {
  const allowed = ALLOWED_FROM[state.status] ?? [];
  if (!allowed.includes(next)) {
    console.warn(`[SightLite] Illegal transition ${state.status} → ${next}`);
    // Still allow it in production — just log — to avoid silent deadlocks.
  }
  state.status = next;
}

// ── Runtime checks used inside the agent loop ──────────────────────────────
export function isAborted(state) {
  return state.stopRequested;
}

export function isOverLimit(state) {
  if (state.stepIndex >= LIMITS.MAX_STEPS) return 'MAX_STEPS';
  if (Date.now() - state.startedAt > LIMITS.MAX_RUNTIME_MS) return 'MAX_RUNTIME';
  return false;
}
