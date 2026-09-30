/* global chrome */
'use strict';

// ═══════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════
const MAX_RETRIES    = 2;
const MAX_STEPS      = 15;
const MAX_RUNTIME_MS = 90000;
const BACKEND        = 'http://localhost:8000';

// ═══════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════
var state = makeState();
function makeState() {
  return {
    status:'IDLE', goal:'', steps:[], stepIndex:0,
    startedAt:0, elements:[], target:null,
    stopReq:false, pauseReq:false, sessionId:null,
  };
}

// ═══════════════════════════════════════════════
// CONTEXT MENU (Right-click text selection)
// ═══════════════════════════════════════════════
chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: 'sightlite-explain',
    title: '🔍 Explain with SightLite',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'sightlite-answer',
    title: '💡 Answer with SightLite',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId === 'sightlite-explain' || info.menuItemId === 'sightlite-answer') {
    var text = (info.selectionText || '').slice(0, 2000);
    var mode = info.menuItemId === 'sightlite-explain' ? 'explain' : 'answer';
    handleAIRequest(text, mode, tab.id);
  }
});

async function handleAIRequest(text, mode, tabId) {
  if (!text || !text.trim()) {
    panel({ type: 'ai_response', status: 'error', text: 'No text selected' });
    return;
  }

  emit('OBSERVING', mode === 'explain' ? '🔍 Explaining...' : '💡 Answering...', text.slice(0, 100));

  try {
    var apiKey = 'AIzaSyAQAb8RN6JkrRVpPDfYpTrUuUuSkCpG2BwDnb_ql-NFBmAOzFhUgQ';
    var prompt = mode === 'explain'
      ? 'Explain this clearly and concisely in 2-3 sentences:\n\n' + text
      : 'Answer this question directly and concisely:\n\n' + text;

    var response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    if (!response.ok) {
      var errorData = await response.text();
      throw new Error('API error ' + response.status + ': ' + errorData);
    }

    var data = await response.json();
    var result = data.candidates && data.candidates[0] && data.candidates[0].content &&
                 data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
                 data.candidates[0].content.parts[0].text;

    if (!result) throw new Error('No response from API');

    emit('COMPLETED', mode === 'explain' ? '✓ Explanation' : '✓ Answer', result.slice(0, 200));
    panel({ type: 'ai_response', status: 'success', text: result, mode: mode, query: text.slice(0, 100) });

  } catch(e) {
    console.error('[SL] AI error:', e);
    emit('ERROR', '✗ AI request failed', e.message);
    panel({ type: 'ai_response', status: 'error', text: 'Error: ' + e.message });
  }
}

// ═══════════════════════════════════════════════
// SIDE PANEL
// ═══════════════════════════════════════════════
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick:true }).catch(function(){});

