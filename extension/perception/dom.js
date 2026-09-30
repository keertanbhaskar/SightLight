/**
 * perception/dom.js
 * DOM-based fallback perception.
 *
 * This runs INSIDE the content script (content/content.js imports nothing —
 * the content script is a plain script, not a module). So this file's logic
 * is inlined by content.js at build time.  The service worker calls the
 * content script via message; the content script executes this logic and
 * returns the results.
 *
 * IMPORTANT: DOM fallback is NOT visual perception.
 *   Vision  → pixels → detected UI elements
 *   DOM     → HTML structure → UI elements
 *
 * The UI always labels the source explicitly.
 */

/**
 * Scan the live DOM and return a normalized array of interactive elements.
 * Called from within the page context (content script).
 *
 * @returns {{ dpr: number, elements: NormalizedElement[] }}
 */
export function scanDOM() {
  const SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="textbox"]',
  ].join(',');

  const viewH = window.innerHeight;
  const dpr   = window.devicePixelRatio || 1;

  const elements = Array.from(document.querySelectorAll(SELECTOR))
    .map((el, i) => {
      const rect  = el.getBoundingClientRect();
      const tag   = el.tagName.toUpperCase();
      const role  = el.getAttribute('role') || inferRole(tag);
      const label = inferLabel(tag, role);
      const text  = extractText(el).slice(0, 120);
      const aria  = (el.getAttribute('aria-label') || '').trim().slice(0, 120);
      const ph    = (el.placeholder || '').trim().slice(0, 120);
      const itype = (el.type || '').toLowerCase();

      return {
        id:          `dom-${i}`,
        label,
        text:        text || aria || ph,
        role,
        ariaLabel:   aria,
        placeholder: ph,
        inputType:   itype,
        x:           Math.round(rect.left),
        y:           Math.round(rect.top),
        width:       Math.round(rect.width),
        height:      Math.round(rect.height),
        confidence:  1.0,
        source:      'dom',
      };
    })
    .filter(el =>
      el.width  > 2 &&
      el.height > 2 &&
      el.y < viewH &&
      el.y + el.height > 0
    );

  return { dpr, elements };
}

// ── helpers ────────────────────────────────────────────────────────────────
function inferRole(tag) {
  const map = {
    A: 'link', BUTTON: 'button', INPUT: 'textbox',
    SELECT: 'combobox', TEXTAREA: 'textbox',
  };
  return map[tag] || 'generic';
}

function inferLabel(tag, role) {
  if (tag === 'A')        return 'link';
  if (tag === 'SELECT')   return 'select';
  if (tag === 'TEXTAREA') return 'input';
  if (tag === 'INPUT')    return 'input';
  if (role === 'button')  return 'button';
  return 'button';
}

function extractText(el) {
  // Prefer explicit label > inner text > value > placeholder > name > id
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();

  // For inputs, value or placeholder is more useful than innerText
  if (/INPUT|TEXTAREA/.test(el.tagName)) {
    return (el.value || el.placeholder || el.name || '').trim();
  }

  const inner = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
  if (inner) return inner;

  return (el.title || el.name || el.id || '').trim();
}
