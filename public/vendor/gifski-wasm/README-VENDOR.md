# Vendored gifski-wasm (real gifski)

This is `jamsinclair/gifski-wasm@2.2.0`, the WASM build of `ImageOptim/gifski`
(Kornel Lesiński) — the same engine as the gifski Mac app: imagequant global
palette, Floyd–Steinberg dithering, lossy LZW, and alpha→transparent-index.
License: **AGPL-3.0-or-later** (see `LICENSE`).

It is the single GIF encoder for all three capture modes (prototype, uploaded
video, tab recording). Loaded by `src/lib/encoder-worker.js`.

## Layout

- `dist/encode.js` + `pkg/` — single-threaded build (what we ship and use).

The files are served raw from `/public` (Vite copies `public/` → `dist/`; the
Dockerfile copies `dist/` → `static/`). They are committed to git so they
survive a fresh clone / CI — nothing builds them in the pipeline.

## Why not multithreaded?

The package also ships a multithreaded (wasm-threads / rayon) build
(`pkg-parallel/` + `dist/encode-multi-thread.js`). We evaluated it to close the
speed gap to the native Mac app and **reverted it**:

1. It requires `SharedArrayBuffer`, which is only available when the document is
   **cross-origin isolated** (`COOP: same-origin` + `COEP`). That isolation
   **blocks the cross-origin Figma prototype iframe** the editor embeds — even
   `COEP: credentialless` + the `credentialless` iframe attribute either blocks
   the embed or strips the Figma session cookies it needs.
2. The parallel wasm build panicked (`RuntimeError: unreachable`) during encode
   on larger inputs — likely its shared-memory ceiling.

Real-gifski quality/size/transparency do **not** depend on threads, so the
single-threaded build delivers correct, small, transparent GIFs. True speed
parity with the native app would need threads behind a different isolation
strategy (e.g. isolating only a dedicated export route, not the editor) — a
separate, larger piece of work.

## Regenerating (after upgrading gifski-wasm)

```
npm pack gifski-wasm@<version>
tar -xzf gifski-wasm-*.tgz
cp -R package/dist package/pkg public/vendor/gifski-wasm/
```

(We deliberately do not vendor `pkg-parallel/` or `dist/encode-multi-thread.js`.)