// ═══════════════════════════════════════════════
// MESSAGE HUB
// ═══════════════════════════════════════════════
chrome.runtime.onMessage.addListener(function(msg, _sender, reply) {
  if (!msg || !msg.type) return false;

  // Vision inference - forward to offscreen
  if (msg.type === 'vision_infer') return false;

  if (msg.type === 'agent_start') {
    run(msg.goal, msg.tabId).catch(function(e){ console.error('[SL]', e); });
    reply({ ok:true });
    return true;
  }
  if (msg.type === 'agent_stop')  { state.stopReq = true; reply({ ok:true }); return false; }
  if (msg.type === 'agent_pause') { state.pauseReq = !state.pauseReq; reply({ paused:state.pauseReq }); return false; }
  if (msg.type === 'confirm_destructive') { if (_resolveDest) _resolveDest(msg.confirmed); reply({ ok:true }); return false; }
  return false;
});
// ═══════════════════════════════════════════════
async function run(goal, tabId) {
  if (state.status !== 'IDLE' && state.status !== 'COMPLETED' &&
      state.status !== 'STOPPED' && state.status !== 'ERROR') {
    emit('OBSERVING', '⚠ Agent already running');
    return;
  }

  state = makeState();
  state.goal      = goal;
  state.startedAt = Date.now();

  var steps = await parseGoal(goal);
  if (!steps.length) {
    emit('ERROR', '✗ Cannot parse goal. Try: "click Login" or "scroll down"');
    return;
  }
  state.steps = steps;
  emit('OBSERVING', 'Goal: "' + goal + '"', steps.length + ' step(s)');

  try {
    var tab0 = await chrome.tabs.get(tabId);
    if (!tab0 || !tab0.url) { emit('ERROR', '✗ Cannot access tab'); return; }
    if (tab0.url.startsWith('chrome://') || tab0.url.startsWith('chrome-extension://')) {
      emit('ERROR', '✗ Cannot run on Chrome internal pages'); return;
    }
  } catch(e) {
    emit('ERROR', '✗ Permission denied. Reload the extension.'); return;
  }

  state.sessionId = await apiCreateSession(goal, tabId);

  for (var si = 0; si < steps.length; si++) {
    state.stepIndex = si;
    var step = steps[si];

    if (state.stopReq) break;
    if (si >= MAX_STEPS || Date.now() - state.startedAt > MAX_RUNTIME_MS) {
      emit('STOPPED', '⚠ Safety limit reached'); break;
    }

    emit('OBSERVING', 'Step ' + (si+1) + '/' + steps.length + ': ' + stepDesc(step));

    // ── PERCEPTION ──────────────────────────────────────────────────────
    var elements = null;
    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (state.stopReq) break;
      emit('PERCEIVING', attempt === 0 ? 'Scanning page…' : 'Retry ' + attempt + '…');

      var pr = await perceive(tabId, step.target);
      if (pr && pr.elements && pr.elements.length > 0) {
        elements = pr.elements;
        state.elements = elements;
        emit('PERCEIVING',
          (pr.source === 'vision' ? '👁 Vision' : '🔍 DOM') +
          ' — ' + elements.length + ' elements',
          pr.source + ' | ' + (pr.ms||0) + 'ms');
        panel({ type:'perception_update', count:elements.length, source:pr.source, inferenceMs:pr.ms||0 });
        await apiLogFrame(state.sessionId, elements, pr.ms||0);
        break;
      }
      if (attempt < MAX_RETRIES) await wait(800);
    }

    if (!elements || !elements.length) {
      emit('ERROR', '✗ Perception failed', 'Page could not be scanned. Reload and try again.');
      break;
    }
    if (state.stopReq) break;

    // ── SCROLL ───────────────────────────────────────────────────────────
    if (step.action === 'scroll') {
      emit('ACTING', 'Scrolling ' + (step.dir||'down'));
      
      // Try content script first
      await ensureContentScript(tabId);
      var sr = await msgTab(tabId, { type:'act', action:'scroll', direction:step.dir||'down' });
      
      // If content script scroll failed, use executeScript fallback
      if (!sr || !sr.ok) {
        console.log('[SL] Content script scroll failed, using executeScript');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: function(direction) {
              var amount = direction === 'up' 
                ? -Math.round(window.innerHeight * 0.8)
                : Math.round(window.innerHeight * 0.8);
              window.scrollBy({ top: amount, behavior: 'smooth' });
              return { ok: true };
            },
            args: [step.dir || 'down'],
          });
          sr = { ok: true };
        } catch(e) {
          console.error('[SL] executeScript scroll failed:', e.message);
          sr = { ok: false };
        }
      }
      
      emit(sr && sr.ok ? 'WAITING' : 'ERROR', sr && sr.ok ? '↓ Scrolled' : '✗ Scroll failed');
      if (!sr || !sr.ok) break;
      await wait(700);
      continue;
    }

    // ── AI ACTIONS (explain/answer) ──────────────────────────────────────
    if (step.action === 'explain' || step.action === 'answer') {
      emit('ACTING', (step.action === 'explain' ? '🔍 Explaining' : '💡 Answering') + '...');
      
      var textToAnalyze = step.value || step.target;
      
      // If no specific text provided, extract main content from the page
      if (!textToAnalyze || textToAnalyze === 'this' || textToAnalyze === 'this page' || 
          textToAnalyze === 'this article' || textToAnalyze === 'the page' || textToAnalyze === 'the article') {
        emit('PERCEIVING', 'Extracting page content...');
        textToAnalyze = await extractPageContent(tabId);
        if (!textToAnalyze) {
          emit('ERROR', '✗ Could not extract page content');
          break;
        }
        emit('PERCEIVING', 'Extracted ' + textToAnalyze.length + ' characters');
      }
      
      await handleAIRequest(textToAnalyze, step.action, tabId);
      await wait(1000);
      
      // Skip perception and planning for AI actions
      while (state.pauseReq && !state.stopReq) { emit('WAITING','⏸ Paused'); await wait(500); }
      continue;
    }

    // ── PLAN ─────────────────────────────────────────────────────────────
    emit('PLANNING', 'Looking for: "' + step.target + '"');
    var target = pick(elements, step.target);
    state.target = target;

    if (!target) {
      var sample = elements.slice(0, 8).map(function(e) {
        return '"' + (e.text||e.label||'?').slice(0,25) + '"';
      }).join(', ');
      emit('STOPPED',
        '⚠ "' + step.target + '" not found on page',
        'Visible: ' + sample);
      await clearOverlay(tabId);
      break;
    }

    emit('PLANNING',
      'Target: "' + (target.text||target.label).slice(0,50) + '"',
      'Score: ' + Math.round((target.score||0)*100) + '% | ' + target.source);

    // ── SAFETY CHECK ─────────────────────────────────────────────────────
    if (isDestructive(step)) {
      emit('WAITING', '⚠ Confirm required for: ' + step.action + ' "' + step.target + '"');
      var confirmed = await waitConfirm(step);
      if (!confirmed) { emit('STOPPED', 'Cancelled by user'); await clearOverlay(tabId); break; }
    }

    // ── OVERLAY ───────────────────────────────────────────────────────────
    await showOverlay(tabId, target);
    await wait(300);
    if (state.stopReq) { await clearOverlay(tabId); break; }

    // ── ACT ───────────────────────────────────────────────────────────────
    emit('ACTING', step.action.toUpperCase() + ' → "' + (target.text||target.label).slice(0,40) + '"');
    var ar = await doAct(tabId, step, target);
    await apiLogAction(state.sessionId, step, target, ar && ar.ok);

    if (!ar || !ar.ok) {
      emit('ERROR', '✗ Action failed: ' + (ar ? ar.reason : 'unknown'));
      await clearOverlay(tabId);
      break;
    }

    emit('WAITING', '✓ ' + step.action.toUpperCase() + ' done',
      '"' + (target.text||target.label).slice(0,50) + '"');
    await wait(step.action === 'click' ? 1200 : 400);
    await clearOverlay(tabId);

    while (state.pauseReq && !state.stopReq) { emit('WAITING','⏸ Paused'); await wait(500); }
  }

  await clearOverlay(tabId).catch(function(){});

  if (state.stopReq) {
    emit('STOPPED', '■ Stopped by user');
  } else if (state.status === 'WAITING' || state.status === 'ACTING' || state.status === 'PLANNING') {
    emit('COMPLETED', '✓ Task complete');
  }
  await apiEndSession(state.sessionId, state.status === 'COMPLETED' ? 'success' : 'stopped');
}

