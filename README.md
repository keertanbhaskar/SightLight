# SightLite – on-device visual perception for browser agents

## Run backend + dashboard + DB
    docker compose up --build
Dashboard: http://localhost:8080 · API docs: http://localhost:8000/docs

## Load the extension (development)
1. Chrome → chrome://extensions → enable Developer mode → Load unpacked → select `extension/`
2. Reload any open web page (so content.js is injected), click the SightLite icon, enter a goal, Run.

## Add the real vision model
- Put `ort.min.js` and the onnxruntime-web `.wasm` files in `extension/lib/` (from the `onnxruntime-web` npm package `dist/`).
- Put your exported detector at `extension/models/uidet.onnx` (output [1,N,6]: x1,y1,x2,y2,score,class).
- Without them, the extension uses a DOM-based fallback so the whole pipeline still runs.

## Publish
See the steps in the chat answer: deploy backend on HTTPS → set API url → zip `extension/` → Chrome Web Store dashboard.
