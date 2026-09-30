/**
 * agent/actions.js
 * Safe action execution helpers called from the service worker.
 * All actions go through content.js via chrome.tabs.sendMessage.
 *
 * Supported actions: CLICK, TYPE, SCROLL, FIND (highlight only)
 *
 * Safety:
 *  - No arbitrary JS execution
 *  - No eval / new Function
 *  - Coordinates validated before sending
 *  - Type never stores passwords (caller responsibility to avoid sensitive fields)
 */

// ── Execute an action step on the given tab ────────────────────────────────
export async function executeAction(tabId, step, target) {
  validateStep(step);

  switch (step.action) {
    case 'scroll':
      return sendToContent(tabId, {
        type: 'act',
        action: 'scroll',
        direction: step.direction ?? 'down',
      });

    case 'click':
    case 'find': {
      if (!target) return { ok: false, reason: 'no_target' };
      const cx = safeCoord(target.x + target.width  / 2);
      const cy = safeCoord(target.y + target.height / 2);
      if (cx === null || cy === null) return { ok: false, reason: 'bad_coords' };
      return sendToContent(tabId, {
        type: 'act',
        action: step.action === 'find' ? 'highlight' : 'click',
        x: cx,
        y: cy,
        elementId: target.id ?? null,
      });
    }

    case 'type': {
      if (!target) return { ok: false, reason: 'no_target' };
      const cx = safeCoord(target.x + target.width  / 2);
      const cy = safeCoord(target.y + target.height / 2);
      if (cx === null || cy === null) return { ok: false, reason: 'bad_coords' };
      // Never type into password fields
      if (target.inputType === 'password') {
        return { ok: false, reason: 'password_field_blocked' };
      }
      return sendToContent(tabId, {
        type: 'act',
        action: 'type',
        x: cx,
        y: cy,
        value: String(step.value ?? '').slice(0, 500), // cap length
        elementId: target.id ?? null,
      });
    }

    default:
      return { ok: false, reason: `unknown_action:${step.action}` };
  }
}

// ── Overlay controls ───────────────────────────────────────────────────────
export async function showOverlay(tabId, element) {
  if (!element) return;
  return sendToContent(tabId, {
    type: 'overlay_show',
    element: sanitizeElement(element),
  });
}

export async function clearOverlay(tabId) {
  return sendToContent(tabId, { type: 'overlay_clear' });
}

// ── Internal helpers ───────────────────────────────────────────────────────
async function sendToContent(tabId, message) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, message);
    return result ?? { ok: false, reason: 'no_response' };
  } catch (err) {
    // Content script not injected yet or tab navigated away
    return { ok: false, reason: `send_failed: ${err.message}` };
  }
}

function validateStep(step) {
  if (!step || typeof step !== 'object') throw new Error('Invalid step');
  const allowed = ['click', 'type', 'scroll', 'find'];
  if (!allowed.includes(step.action)) throw new Error(`Unknown action: ${step.action}`);
}

function safeCoord(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return null;
  return Math.round(n);
}

// Only pass safe scalar fields to content scripts
function sanitizeElement(el) {
  return {
    id:         el.id         ?? null,
    label:      String(el.label  ?? '').slice(0, 80),
    text:       String(el.text   ?? '').slice(0, 80),
    x:          safeCoord(el.x)      ?? 0,
    y:          safeCoord(el.y)      ?? 0,
    width:      safeCoord(el.width)  ?? 0,
    height:     safeCoord(el.height) ?? 0,
    confidence: typeof el.confidence === 'number' ? el.confidence : 1,
    source:     el.source === 'vision' ? 'vision' : 'dom',
  };
}
