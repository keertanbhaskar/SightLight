# SightLite Privacy Policy

Last updated: 2026-09-28

---

## Summary

SightLite processes webpage content **locally inside your browser**. It does not send your browsing data, screenshots, or form input to any external server.

---

## What is processed

| Data | Where processed | Sent externally? |
|---|---|---|
| Webpage screenshot (JPEG) | Locally in Chrome offscreen document | ❌ No |
| DOM structure of active tab | Locally in content script | ❌ No |
| Visible element positions, text, roles | Locally in content script | ❌ No |
| User's typed goal | Locally in side panel | ❌ No |
| ONNX inference result | Locally in offscreen document | ❌ No |
| Session diagnostics (if enabled) | Locally via localhost:8000 | ❌ No (local only) |

---

## What is NOT collected

- Passwords or form credentials — SightLite **never reads or types into password fields**
- Browser history
- Cookies or authentication tokens
- Data from pages you don't run the agent on
- Personal information from forms
- Cross-site tracking data

---

## Optional local diagnostics

If the local developer backend (FastAPI + PostgreSQL at `localhost:8000`) is running, SightLite optionally sends:

- Session goal text
- Current page URL
- Number of detected elements and inference latency
- Actions taken (type, click, scroll) — **not** the values typed into fields
- Session status (success / stopped / error)

This data goes to **localhost only** — your own machine. It never leaves your device.

You can disable this from the side panel footer:  
**Diagnostics: On → click to turn Off**

---

## Permissions used

| Permission | Why |
|---|---|
| `activeTab` | Capture screenshot and interact with the current tab only |
| `scripting` | Inject content script to scan DOM and execute actions |
| `offscreen` | Run ONNX inference in an isolated offscreen document |
| `storage` | Save user preferences (diagnostics on/off) locally |
| `sidePanel` | Display the SightLite side panel |
| `tabs` | Get current tab URL for optional session logging |

No `<all_urls>` host permission is requested. SightLite only acts on the active tab when you click Run Agent.

---

## Data retention

- All session data in the optional local database is stored on your machine
- You control it entirely — delete the Docker volume to remove all data
- No data retention policy applies because no data leaves your device

---

## Third-party services

SightLite uses **no third-party services, APIs, or telemetry**.

The ONNX Runtime Web library is bundled locally with the extension.  
No model is downloaded at runtime.

---

## Contact

SightLite is an open-source project. Issues and questions:  
[github.com/your-org/sightlite](https://github.com/your-org/sightlite)
