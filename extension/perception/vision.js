/**
 * perception/vision.js
 * ONNX vision pipeline wrapper — runs in the OFFSCREEN document.
 *
 * Pipeline:
 *   dataUrl (JPEG screenshot)
 *   → createImageBitmap
 *   → OffscreenCanvas resize to 640×640
 *   → Float32Array CHW normalisation (0–1)
 *   → ort.InferenceSession.run()
 *   → parse output [1, N, 6] = [x1,y1,x2,y2,score,classId]
 *   → filter conf > CONF_THRESHOLD
 *   → map back to original image dimensions
 *   → return NormalizedElement[]
 *
 * Falls back gracefully to null when:
 *   - ort is not available
 *   - model file not found
 *   - WebGPU and WASM both unavailable
 *   - Any inference error
 *
 * null return → background service worker uses DOM fallback.
 */

const INPUT_SIZE   = 640;
const CONF_THRESHOLD = 0.40;
const LABELS = ['button', 'input', 'link', 'select', 'icon', 'image'];

let _session = undefined; // undefined = not tried; null = tried & failed

/**
 * Load the ONNX session once and cache it.
 * @returns {ort.InferenceSession | null}
 */
export async function loadSession() {
  if (_session !== undefined) return _session;

  try {
    // ort is loaded via <script> in offscreen.html — it is a global
    if (typeof ort === 'undefined') {
      console.warn('[SightLite/vision] ort not available');
      _session = null;
      return null;
    }

    const modelUrl = chrome.runtime.getURL('models/uidet-nano-int8.onnx');

    ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/');
    ort.env.wasm.numThreads = 1; // extensions cannot use SharedArrayBuffer threads

    _session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
    });

    console.info('[SightLite/vision] ONNX session loaded');
    return _session;
  } catch (err) {
    console.warn('[SightLite/vision] Model load failed:', err.message);
    _session = null;
    return null;
  }
}

/**
 * Run inference on a JPEG data-URL screenshot.
 * @param {string} dataUrl
 * @returns {NormalizedElement[] | null}
 */
export async function detect(dataUrl) {
  const session = await loadSession();
  if (!session) return null;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const img  = await createImageBitmap(blob);

    // Resize to INPUT_SIZE × INPUT_SIZE
    const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, INPUT_SIZE, INPUT_SIZE);

    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const tensor    = toChwTensor(imageData);

    const feeds  = { [session.inputNames[0]]: tensor };
    const t0     = performance.now();
    const output = await session.run(feeds);
    const inferenceMs = Math.round(performance.now() - t0);

    const raw = output[session.outputNames[0]].data;
    const elements = parseOutput(raw, img.width, img.height);

    return { elements, inferenceMs, source: 'vision' };
  } catch (err) {
    console.warn('[SightLite/vision] Inference error:', err.message);
    return null;
  }
}

// ── internal helpers ───────────────────────────────────────────────────────

/** Convert ImageData (RGBA uint8) → Float32 CHW tensor normalized 0–1 */
function toChwTensor(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const f = new Float32Array(3 * n);

  for (let i = 0; i < n; i++) {
    f[i]         = data[i * 4]     / 255; // R
    f[n + i]     = data[i * 4 + 1] / 255; // G
    f[2 * n + i] = data[i * 4 + 2] / 255; // B
    // Alpha channel ignored
  }

  return new ort.Tensor('float32', f, [1, 3, height, width]);
}

/**
 * Parse flat model output [x1,y1,x2,y2,score,classId, …] into elements.
 * Maps 640×640 coordinates back to original image dimensions.
 */
function parseOutput(raw, imgW, imgH) {
  const results = [];
  const scaleX  = imgW / INPUT_SIZE;
  const scaleY  = imgH / INPUT_SIZE;

  for (let i = 0; i + 5 < raw.length; i += 6) {
    const x1    = raw[i];
    const y1    = raw[i + 1];
    const x2    = raw[i + 2];
    const y2    = raw[i + 3];
    const score = raw[i + 4];
    const cls   = Math.round(raw[i + 5]);

    if (score < CONF_THRESHOLD) continue;

    results.push({
      id:          `vis-${results.length}`,
      label:       LABELS[cls] ?? 'other',
      text:        '',         // vision has no text; content script fills it in
      role:        LABELS[cls] ?? 'other',
      ariaLabel:   '',
      placeholder: '',
      inputType:   '',
      x:           Math.round(x1 * scaleX),
      y:           Math.round(y1 * scaleY),
      width:       Math.round((x2 - x1) * scaleX),
      height:      Math.round((y2 - y1) * scaleY),
      confidence:  parseFloat(score.toFixed(3)),
      source:      'vision',
    });
  }

  return results;
}