// ═══════════════════════════════════════════════
// PAGE CONTENT EXTRACTION
// ═══════════════════════════════════════════════
async function extractPageContent(tabId) {
  try {
    var result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        // Strategy 1: Look for main article content
        var selectors = [
          'article', 'main', '[role="main"]',
          '.article-content', '.post-content', '.entry-content',
          '#content', '.content', '.page-content'
        ];
        
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            var text = el.innerText || el.textContent;
            if (text && text.trim().length > 200) {
              return text.trim().slice(0, 4000); // Limit to 4000 chars
            }
          }
        }
        
        // Strategy 2: Get all paragraph text
        var paragraphs = document.querySelectorAll('p');
        var combined = '';
        for (var j = 0; j < paragraphs.length; j++) {
          var pText = paragraphs[j].innerText || paragraphs[j].textContent;
          if (pText && pText.trim().length > 30) {
            combined += pText.trim() + '\n\n';
            if (combined.length > 4000) break;
          }
        }
        
        if (combined.length > 200) {
          return combined.slice(0, 4000);
        }
        
        // Strategy 3: Fallback to body text (filtered)
        var bodyText = document.body.innerText || document.body.textContent;
        // Remove navigation, headers, footers by filtering short lines
        var lines = bodyText.split('\n').filter(function(line) {
          return line.trim().length > 40; // Keep only substantial lines
        });
        return lines.join('\n').slice(0, 4000);
      }
    });
    
    if (result && result[0] && result[0].result) {
      return result[0].result;
    }
    return null;
  } catch(e) {
    console.error('[SL] Content extraction failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════
// ENSURE CONTENT SCRIPT
// ═══════════════════════════════════════════════
async function ensureContentScript(tabId) {
  try {
    var pong = await chrome.tabs.sendMessage(tabId, { type:'ping' }).catch(function(){ return null; });
    if (pong && pong.ok) return true;
    await chrome.scripting.executeScript({ target:{ tabId:tabId }, files:['content/content.js'] });
    await wait(200);
    return true;
  } catch(e) {
    console.warn('[SL] ensureContentScript failed:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════
// PERCEPTION
// ═══════════════════════════════════════════════
// The key insight: vtucircle.com (and many SPAs) load their content
// via JavaScript AFTER the page loads. The static HTML only has a
// "Loading papers..." spinner.
//
// Strategy:
//   1. Wait up to 5 s for dynamic content to appear (poll for cards)
//   2. Scan ALL text-bearing elements — not just interactive ones —
//      so subject codes in headings/spans are detected
//   3. Fall back to content script if executeScript fails
// ─────────────────────────────────────────────────────────────────
async function perceive(tabId, searchHint) {

  // ── Wait for dynamic content to finish loading ─────────────────────────
  emit('PERCEIVING', 'Waiting for page content…');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(hint, maxWaitMs) {
        return new Promise(function(resolve) {
          var waited = 0;
          var interval = 200;

          function check() {
            // Look for any card-like content — typical selectors for paper cards
            var cardSelectors = [
              '[class*="card"]', '[class*="paper"]', '[class*="item"]',
              'article', '.post', '.entry',
            ];
            var hasCards = cardSelectors.some(function(sel) {
              try { return document.querySelectorAll(sel).length > 2; } catch(e){ return false; }
            });

            // Also check if "Loading" text is gone
            var body = document.body.innerText || '';
            var isLoading = body.includes('Loading papers') || body.includes('Loading...');

            // Also check if the hint keyword is present anywhere in the DOM text
            var hintFound = hint ? body.toLowerCase().includes(hint.toLowerCase()) : false;

            if (hasCards || hintFound || !isLoading || waited >= maxWaitMs) {
              resolve({ waited: waited, hasCards: hasCards, hintFound: hintFound });
            } else {
              waited += interval;
              setTimeout(check, interval);
            }
          }
          check();
        });
      },
      args: [searchHint || '', 5000],
    });
  } catch(e) {
    console.warn('[SL] Content wait failed:', e.message);
  }

  // ── Full DOM scan — interactive + all text nodes ───────────────────────
  try {
    var tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return null;
    }

    var r1 = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() {
        'use strict';

        function isVisible(el) {
          if (!el) return false;
          var s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
          var p = el.parentElement;
          while (p && p !== document.body) {
            var ps = window.getComputedStyle(p);
            if (ps.display === 'none' || ps.visibility === 'hidden') return false;
            p = p.parentElement;
          }
          return true;
        }

        function getText(el) {
          var aria = (el.getAttribute('aria-label') || '').trim();
          if (aria) return aria;
          var tag = el.tagName.toUpperCase();
          if (tag === 'INPUT' || tag === 'TEXTAREA')
            return (el.value || el.placeholder || el.getAttribute('name') || el.id || '').trim();
          return (el.innerText || el.textContent || el.title || el.getAttribute('alt') || '')
                   .replace(/\s+/g, ' ').trim();
        }

        function makeEl(el, idx, labelOverride) {
          var rect  = el.getBoundingClientRect();
          var tag   = el.tagName.toUpperCase();
          var lmap  = { A:'link', BUTTON:'button', INPUT:'input', SELECT:'select', TEXTAREA:'input' };
          var label = labelOverride || lmap[tag] || (el.getAttribute('role')) || 'button';
          return {
            id:          'e' + idx,
            label:       label,
            text:        getText(el).slice(0, 150),
            role:        el.getAttribute('role') || label,
            ariaLabel:   (el.getAttribute('aria-label') || '').slice(0, 150),
            placeholder: (el.placeholder || '').slice(0, 150),
            inputType:   (el.type || '').toLowerCase(),
            x:           Math.round(rect.left + window.scrollX),
            y:           Math.round(rect.top  + window.scrollY),
            width:       Math.max(1, Math.round(rect.width)),
            height:      Math.max(1, Math.round(rect.height)),
            confidence:  1.0,
            source:      'dom',
          };
        }

        var viewH  = window.innerHeight;
        var seen   = new Set();
        var result = [];
        var idx    = 0;

        // ── Pass 1: interactive elements ───────────────────────────────
        var interactive = document.querySelectorAll(
          'a[href],button,input:not([type="hidden"]),select,textarea,' +
          '[role="button"],[role="link"],[role="menuitem"],[role="tab"],' +
          '[role="checkbox"],[role="radio"],[role="combobox"],[role="textbox"],' +
          '[onclick],[tabindex]:not([tabindex="-1"])'
        );

        for (var n = 0; n < interactive.length; n++) {
          var el = interactive[n];
          if (seen.has(el) || !isVisible(el)) continue;
          var r = el.getBoundingClientRect();
          if (r.width < 0.5 && r.height < 0.5) continue;
          if (r.bottom < -(viewH) || r.top > viewH * 3) continue;
          seen.add(el);
          result.push(makeEl(el, idx++));
        }

        // ── Pass 2: ALL visible text nodes — ANY tag with short text ──
        // This is the critical fix for SPAs like vtucircle.com where
        // subject codes (BAD714C) appear in <h3>, <p>, <span>, <div>, <li>
        // as plain text with no interactive wrapper.
        var allNodes = document.querySelectorAll('*');
        for (var m = 0; m < allNodes.length; m++) {
          var tn = allNodes[m];
          if (seen.has(tn)) continue;

          var tag = tn.tagName.toUpperCase();
          // Skip structural/irrelevant tags
          if (/^(HTML|HEAD|BODY|SCRIPT|STYLE|META|LINK|SVG|PATH|BR|HR|NOSCRIPT|TEMPLATE|IFRAME)$/.test(tag)) continue;

          if (!isVisible(tn)) continue;

          var tr = tn.getBoundingClientRect();
          if (tr.width < 1 || tr.height < 1) continue;
          if (tr.bottom < -(viewH) || tr.top > viewH * 3) continue;

          // Only include nodes whose OWN text (not all descendants) is non-empty and short
          // We check this by looking at direct text node children
          var directText = '';
          for (var c = 0; c < tn.childNodes.length; c++) {
            if (tn.childNodes[c].nodeType === 3) { // TEXT_NODE
              directText += tn.childNodes[c].textContent;
            }
          }
          directText = directText.replace(/\s+/g, ' ').trim();

          // Must have meaningful direct text (2–120 chars)
          if (directText.length < 2 || directText.length > 120) continue;

          seen.add(tn);
          var entry = makeEl(tn, idx++, 'text');
          entry.text = directText; // use direct text, not all-descendant text
          result.push(entry);
        }

        return { elements: result, total: allNodes.length, url: window.location.href };
      },
    });

    var res = r1 && r1[0] && r1[0].result;
    if (res && res.elements && res.elements.length > 0) {
      console.log('[SL] DOM scan: ' + res.elements.length + ' elements on ' + res.url);
      return { elements: res.elements, source: 'dom', ms: 0 };
    }
    console.warn('[SL] DOM scan returned 0');
  } catch(e1) {
    console.warn('[SL] DOM scan failed:', e1.message);
  }

  // ── Fallback: content script ───────────────────────────────────────────
  try {
    var pong = await chrome.tabs.sendMessage(tabId, { type:'ping' }).catch(function(){ return null; });
    if (!pong || !pong.ok) {
      await chrome.scripting.executeScript({ target:{ tabId:tabId }, files:['content/content.js'] });
      await wait(300);
    }
    var r2 = await chrome.tabs.sendMessage(tabId, { type:'dom_scan' }).catch(function(){ return null; });
    if (r2 && r2.elements && r2.elements.length > 0) {
      console.log('[SL] Content script fallback: ' + r2.elements.length + ' elements');
      return { elements: r2.elements, source: 'dom', ms: 0 };
    }
  } catch(e2) {
    console.warn('[SL] Fallback failed:', e2.message);
  }

  return null;
}

