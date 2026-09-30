/**
 * perception/normalizer.js
 * Shared normalized element format used by BOTH vision and DOM perception.
 * The planner and action executor only ever see this format — they are
 * completely independent of how the element was detected.
 *
 * Normalized element:
 * {
 *   id:          string   — unique id within this perception result
 *   label:       string   — semantic category: button|input|link|select|text|icon|image|other
 *   text:        string   — visible text / value / placeholder / aria-label
 *   role:        string   — ARIA role or inferred role
 *   ariaLabel:   string   — explicit aria-label attribute
 *   placeholder: string   — input placeholder if applicable
 *   inputType:   string   — input type attribute (text|password|email|search|…) or ''
 *   x:           number   — left edge in CSS pixels (viewport-relative)
 *   y:           number   — top  edge in CSS pixels (viewport-relative)
 *   width:       number   — element width  in CSS pixels
 *   height:      number   — element height in CSS pixels
 *   confidence:  number   — 0–1 (1.0 for DOM, model score for vision)
 *   source:      'vision' | 'dom'
 * }
 */

let _counter = 0;

export function makeId() {
  return `el-${++_counter}`;
}

export function resetIds() {
  _counter = 0;
}

/**
 * Validate and clamp a raw element object into the normalised format.
 * Accepts partial objects — missing fields get safe defaults.
 */
export function normalize(raw, source) {
  const src = source === 'vision' ? 'vision' : 'dom';
  return {
    id:          raw.id          ?? makeId(),
    label:       sanitizeLabel(raw.label),
    text:        String(raw.text        ?? '').trim().slice(0, 120),
    role:        String(raw.role        ?? '').trim().slice(0, 40),
    ariaLabel:   String(raw.ariaLabel   ?? '').trim().slice(0, 120),
    placeholder: String(raw.placeholder ?? '').trim().slice(0, 120),
    inputType:   String(raw.inputType   ?? '').trim().slice(0, 30),
    x:           clampCoord(raw.x),
    y:           clampCoord(raw.y),
    width:       clampDim(raw.width  ?? raw.w),
    height:      clampDim(raw.height ?? raw.h),
    confidence:  clampConf(raw.confidence ?? raw.conf),
    source:      src,
  };
}

/** Normalize an array and filter out zero-size / off-screen elements */
export function normalizeAll(raws, source, viewportHeight = Infinity) {
  resetIds();
  return raws
    .map(r => normalize(r, source))
    .filter(el =>
      el.width  > 2 &&
      el.height > 2 &&
      el.y < viewportHeight &&
      el.y + el.height > 0
    );
}

// ── internal helpers ───────────────────────────────────────────────────────
const VALID_LABELS = new Set([
  'button', 'input', 'link', 'select', 'textarea',
  'text', 'icon', 'image', 'other',
]);

function sanitizeLabel(raw) {
  const s = String(raw ?? '').toLowerCase().trim();
  return VALID_LABELS.has(s) ? s : 'other';
}

function clampCoord(n) {
  const v = Number(n);
  return isFinite(v) ? Math.round(v) : 0;
}

function clampDim(n) {
  const v = Number(n);
  return isFinite(v) && v > 0 ? Math.round(v) : 0;
}

function clampConf(n) {
  const v = Number(n);
  if (!isFinite(v)) return 1.0;
  return Math.min(1, Math.max(0, v));
}
