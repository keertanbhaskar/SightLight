# SightLite

**On-device visual browser agent for Chrome (Manifest V3)**

SightLite is a lightweight browser agent that perceives webpages locally and assists with browser tasks using natural language goals.

> "Click the Login button"  
> "Type OpenAI in the search box then click Search"

No account required. No cloud. No API keys. Works offline once installed.

---

## Architecture

```
User types goal in Side Panel
        ↓
Background Service Worker  (background/service-worker.js)
        ↓
Agent Loop:
  CAPTURE   → chrome.tabs.captureVisibleTab()
  PERCEIVE  → Offscreen ONNX inference   (models/uidet-nano-int8.onnx)
              ↳ Falls back to DOM scan   (content/content.js)
  PLAN      → Ranked element matching    (agent/planner.js)
  ACT       → Click / Type / Scroll      (content/content.js)
  REPEAT    → until task done or limit hit
        ↓
Optional: POST session data to localhost:8000 (developer console)
```

---

## How Perception Works

### Vision (primary — requires model file)
1. Tab screenshot captured as JPEG
2. Sent to offscreen document via message
3. ONNX Runtime Web runs `uidet-nano-int8.onnx` (WebGPU → WASM fallback)
4. Model outputs bounding boxes + class labels (button, input, link, …)
5. Filtered by confidence ≥ 0.40, mapped back to page coordinates

### DOM Fallback (always available)
1. Content script queries `button, input, a[href], select, [role=button]`, etc.
2. Reads bounding rects, visible text, aria-label, placeholder
3. Returns same normalized format as vision

The UI always shows which mode was used: **Vision** or **DOM Fallback**.

---

## File Structure

```
extension/
├── manifest.json
├── background/
│   └── service-worker.js     ← Agent loop, message routing
├── content/
│   └── content.js            ← DOM scan, click/type/scroll, overlay
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js          ← Panel UI, timeline, status
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js          ← ONNX inference runner
├── agent/
│   ├── state.js              ← State machine + safety limits
│   ├── planner.js            ← Goal parser + element picker
│   └── actions.js            ← Safe action executor
├── perception/
│   ├── dom.js                ← DOM scanner logic
│   ├── vision.js             ← ONNX pipeline wrapper
│   └── normalizer.js         ← Shared element format
├── models/
│   └── uidet-nano-int8.onnx  ← Local ONNX model (add manually)
├── lib/
│   ├── ort.min.js            ← ONNX Runtime Web (add manually)
│   └── ort-wasm*.wasm        ← WASM fallback files (add manually)
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## Installation (Development)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. SightLite appears in your toolbar
6. Open any webpage → click the SightLite icon → side panel opens
7. Type a task → **Run Agent**

### Add the ONNX model (optional, for vision mode)

Without the model, SightLite uses DOM fallback automatically.

To enable vision perception:
1. Obtain `uidet-nano-int8.onnx` and place it in `models/`
2. Download ONNX Runtime Web: `npm pack onnxruntime-web` or from [GitHub releases](https://github.com/microsoft/onnxruntime/releases)
3. Copy `ort.min.js` and the `.wasm` files into `lib/`
4. Reload the extension

---

## Safety Limits

| Limit | Default |
|---|---|
| MAX_STEPS | 15 |
| MAX_RETRIES | 2 |
| MAX_RUNTIME | 60 seconds |

If a limit is reached, the agent stops safely and explains why.

Destructive actions (delete, submit, pay, etc.) require explicit user confirmation in the side panel before executing.

---

## Supported Actions

| Action | Example goal |
|---|---|
| `click` | `"Click the Sign In button"` |
| `type` | `"Type hello@example.com in the email field"` |
| `scroll` | `"Scroll down"` |
| `find` | `"Find the price section"` (highlights only, no click) |
| Chained | `"Type OpenAI in search then click Search"` |

---

## Privacy Model

- All webpage analysis runs locally in your browser
- No data is sent to external servers
- No account or API key required
- Optional session diagnostics can be disabled from the side panel footer
- Password fields are never read or typed into

See `PRIVACY.md` for full details.

---

## Known Limitations

- Vision mode requires the ONNX model to be manually added (not bundled due to file size)
- DOM fallback cannot detect purely visual elements with no HTML text
- Does not support iframes or shadow DOM in this version
- Element matching is fuzzy keyword-based, not semantic NLP
- May not work reliably on heavily dynamic SPAs without a page-settle delay
- Chrome only (Manifest V3 Side Panel API)

---

## Build Production ZIP

```bash
# From the sightlite/extension folder:
zip -r ../sightlite-extension.zip . \
  --exclude "*.DS_Store" \
  --exclude "__pycache__/*" \
  --exclude ".git/*"
```

Or on Windows:
```powershell
Compress-Archive -Path extension\* -DestinationPath sightlite-extension.zip
```

Upload the ZIP to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## Browser Compatibility

| Browser | Status |
|---|---|
| Chrome 114+ | ✅ Full support (Side Panel API) |
| Edge 114+ | ✅ Chromium-based, compatible |
| Firefox | ❌ No Side Panel API |
| Safari | ❌ No Side Panel API |

---

## Running the Optional Developer Console

The `backend/` and `frontend/` folders contain a FastAPI + PostgreSQL stack for session monitoring.

```bash
cd sightlite/     # project root
docker compose up --build
```

- Dashboard: http://localhost:8080
- API:       http://localhost:8000/docs

This is entirely optional. The extension works without it.