// ═══════════════════════════════════════════════
// AI-POWERED GOAL PARSER
// ═══════════════════════════════════════════════
async function parseGoal(goal) {
  if (!goal || !goal.trim()) return [];
  
  // Try AI-powered natural language parsing first
  try {
    var aiSteps = await parseGoalWithAI(goal);
    if (aiSteps && aiSteps.length > 0) {
      console.log('[SL] AI parsed goal into', aiSteps.length, 'steps');
      return aiSteps;
    }
  } catch(e) {
    console.warn('[SL] AI parsing failed, using fallback:', e.message);
  }
  
  // Fallback to regex-based parsing
  return parseGoalLegacy(goal);
}

async function parseGoalWithAI(goal) {
  var apiKey = 'AIzaSyAQAb8RN6JkrRVpPDfYpTrUuUuSkCpG2BwDnb_ql-NFBmAOzFhUgQ';
  
  var prompt = `You are a browser automation parser. Convert the user's natural language goal into structured actions.

Available actions:
- click: Click on an element (e.g., button, link, text)
- type: Type text into a field
- scroll: Scroll up or down
- explain: Explain content (use "this" as target if explaining the whole page)
- answer: Answer a question (use "this" as target if answering about the page)

Rules:
1. Break multi-step goals into separate actions
2. For typing, identify the field and value
3. For explain/answer without specific text, use target: "this"
4. Use simple, clear target descriptions
5. Return ONLY valid JSON array, no explanation

Examples:
"explain this article" → [{"action": "explain", "target": "this"}]
"what is this page about" → [{"action": "answer", "target": "this", "value": "what is this page about"}]
"search for cats" → [{"action": "type", "target": "search", "value": "cats"}]

User goal: "${goal}"

Return JSON array of actions in this exact format:
[
  {"action": "click", "target": "Google search"},
  {"action": "type", "target": "search", "value": "cats"}
]`;

  var response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 }
    }),
  });

  if (!response.ok) throw new Error('AI parsing API error: ' + response.status);

  var data = await response.json();
  var result = data.candidates && data.candidates[0] && data.candidates[0].content && 
               data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
               data.candidates[0].content.parts[0].text;

  if (!result) throw new Error('No AI response');

  // Extract JSON from response (might have markdown formatting)
  var jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON in AI response');

  var steps = JSON.parse(jsonMatch[0]);
  
  // Validate and normalize steps
  return steps.map(function(step) {
    if (!step.action) throw new Error('Missing action');
    
    return {
      action: step.action.toLowerCase(),
      target: step.target || step.field || '',
      value: step.value || step.text || '',
      dir: step.direction || (step.action === 'scroll' ? 'down' : null)
    };
  });
}

