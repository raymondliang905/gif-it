// GIF encoding worker — real gifski (jamsinclair/gifski-wasm, wrapping
// ImageOptim/gifski: imagequant global palette, Floyd–Steinberg dithering, lossy
// LZW, alpha→transparent-index). Same engine as the gifski Mac app, and the
// single encoder for all three capture modes.
//
// Single-threaded build. The multithreaded (wasm-threads) build was evaluated
// but reverted: it requires cross-origin isolation (COOP/COEP), which blocks the
// cross-origin Figma prototype iframe, and the parallel wasm build panicked
// ("unreachable") during encode on larger inputs. Speed parity with the native
// Mac app needs threads, so it remains a future option behind a different
// isolation strategy — see public/vendor/gifski-wasm/README-VENDOR.md.

// Base-relative, not root-absolute: this app is served from a subpath on
// GitHub Pages (see vite.config.js `base`). import.meta.env.BASE_URL is a
// Vite build-time constant (always ends in '/') and is inlined into this
// worker's built chunk same as any other ES module in the graph.
const GIFSKI_MODULE_URL = `${import.meta.env.BASE_URL}vendor/gifski-wasm/dist/encode.js`;
const GIFSKI_WASM_URL = `${import.meta.env.BASE_URL}vendor/gifski-wasm/pkg/gifski_wasm_bg.wasm`;

// Hide the dynamic import from Vite static analysis. Vite's worker plugin
// errors on import() paths that resolve into /public/, even with @vite-ignore.
const dynamicImport = new Function('u', 'return import(u)');

async function encodeWithGifski(options) {
  const module = await dynamicImport(GIFSKI_MODULE_URL);
  if (typeof module.init === 'function') {
    await module.init(GIFSKI_WASM_URL);
  }
  const encode = module.default ?? module.encode;
  if (typeof encode !== 'function') {
    throw new Error('GIFSKI encoder API was not found.');
  }

  const encodeOptions = {
    frames: options.frames,
    width: options.width,
    height: options.height,
    quality: options.quality,
    // gifski-wasm uses width/height to interpret the flat RGBA pixel buffer and
    // resizeWidth/resizeHeight as the actual GIF output dimensions. Without
    // explicit resize params it defaults to a lower resolution. Always pass them
    // equal to the input so the output GIF matches the frame pixel dimensions.
    resizeWidth: options.width,
    resizeHeight: options.height,
  };

  // gifski-wasm repeat: a value < 0 (or omitted) → Repeat::Infinite (loops
  // forever); n >= 0 → Repeat::Finite(n), so repeat=0 plays exactly ONCE.
  // Forward -1 to loop forever. (Confirmed against jamsinclair/gifski-wasm
  // src/lib.rs: `if repeat >= 0 { Finite(repeat) } else { Infinite }`.)
  if (Number.isFinite(options.repeat)) {
    encodeOptions.repeat = options.repeat;
  }

  if (options.frameDurations?.length === options.frames.length) {
    encodeOptions.frameDurations = options.frameDurations;
  } else {
    encodeOptions.fps = options.fps;
  }

  const result = await encode(encodeOptions);
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

self.onmessage = async (event) => {
  if (event.data?.type !== 'encode') return;
  const options = event.data.options;
  try {
    self.postMessage({ type: 'status', message: 'Encoding with GIFSKI' });
    const bytes = await encodeWithGifski(options);
    self.postMessage({ type: 'done', encoder: 'GIFSKI WASM', bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message || 'GIFSKI encoding failed.' });
  }
};

self.onunhandledrejection = (event) => {
  self.postMessage({ type: 'error', message: event.reason?.message || 'GIF encoding failed.' });
};
