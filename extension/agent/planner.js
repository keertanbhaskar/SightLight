/**
 * agent/planner.js
 * Deterministic ranked planner.
 *
 * Ranking order (highest → lowest):
 *   1. Exact text match
 *   2. Exact label/role match
 *   3. Partial text match (includes)
 *   4. Any single word from key appears in text
 *   5. Aria-label / placeholder includes
 *   6. Role match
 *
 * Minimum confidence threshold: 0.25  (lowered from 0.35 — DOM elements
 * always have confidence=1.0 so the combined score equals the planner score)
 */

// ── Goal parser ────────────────────────────────────────────────────────────
export function parseGoal(goal) {
  if (!goal || !goal.trim()) return [];

  return goal
    .trim()
    .split(/\s+then\s+/i)
    .map(c => c.trim())
    .filter(Boolean)
    .map(clause => {
      // type "value" in target
      let m = clause.match(/^type\s+"([^"]+)"\s+in\s+(.+)$/i);
      if (m) return { action: 'type', value: m[1], target: m[2].trim() };

      // type value in target (no quotes)
      m = clause.match(/^type\s+(\S+)\s+in\s+(.+)$/i);
      if (m) return { action: 'type', value: m[1], target: m[2].trim() };

      // scroll
      if (/^scroll(\s+(down|up))?$/i.test(clause)) {
        return { action: 'scroll', direction: /up/i.test(clause) ? 'up' : 'down', target: null };
      }

      // find → treated as click (highlights + completes)
      m = clause.match(/^find\s+(.+)$/i);
      if (m) return { action: 'find', target: m[1].trim() };

      // click (default)
      const target = clause.replace(/^click\s+/i, '').trim();
      return { action: 'click', target };
    });
}

// ── Element picker ─────────────────────────────────────────────────────────
// Threshold lowered: DOM confidence is always 1.0, so combined = planner score.
// 0.25 means "at least one meaningful keyword matched somewhere".
const CONFIDENCE_THRESHOLD = 0.25;

export function pickElement(elements, targetKeyword) {
  if (!elements || elements.length === 0) return null;
  if (!targetKeyword) return null;

  const key = targetKeyword.toLowerCase().trim();

  // Extract individual tokens — useful for subject codes like "BAI702"
  const tokens = key.split(/[\s\-_]+/).filter(t => t.length >= 2);

  const scored = elements
    .map(el => ({ el, score: scoreElement(el, key, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0];
  const combinedConfidence = best.score * (best.el.confidence ?? 1.0);
  if (combinedConfidence < CONFIDENCE_THRESHOLD) return null;

  return { ...best.el, plannerScore: best.score, combinedConfidence };
}

function scoreElement(el, key, tokens) {
  const text  = (el.text  ?? '').toLowerCase();
  const label = (el.label ?? '').toLowerCase();
  const role  = (el.role  ?? '').toLowerCase();
  const aria  = (el.ariaLabel ?? '').toLowerCase();
  const ph    = (el.placeholder ?? '').toLowerCase();
  const all   = `${text} ${aria} ${ph}`;

  // Exact full-string match
  if (text === key)  return 1.00;
  if (aria === key)  return 0.95;
  if (label === key) return 0.90;

  // Full key is a substring of text
  if (text.includes(key))  return 0.80;
  if (aria.includes(key))  return 0.70;
  if (ph.includes(key))    return 0.65;

  // Every token matches somewhere in the combined text
  if (tokens.length > 0) {
    const allMatch = tokens.every(t => all.includes(t));
    if (allMatch) return 0.60;

    // First token (often the subject code like "BAI702") matches — strong signal
    if (tokens.length >= 1 && all.includes(tokens[0])) return 0.50;

    // Any single token matches
    const anyMatch = tokens.some(t => all.includes(t));
    if (anyMatch) return 0.35;
  }

  // Role matches key word
  if (role.includes(key) || key.includes(role)) return 0.20;

  return 0;
}

// ── Safety check ───────────────────────────────────────────────────────────
const DESTRUCTIVE_PATTERNS = [
  /\b(delete|remove|clear|reset|wipe)\b/i,
  /\b(submit|send|pay|purchase|buy|checkout|confirm|place order)\b/i,
  /\b(password|passcode|pin)\b/i,
  /\b(logout|sign out|deactivate|close account)\b/i,
];

export function isDestructive(step) {
  const text = `${step.action} ${step.target ?? ''} ${step.value ?? ''}`;
  return DESTRUCTIVE_PATTERNS.some(p => p.test(text));
}