function parseGoalLegacy(goal) {
  if (!goal || !goal.trim()) return [];
  return goal.trim()
    .split(/\s+(?:and\s+)?then\s+/i)  // Support "then" and "and then"
    .map(function(c){ return c.trim(); })
    .filter(Boolean)
    .map(function(clause) {
      var m;
      
      // "explain TEXT" or "answer TEXT" - AI feature
      m = clause.match(/^(explain|answer)\s+(.+)$/i);
      if (m) {
        return { action: m[1].toLowerCase(), target: m[2].trim(), value: m[2].trim() };
      }
      
      // "type VALUE in FIELD" format
      m = clause.match(/^type\s+"([^"]+)"\s+in\s+(.+)$/i);
      if (m) return { action:'type', value:m[1], target:m[2].trim() };
      m = clause.match(/^type\s+(\S+)\s+in\s+(.+)$/i);
      if (m) return { action:'type', value:m[1], target:m[2].trim() };
      
      // "fill FIELD with VALUE" format (new)
      m = clause.match(/^fill\s+(.+?)\s+with\s+(.+)$/i);
      if (m) return { action:'type', target:m[1].trim(), value:m[2].trim() };
      
      // "enter VALUE in FIELD" format (new)
      m = clause.match(/^enter\s+(.+?)\s+in\s+(.+)$/i);
      if (m) return { action:'type', value:m[1].trim(), target:m[2].trim() };
      
      // "search TEXT" format
      m = clause.match(/^search\s+(.+)$/i);
      if (m) return { action:'type', value:m[1].trim(), target:'search' };
      
      // Scroll
      if (/^scroll(\s+(down|up))?$/i.test(clause))
        return { action:'scroll', dir:/up/i.test(clause)?'up':'down', target:null };
      
      // Find
      m = clause.match(/^find\s+(.+)$/i);
      if (m) return { action:'find', target:m[1].trim() };
      
      // Default: click
      return { action:'click', target:clause.replace(/^click\s+/i,'').trim() };
    });
}

