/**
 * offscreen/offscreen.js
 * Runs ONNX inference inside the offscreen document.
 */

const INPUT_SIZE     = 640;
const CONF_THRESHOLD = 0.40;
const LABELS = ['button', 'input', 'link', 'select', 'icon', 'image'];

let _session   = undefined; // undefined = not tried; null = failed
let _sessionMs = 0;

// ── ONNX Session Management ──────────────────────────────────────────────
async function getSession() {
  if (_session !== undefined) return _session;
  if (typeof ort === 'undefined') {
    console.warn('[SightLite/offscreen] ort not loaded');
    _session = null;
    return null;
  }
  try {
    const modelUrl = chrome.runtime.getURL('models/uidet-nano-int8.onnx');
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/');
    ort.env.wasm.numThreads = 1;

    const t0 = performance.now();
    _session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
    });
    _sessionMs = Math.round(performance.now() - t0);
    console.info(\`[SightLite/offscreen] ONNX session ready in \${_sessionMs} ms\`);
    return _session;
  } catch (err) {
    console.warn('[SightLite/offscreen] Model load failed:', err.message);
    _session = null;
    return null;
  }
}

async function runInference(dataUrl) {
  const session = await getSession();
  if (!session) return null;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const img  = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

    const { data, width, height } = imageData;
    const n  = width * height;
    const f  = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      f[i]         = data[i * 4]     / 255;
      f[n + i]     = data[i * 4 + 1] / 255;
      f[2 * n + i] = data[i * 4 + 2] / 255;
    }
    const tensor = new ort.Tensor('float32', f, [1, 3, height, width]);

    const t0     = performance.now();
    const output = await session.run({ [session.inputNames[0]]: tensor });
    const inferenceMs = Math.round(performance.now() - t0);

    const raw    = output[session.outputNames[0]].data;
    const scaleX = img.width  / INPUT_SIZE;
    const scaleY = img.height / INPUT_SIZE;
    const elements = [];

    for (let i = 0; i + 5 < raw.length; i += 6) {
      const score = raw[i + 4];
      if (score < CONF_THRESHOLD) continue;
      const cls = Math.round(raw[i + 5]);
      elements.push({
        id:          \`vis-\${elements.length}\`,
        label:       LABELS[cls] ?? 'other',
        text:        '',
        role:        LABELS[cls] ?? 'other',
        ariaLabel:   '',
        placeholder: '',
        inputType:   '',
        x:           Math.round(raw[i]     * scaleX),
        y:           Math.round(raw[i + 1] * scaleY),
        width:       Math.round((raw[i + 2] - raw[i])     * scaleX),
        height:      Math.round((raw[i + 3] - raw[i + 1]) * scaleY),
        confidence:  parseFloat(score.toFixed(3)),
        source:      'vision',
      });
    }

    return { elements, inferenceMs, source: 'vision' };
  } catch (err) {
    console.warn('[SightLite/offscreen] Inference error:', err.message);
    return null;
  }
}

// ── Message Listener ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'vision_infer') {
    runInference(msg.dataUrl)
      .then(result => sendResponse(result))
      .catch(() => sendResponse(null));
    return true; // async
  }
});

console.log('[SightLite/offscreen] Ready (ONNX only)');
