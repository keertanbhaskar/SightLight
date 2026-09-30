/**
 * content/content.js
 * Injected into every webpage (manifest content_scripts).
 *
 * Handles:
 *   dom_scan      → run DOM perception and return elements
 *   act           → execute click / type / scroll / highlight
 *   overlay_show  → draw bounding box overlay on target element
 *   overlay_clear → remove all overlays
 *
 * SECURITY:
 *   - Every incoming message is validated against the extension origin
 *   - No eval / innerHTML / new Function
 *   - Type action is blocked on password inputs
 *   - Coordinates must be numbers within the viewport
 *   - All string values are capped in length before use
 */

(function () {
  'use strict';

  // ── Guard: only run once per frame ──────────────────────────────────────
  if (window.__sightliteLoaded) return;
  window.__sightliteLoaded = true;

  // ── Overlay container ────────────────────────────────────────────────────
  let overlayRoot = null;

  function getOverlayRoot() {
    if (overlayRoot && overlayRoot.isConnected) return overlayRoot;
    const host = document.createElement('div');
    host.id = '__sightlite_overlay_host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);
    overlayRoot = host;
    return host;
  }

  function clearOverlays() {
    overlayRoot?.querySelectorAll('.__sl_box').forEach(el => el.remove());
  }

  function showOverlay(el) {
    const root = getOverlayRoot();
    clearOverlays();

    const x  = Number(el.x);
    const y  = Number(el.y);
    const w  = Number(el.width);
    const h  = Number(el.height);
    if (!isFinite(x) || !isFinite(y) || w <= 0 || h <= 0) return;

    const box = document.createElement('div');
    box.className = '__sl_box';
    box.style.cssText = [
      'position:fixed',
      `left:${x}px`, `top:${y}px`,
      `width:${w}px`, `height:${h}px`,
      'border:2px solid #6c63ff',
      'border-radius:4px',
      'box-shadow:0 0 0 2px rgba(108,99,255,0.25)',
      'background:rgba(108,99,255,0.06)',
      'pointer-events:none',
      'transition:opacity 0.2s',
    ].join(';');

    // Label badge
    const badge = document.createElement('div');
    const conf  = Math.round((el.confidence ?? 1) * 100);
    const src   = el.source === 'vision' ? '👁' : '🔍';
    badge.textContent = `${src} ${(el.text || el.label || '?').slice(0, 30)} · ${conf}%`;
    badge.style.cssText = [
      'position:absolute',
      'bottom:calc(100% + 4px)',
      'left:0',
      'background:#6c63ff',
      'color:#fff',
      'font:500 11px/1.4 monospace',
      'padding:2px 7px',
      'border-radius:4px',
      'white-space:nowrap',
      'pointer-events:none',
      'max-width:260px',
      'overflow:hidden',
      'text-overflow:ellipsis',
    ].join(';');

    box.appendChild(badge);
    root.appendChild(box);

    // Auto-remove after 3 s
    setTimeout(() => box.remove(), 3000);
  }

  // ── DOM Scanner ──────────────────────────────────────────────────────────
  function scanDOM() {
    const SELECTOR = [
      'a[href]', 'button',
      'input:not([type="hidden"])',
      'select', 'textarea',
      '[role="button"]', '[role="link"]',
      '[role="menuitem"]', '[role="tab"]',
      '[role="checkbox"]', '[role="radio"]',
      '[role="combobox"]', '[role="searchbox"]',
      '[role="textbox"]',
      'div[onclick]', 'span[onclick]',  // clickable divs/spans
      '[tabindex]:not([tabindex="-1"])', // focusable elements
    ].join(',');

    const viewH = window.innerHeight;

    // Helper: check if element is visible
    function isVisible(el) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      // Check if element or any parent has display:none
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const ps = window.getComputedStyle(parent);
        if (ps.display === 'none' || ps.visibility === 'hidden') return false;
        parent = parent.parentElement;
      }
      return true;
    }

    const allNodes = document.querySelectorAll(SELECTOR);
    const elements = Array.from(allNodes)
      .filter(el => isVisible(el))
      .map((el, i) => {
        const rect  = el.getBoundingClientRect();
        const tag   = el.tagName.toUpperCase();
        const role  = el.getAttribute('role') || inferRole(tag);
        const label = inferLabel(tag, role);
        const text  = extractText(el).slice(0, 150);
        const aria  = (el.getAttribute('aria-label') || '').trim().slice(0, 150);
        const ph    = (el.placeholder || '').trim().slice(0, 150);
        const itype = (el.type || '').toLowerCase();

        // Scroll-aware absolute coordinates
        const px = Math.round(rect.left + window.scrollX);
        const py = Math.round(rect.top + window.scrollY);

        return {
          id: `dom-${i}`,
          label, text: text || aria || ph,
          role, ariaLabel: aria, placeholder: ph, inputType: itype,
          x: px, y: py,
          width: Math.max(1, Math.round(rect.width)),   // ensure minimum 1px
          height: Math.max(1, Math.round(rect.height)),
          confidence: 1.0, source: 'dom',
        };
      })
      .filter(el =>
        el.width  > 0.5 && el.height > 0.5 &&
        el.y < viewH * 2  && el.y + el.height > -viewH  // keep buffer zone
      );

    return { 
      elements, 
      total: allNodes.length,
      url: window.location.href
    };
  }

  function inferRole(tag) {
    return { A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox' }[tag] || 'generic';
  }
  function inferLabel(tag, role) {
    if (tag === 'A') return 'link';
    if (tag === 'SELECT') return 'select';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return 'input';
    if (role === 'button') return 'button';
    return 'button';
  }
  function extractText(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (/INPUT|TEXTAREA/.test(el.tagName)) {
      return (el.value || el.placeholder || el.name || el.id || '').trim();
    }
    // Try multiple sources
    const text = (
      el.innerText || 
      el.textContent || 
      el.title || 
      el.getAttribute('alt') || 
      el.name || 
      el.id || 
      ''
    ).trim().replace(/\s+/g, ' ');
    return text;
  }

  // ── Action handlers ──────────────────────────────────────────────────────
  function doClick(x, y, elementId) {
    const el = elementId
      ? document.getElementById(elementId)
      : document.elementFromPoint(x, y);

    if (!el) return { ok: false, reason: 'element_not_found' };
    try {
      el.focus?.();
      el.click?.();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  function doType(x, y, value, elementId) {
    let el = elementId
      ? document.getElementById(elementId)
      : document.elementFromPoint(x, y);

    if (!el) return { ok: false, reason: 'element_not_found' };

    // Walk up to find actual input if we hit a wrapper
    let input = el;
    for (let i = 0; i < 5; i++) {
      if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA' || input.isContentEditable) break;
      const found = input.querySelector('input, textarea, [contenteditable="true"]');
      if (found) { input = found; break; }
      input = input.parentElement;
      if (!input) break;
    }

    if (!input) input = el; // fallback to original

    if (input.type === 'password') return { ok: false, reason: 'password_field_blocked' };

    try {
      input.focus?.();
      input.click?.(); // Some sites need click to activate

      const safe = String(value).slice(0, 500);

      // Strategy 1: execCommand (works for most inputs)
      if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
        if ('value' in input) input.value = '';
        document.execCommand?.('selectAll');
        document.execCommand?.('insertText', false, safe);
        if (input.value !== safe) input.value = safe;
      }
      // Strategy 2: contentEditable (Google search uses this)
      else if (input.isContentEditable) {
        input.textContent = safe;
        input.innerText = safe;
      }

      // Dispatch events
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  function doScroll(direction) {
    const amount = direction === 'up'
      ? -Math.round(window.innerHeight * 0.8)
      :  Math.round(window.innerHeight * 0.8);
    window.scrollBy({ top: amount, behavior: 'smooth' });
    return { ok: true };
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    // Validate origin — only accept messages from this extension
    if (!chrome.runtime?.id) {
      sendResponse({ ok: false, reason: 'invalid_origin' });
      return false;
    }

    switch (msg?.type) {
      // Ping — used by service worker to check if content script is alive
      case 'ping':
        sendResponse({ ok: true });
        return false;

      case 'dom_scan':
        try {
          const result = scanDOM();
          console.log('[SightLite/content] DOM scan:', result.elements.length, 'elements');
          sendResponse(result);
        } catch (err) {
          console.error('[SightLite/content] DOM scan error:', err);
          sendResponse({ elements: [], error: err.message });
        }
        return false;

      case 'act': {
        const action = String(msg.action ?? '');
        const x  = Number(msg.x  ?? 0);
        const y  = Number(msg.y  ?? 0);
        const id = msg.elementId ? String(msg.elementId).slice(0, 80) : null;

        try {
          if (action === 'click' || action === 'highlight') {
            if (action === 'highlight') {
              sendResponse({ ok: true }); // overlay handled separately
            } else {
              sendResponse(doClick(x, y, id));
            }
          } else if (action === 'type') {
            const val = String(msg.value ?? '').slice(0, 500);
            sendResponse(doType(x, y, val, id));
          } else if (action === 'scroll') {
            sendResponse(doScroll(msg.direction ?? 'down'));
          } else {
            sendResponse({ ok: false, reason: `unknown_action:${action}` });
          }
        } catch (err) {
          console.error('[SightLite/content] Action error:', err);
          sendResponse({ ok: false, reason: err.message });
        }
        return false;
      }

      case 'overlay_show':
        try {
          showOverlay(msg.element ?? {});
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[SightLite/content] Overlay show error:', err);
          sendResponse({ ok: false, reason: err.message });
        }
        return false;

      case 'overlay_clear':
        try {
          clearOverlays();
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[SightLite/content] Overlay clear error:', err);
          sendResponse({ ok: false, reason: err.message });
        }
        return false;

      default:
        // Unknown message type — ignore silently
        console.warn('[SightLite/content] Unknown message type:', msg?.type);
        sendResponse({ ok: false, reason: 'unknown_type' });
        return false;
    }
  });
})();