function pick(elements, keyword) {
  if (!elements || !elements.length || !keyword) return null;
  var key    = keyword.toLowerCase().trim();
  
  // Remove common UI element words that don't help matching
  var noise = ['button', 'radio', 'checkbox', 'link', 'field', 'input', 'box', 'option'];
  var cleaned = key;
  noise.forEach(function(n) {
    cleaned = cleaned.replace(new RegExp('\\b' + n + '\\b', 'gi'), '').trim();
  });
  
  // Use cleaned key if it's not empty
  if (cleaned.length >= 2) {
    key = cleaned;
  }
  
  var tokens = key.split(/[\s\-_]+/).filter(function(t){ return t.length >= 2; });

  var candidates = [];
  
  for (var i = 0; i < elements.length; i++) {
    var el  = elements[i];
    var t   = (el.text        || '').toLowerCase().trim();
    var a   = (el.ariaLabel   || '').toLowerCase().trim();
    var ph  = (el.placeholder || '').toLowerCase().trim();
    var all = t + ' ' + a + ' ' + ph;
    var sc  = 0;

    // EXACT match only (strict - no partial words)
    if (t === key || a === key || ph === key) {
      sc = 1.00;
    }
    // Exact match as whole word (with word boundaries)
    else if (new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t)) {
      sc = 0.98;
    }
    else if (new RegExp('\\b' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(a)) {
      sc = 0.96;
    }
    // Starts with key (only if it's the full start, not mid-word)
    else if (t.startsWith(key + ' ') || t === key || a.startsWith(key + ' ') || a === key) {
      sc = 0.94;
    }
    // Contains as full word (stricter substring)
    else if ((' ' + t + ' ').includes(' ' + key + ' ')) {
      sc = 0.88;
    }
    else if ((' ' + a + ' ').includes(' ' + key + ' ')) {
      sc = 0.84;
    }
    // For multi-word search terms, require ALL tokens present in order
    else if (tokens.length >= 2) {
      var allTokensMatch = true;
      var lastPos = -1;
      
      for (var ti = 0; ti < tokens.length; ti++) {
        var tokenPos = all.indexOf(tokens[ti], lastPos + 1);
        if (tokenPos === -1) {
          allTokensMatch = false;
          break;
        }
        lastPos = tokenPos;
      }
      
      if (allTokensMatch) {
        // All tokens present in correct order
        sc = 0.75;
      } else {
        // Try matching all tokens in any order
        var matched = tokens.filter(function(tk){ return all.includes(tk); });
        if (matched.length === tokens.length) {
          sc = 0.65;
        } else if (matched.length >= tokens.length * 0.8) {
          // At least 80% of tokens match
          sc = 0.50;
        }
      }
    }
    // Single token fuzzy match (only if key is single word and < 5 chars)
    else if (tokens.length === 1 && key.length <= 4 && all.includes(key)) {
      sc = 0.60;
    }

    // Reject weak matches entirely
    if (sc < 0.50) continue;

    // Type-based adjustments (smaller now)
    if (el.label === 'input') sc += 0.03;
    if (el.label === 'select' && /\d{3,}/.test(key)) sc -= 0.15;
    if (el.label === 'button' && key.length <= 10) sc += 0.02;
    
    // Position penalty - prefer earlier in DOM
    var positionPenalty = (i / elements.length) * 0.01;
    sc -= positionPenalty;

    candidates.push({ el: el, score: sc, index: i });
  }

  // Sort by score descending
  candidates.sort(function(a, b) { return b.score - a.score; });

  if (!candidates.length || candidates[0].score < 0.50) {
    console.warn('[SL/pick] No match for "' + keyword + '" (cleaned: "' + key + '"). Best score: ' + (candidates[0] ? candidates[0].score.toFixed(2) : '0'));
    console.log('[SL/pick] Sample elements:');
    elements.slice(0, 20).forEach(function(e, i) {
      var txt = (e.text || '').slice(0, 50);
      var lbl = e.label;
      console.log('  [' + i + '] ' + lbl + ' → "' + txt + '"' + 
                  (e.ariaLabel ? ' (aria: ' + e.ariaLabel.slice(0, 30) + ')' : ''));
    });
    return null;
  }

  var best = candidates[0];
  
  // Log top 3 candidates for debugging
  console.log('[SL/pick] Searching: "' + keyword + '" → cleaned: "' + key + '" | Found ' + candidates.length + ' candidates');
  candidates.slice(0, 3).forEach(function(c, i) {
    console.log('  #' + (i+1) + ': "' + (c.el.text||'').slice(0,50) + '" score=' + c.score.toFixed(3) + ' [' + c.el.label + ']');
  });

  return Object.assign({}, best.el, { score: best.score });
}

var DESTRUCT = [
  /\b(delete|remove|wipe|reset)\b/i,
  /\b(pay|purchase|buy|checkout|place order)\b/i,
  /\b(password|passcode)\b/i,
  /\b(logout|sign out|deactivate|close account)\b/i,
];
function isDestructive(step) {
  var t = (step.action||'') + ' ' + (step.target||'') + ' ' + (step.value||'');
  return DESTRUCT.some(function(p){ return p.test(t); });
}

// ═══════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════
async function doAct(tabId, step, target) {
  // Always re-ensure content script before acting
  await ensureContentScript(tabId);

  try {
    if (step.action === 'scroll') {
      return await msgTab(tabId, { type:'act', action:'scroll', direction:step.dir||'down' });
    }
    if (!target) return { ok:false, reason:'no_target' };

    var cx = Math.round(target.x + target.width  / 2);
    var cy = Math.round(target.y + target.height / 2);

    // For type action - use executeScript for better reliability
    if (step.action === 'type') {
      if (target.inputType === 'password') return { ok:false, reason:'password_field_blocked' };
      
      // Try executeScript typing first (more reliable for complex sites)
      var typeResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(absX, absY, value) {
          var vx = absX - window.scrollX;
          var vy = absY - window.scrollY;

          if (vy < 0 || vy > window.innerHeight) {
            window.scrollTo({ top: absY - window.innerHeight / 2, behavior: 'instant' });
            vx = absX - window.scrollX;
            vy = absY - window.scrollY;
          }

          var el = document.elementFromPoint(vx, vy);
          if (!el) return { ok: false, reason: 'element_not_found' };

          // Find actual input field
          var input = el;
          for (var i = 0; i < 8; i++) {
            if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA' || input.isContentEditable) break;
            var found = input.querySelector('input, textarea, [contenteditable="true"]');
            if (found) { input = found; break; }
            input = input.parentElement;
            if (!input) break;
          }
          if (!input) input = el;

          try {
            input.focus();
            input.click();

            var safeVal = String(value).slice(0, 500);

            // Handle different input types
            if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
              input.value = '';
              input.focus();
              
              // Multiple strategies
              if (document.execCommand) {
                document.execCommand('selectAll', false);
                document.execCommand('insertText', false, safeVal);
              }
              
              if (input.value !== safeVal) {
                input.value = safeVal;
              }

              // React/Vue event simulation
              var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              nativeInputValueSetter.call(input, safeVal);
              
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            }
            else if (input.isContentEditable) {
              input.textContent = safeVal;
              input.innerText = safeVal;
              
              var range = document.createRange();
              range.selectNodeContents(input);
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            return { ok: true, value: input.value || input.textContent, tag: input.tagName };
          } catch(e) {
            return { ok: false, reason: e.message };
          }
        },
        args: [cx, cy, step.value || ''],
      });

      var typeRes = typeResult && typeResult[0] && typeResult[0].result;
      console.log('[SL] Type result:', JSON.stringify(typeRes));
      if (typeRes && typeRes.ok) return typeRes;

      // Fallback to content script
      return await msgTab(tabId, {
        type:'act', action:'type', x:cx, y:cy,
        value: String(step.value||'').slice(0,500),
        elementId: target.id || null,
      });
    }

    // For click/find — try content script first, then fall back to executeScript
    if (step.action === 'click' || step.action === 'find') {
      var r = await msgTab(tabId, {
        type: 'act',
        action: step.action === 'find' ? 'highlight' : 'click',
        x: cx, y: cy,
        elementId: target.id || null,
      });

      if (r && r.ok) return r;

      // executeScript fallback — works even when content script is disconnected
      // and for plain-text elements that have no native click handler
      console.log('[SL] Content script click failed, using executeScript at', cx, cy);
      var fb = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(absX, absY, eid, searchText) {
          var vx = absX - window.scrollX;
          var vy = absY - window.scrollY;

          if (vy < 0 || vy > window.innerHeight || vx < 0 || vx > window.innerWidth) {
            window.scrollTo({ top: absY - window.innerHeight / 2, behavior: 'instant' });
            vx = absX - window.scrollX;
            vy = absY - window.scrollY;
          }

          var el = eid ? document.getElementById(eid) : null;
          if (!el) el = document.elementFromPoint(vx, vy);

          if (!el) {
            var all = document.querySelectorAll('a,button,[role="button"],h1,h2,h3,h4,h5,h6,li,span,p,div');
            for (var i = 0; i < all.length; i++) {
              var r = all[i].getBoundingClientRect();
              var elAbsX = r.left + window.scrollX;
              var elAbsY = r.top  + window.scrollY;
              if (absX >= elAbsX && absX <= elAbsX + r.width &&
                  absY >= elAbsY && absY <= elAbsY + r.height) {
                el = all[i];
                break;
              }
            }
          }

          if (!el) return { ok: false, reason: 'no_element_at_point' };

          try {
            // STRATEGY 1: Find <a href> ancestor and navigate directly
            var current = el;
            for (var u = 0; u < 15; u++) {
              if (!current) break;
              if (current.tagName && current.tagName.toUpperCase() === 'A' && current.href) {
                window.location.href = current.href;  // Direct navigation
                return { ok: true, tag: 'A', navigated: current.href };
              }
              current = current.parentElement;
            }

            // STRATEGY 2: Find any ancestor with the search text and look for <a> inside it
            if (searchText) {
              var container = el;
              for (var c = 0; c < 15; c++) {
                if (!container) break;
                var text = (container.innerText || container.textContent || '').toLowerCase();
                if (text.includes(searchText.toLowerCase())) {
                  // Found container with our text - look for <a href> child
                  var links = container.querySelectorAll('a[href]');
                  if (links.length > 0) {
                    window.location.href = links[0].href;  // Navigate to first link in card
                    return { ok: true, tag: 'A_child', navigated: links[0].href };
                  }
                  break;
                }
                container = container.parentElement;
              }
            }

            // STRATEGY 3: Find card container and dispatch native events
            var clickTarget = el;
            var card = el;
            for (var k = 0; k < 15; k++) {
              if (!card) break;
              var cls = (card.className || '').toLowerCase();
              if (cls.includes('card') || cls.includes('item') || cls.includes('paper') ||
                  cls.includes('post') || cls.includes('entry') || card.hasAttribute('onclick')) {
                clickTarget = card;
                break;
              }
              card = card.parentElement;
            }

            // Try multiple event types to trigger React/Vue handlers
            clickTarget.focus && clickTarget.focus();
            
            ['mousedown', 'mouseup', 'click'].forEach(function(evtType) {
              clickTarget.dispatchEvent(new MouseEvent(evtType, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: vx,
                clientY: vy,
              }));
            });

            clickTarget.click && clickTarget.click();

            return {
              ok: true,
              tag: clickTarget.tagName,
              class: (clickTarget.className || '').slice(0, 60),
            };
          } catch(e) {
            return { ok: false, reason: e.message };
          }
        },
        args: [cx, cy, target.id || null, target.text || ''],
      });

      var fbRes = fb && fb[0] && fb[0].result;
      console.log('[SL] executeScript click result:', JSON.stringify(fbRes));
      if (fbRes && fbRes.ok) return { ok: true };
      return { ok: false, reason: (fbRes && fbRes.reason) || 'both click methods failed' };
    }

    return { ok:false, reason:'unknown_action' };
  } catch(e) {
    return { ok:false, reason: e.message };
  }
}

async function showOverlay(tabId, el) {
  await ensureContentScript(tabId);
  await msgTab(tabId, {
    type: 'overlay_show',
    element: {
      id: el.id||null, label: String(el.label||'').slice(0,80),
      text: String(el.text||'').slice(0,80),
      x: Math.round(el.x||0), y: Math.round(el.y||0),
      width: Math.round(el.width||0), height: Math.round(el.height||0),
      confidence: el.confidence||1, source: el.source||'dom',
    },
  }).catch(function(){});
}

async function clearOverlay(tabId) {
  await ensureContentScript(tabId).catch(function(){});
  await msgTab(tabId, { type:'overlay_clear' }).catch(function(){});
}

async function msgTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch(e) { return { ok:false, reason: e.message }; }
}

// ═══════════════════════════════════════════════
// ONNX VISION
// ═══════════════════════════════════════════════
async function tryVision(dataUrl) {
  try {
    var has = await chrome.offscreen.hasDocument().catch(function(){ return false; });
    if (!has) {
      await chrome.offscreen.createDocument({
        url:'offscreen/offscreen.html', reasons:['BLOBS'], justification:'ONNX inference',
      }).catch(function(){});
    }
    return await new Promise(function(resolve) {
      var t = setTimeout(function(){ resolve(null); }, 8000);
      chrome.runtime.sendMessage({ type:'vision_infer', dataUrl:dataUrl }, function(r) {
        clearTimeout(t);
        resolve(chrome.runtime.lastError ? null : (r||null));
      });
    });
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════
// DESTRUCTIVE CONFIRM
// ═══════════════════════════════════════════════
var _resolveDest = null;
function waitConfirm(step) {
  return new Promise(function(resolve) {
    _resolveDest = resolve;
    panel({ type:'confirm_required', action:step.action, target:step.target, value:step.value||'' });
    setTimeout(function(){ _resolveDest = null; resolve(false); }, 30000);
  });
}

// ═══════════════════════════════════════════════
// SIDE PANEL EMIT
// ═══════════════════════════════════════════════
function emit(status, label, detail) {
  state.status = status;
  panel({ type:'timeline_update', status:status, entry:{ ts:Date.now(), label:label||'', detail:detail||'' } });
}
function panel(msg) { chrome.runtime.sendMessage(msg).catch(function(){}); }

// ═══════════════════════════════════════════════
// BACKEND
// ═══════════════════════════════════════════════
async function apiCreateSession(goal, tabId) {
  try { var tab = await chrome.tabs.get(tabId); var r = await apiFetch(BACKEND+'/sessions','POST',{ goal:goal, url:tab.url }); return r && r.id ? r.id : null; } catch(e){ return null; }
}
async function apiLogFrame(sid, els, ms) {
  if (!sid) return;
  try { await apiFetch(BACKEND+'/sessions/'+sid+'/frames','POST',{ latency_ms:ms, detections:els.slice(0,60).map(function(e){ return { label:e.label, text:e.text, x:e.x, y:e.y, w:e.width, h:e.height, conf:e.confidence }; }) }); } catch(e){}
}
async function apiLogAction(sid, step, target, ok) {
  if (!sid) return;
  try { await apiFetch(BACKEND+'/sessions/'+sid+'/actions','POST',{ type:step.action, target:(target&&target.text)?target.text:(step.target||''), value:step.value||'', ok:ok }); } catch(e){}
}
async function apiEndSession(sid, status) {
  if (!sid) return;
  try { await apiFetch(BACKEND+'/sessions/'+sid+'/end','POST',{ status:status }); } catch(e){}
}
async function apiFetch(url, method, body) {
  var r = await fetch(url, { method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(3000) });
  return r.json();
}

// ═══════════════════════════════════════════════
// UTIL
// ═══════════════════════════════════════════════
function wait(ms) { return new Promise(function(r){ setTimeout(r,ms); }); }
function stepDesc(s) {
  if (s.action==='scroll') return 'scroll '+(s.dir||'down');
  if (s.action==='explain') return 'explain "'+s.value+'"';
  if (s.action==='answer') return 'answer "'+s.value+'"';
  if (s.action==='type')   return 'type "'+s.value+'" in "'+s.target+'"';
  return s.action+' "'+s.target+'"';
}
