// Video-to-GIF frame extraction, faithfully replicating Gifski's frame-timing
// pipeline, then feeding each sampled frame through the SAME crop → corner-radius
// → matte → resize → dedup chain the prototype path uses. All three capture modes
// (prototype, uploaded video, tab recording) converge on identical, transparency-
// correct frames for the single gifski encoder.
//
// Three Gifski behaviours replicated for frame SELECTION:
//
// 1. SOURCE FPS  — Gifski defaults to assetFrameRate (source video fps, ≤50).
//    The caller resolves this from videoSource.sourceFps and passes it as `fps`.
//
// 2. PREVIOUS-FRAME SELECTION — Gifski's inner while loop fires when
//    `sampleTime > frameTimes[frameNumber]` (strict >) and uses
//    `previousSampleBuffer` (last decoded frame BEFORE the target). We mirror
//    this: on every rVFC we draw the current frame and save it as prevImageData;
//    a target fires when `t > target` and uses prevImageData.
//
// 3. TAIL FILL — After the reader is exhausted, Gifski fills any remaining
//    targets with the last decoded frame. We do the same in 'ended'.
//
// CROP-FIRST OUTPUT SIZING — The output canvas is sized to the CROP region's
// native dimensions (capped at gifLongEdge), not the full native frame. This
// preserves native-resolution detail for tight crops: a phone prototype in a
// large Figma canvas exports at its actual recorded pixel size (e.g. 900×1200
// on Retina) rather than as a small subregion of a downscaled full frame
// (which would give 450×600 for the same content). The GPU drawImage pass
// draws only the crop region in one step, so there is no second spatial crop.
//
// MEMORY — we draw straight to the GIF OUTPUT resolution (GPU downscale in one
// drawImage pass) so getImageData reads a bounded buffer, never the full native
// frame. Output dims are long-edge-capped via exportDimensionsFor, and the
// memory budget below trims fps so the buffered frame set stays within a tab.
//
// PROCESSING happens in a SECOND pass (post-collection) with rAF yields, instead
// of inside the rVFC callback — processing the corner-radius/matte inline would
// stall playback and drop frames (the bug this file originally fixed).

import { MIN_FRAME_DURATION_MS, MAX_GIF_LONG_EDGE } from '../constants.js';
import { processFrameImageData } from './image-processing.js';
import { areFramesVisuallyDuplicate } from './frame-export.js';

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

export async function extractAndProcessVideoRange({
  videoSource,
  startMs,
  endMs,
  fps,
  cropRect,
  cornerRadius = 0,
  gifLongEdge,
  fittedWidth,
  fittedHeight,
  onProgress,
  signal,
}) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = videoSource.objectUrl;

  await new Promise((res, rej) => {
    video.addEventListener('loadedmetadata', res, { once: true });
    video.addEventListener('error', rej, { once: true });
  });

  const nativeW = videoSource.nativeWidth || videoSource.width;
  const nativeH = videoSource.nativeHeight || videoSource.height;

  // ── Crop region in native pixel space ─────────────────────────────────────
  // cropRect arrives in fitted-preview coords (fittedWidth × fittedHeight).
  // Scale it to native coords so drawImage can extract just that region —
  // sizing the output canvas to the crop lets tight crops (e.g. a phone in a
  // large Figma canvas) fill the gifLongEdge budget at native resolution
  // instead of being a small subregion of a downscaled full frame.
  const sfx = nativeW / (fittedWidth || nativeW);
  const sfy = nativeH / (fittedHeight || nativeH);
  const baseRect = cropRect ?? { x: 0, y: 0, width: fittedWidth || nativeW, height: fittedHeight || nativeH };
  const nativeCropX = Math.max(0, Math.round(baseRect.x * sfx));
  const nativeCropY = Math.max(0, Math.round(baseRect.y * sfy));
  const nativeCropW = Math.max(1, Math.min(nativeW - nativeCropX, Math.round(baseRect.width * sfx)));
  const nativeCropH = Math.max(1, Math.min(nativeH - nativeCropY, Math.round(baseRect.height * sfy)));

  // ── Output dimensions: always target gifLongEdge, upscaling allowed ─────────
  // Unlike exportDimensionsFor (which caps at the source size), here we always
  // scale the crop to fill the gifLongEdge budget. This matches the prototype
  // path, which records at the stage column width (often larger than the
  // displayed prototype). A small crop — e.g. a phone detected in a large Figma
  // canvas — scales up to gifLongEdge rather than staying at its native pixel
  // size. Capped at MAX_GIF_LONG_EDGE on both axes to prevent OOM.
  const effectiveLongEdge = Math.min(Math.max(1, gifLongEdge), MAX_GIF_LONG_EDGE);
  const cropLong = Math.max(nativeCropW, nativeCropH);
  const outScale = effectiveLongEdge / cropLong;
  const outW = Math.max(1, Math.min(MAX_GIF_LONG_EDGE, Math.round(nativeCropW * outScale)));
  const outH = Math.max(1, Math.min(MAX_GIF_LONG_EDGE, Math.round(nativeCropH * outScale)));

  // ── Canvas sized at final output dims — GPU scale on every drawImage ───────
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ── Memory-safe fps cap (computed on OUTPUT, not native, dims) ─────────────
  // We hold the raw output-sized frame set, then a processed set in the second
  // pass — peak ≈ 2× the raw set transiently. Budget the raw set to ~800 MB so
  // the transient stays within a tab's heap; trim fps for longer clips instead
  // of failing.
  const bytesPerFrame = outW * outH * 4;
  const maxFrames = Math.max(2, Math.floor(800_000_000 / bytesPerFrame));
  const clipSec = Math.max(0.001, (endMs - startMs) / 1000);
  const effectiveFps = Math.max(1, Math.min(fps, maxFrames / clipSec));

  // ── Target timestamps — mirrors Gifski's targetFrameTimes[] ───────────────
  const frameIntervalMs = 1000 / effectiveFps;
  const targets = [];
  for (let t = startMs; t < endMs; t += frameIntervalMs) {
    targets.push(t);
  }
  if (targets.length === 0 || targets[targets.length - 1] < endMs - 1) {
    targets.push(endMs);
  }

  const rawFrames = [];

  // ── Seek to trim start ─────────────────────────────────────────────────────
  await new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = Math.max(0, startMs / 1000);
  });

  // ── Sequential rVFC playback — collect raw output-sized frames ─────────────
  const playbackRate = Math.min(4, Math.max(1, Math.floor(60 / effectiveFps * 0.8)));

  await new Promise((resolve, reject) => {
    let nextTargetIdx = 0;
    let prevImageData = null;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try { video.pause(); } catch {}
      resolve();
    };

    const handleEnded = () => {
      if (nextTargetIdx < targets.length && prevImageData) {
        while (nextTargetIdx < targets.length) {
          rawFrames.push(prevImageData);
          nextTargetIdx++;
        }
      }
      finish();
    };
    video.addEventListener('ended', handleEnded, { once: true });
    video.addEventListener('error', () => reject(new Error('Video playback error.')), { once: true });

    const onFrame = (_now, meta) => {
      if (settled) return;
      if (signal?.aborted) {
        settled = true;
        reject(new Error('Export aborted.'));
        return;
      }

      const t = meta.mediaTime * 1000;

      // Draw only the native crop region, scaled to fill the output canvas.
      // One GPU pass: crop + scale together, no second spatial crop needed.
      ctx.drawImage(video, nativeCropX, nativeCropY, nativeCropW, nativeCropH, 0, 0, outW, outH);
      const currImageData = ctx.getImageData(0, 0, outW, outH);

      while (nextTargetIdx < targets.length && t > targets[nextTargetIdx]) {
        rawFrames.push(prevImageData ?? currImageData);
        nextTargetIdx++;
        // First half of progress is sampling.
        onProgress?.(Math.min(0.5, (nextTargetIdx / targets.length) * 0.5));
      }

      prevImageData = currImageData;

      if (nextTargetIdx >= targets.length) { finish(); return; }
      if (t >= endMs)                       { finish(); return; }

      video.requestVideoFrameCallback(onFrame);
    };

    video.playbackRate = playbackRate;
    video.requestVideoFrameCallback(onFrame);
    video.play().then(() => { video.playbackRate = playbackRate; }).catch(reject);
  });

  try { video.removeAttribute('src'); video.load(); } catch {}

  if (rawFrames.length === 0) throw new Error('No frames produced from the trim range.');

  // ── Second pass: corner-radius → matte → dedup ────────────────────────────
  // Spatial crop is already done by the drawImage pass above; pass null so
  // processFrameImageData skips the cropImageData step. Only corner-radius
  // and the light-corner matte need to be applied.
  //
  // Corner radius: scale from fitted-crop space → output space.
  // For a full-frame crop, baseRect.width = fittedWidth → same as old sx formula.
  // For a tight crop, the scale is larger (crop fills more of the output).
  const outRadius = Math.round((cornerRadius || 0) * Math.min(outW / baseRect.width, outH / baseRect.height));

  const frameDuration = Math.max(MIN_FRAME_DURATION_MS, Math.round(frameIntervalMs));
  const prepared = [];
  const total = rawFrames.length;

  for (let i = 0; i < total; i += 1) {
    const processed = processFrameImageData(rawFrames[i], null, outRadius);
    rawFrames[i] = null; // free the raw frame as soon as it's consumed
    const previous = prepared[prepared.length - 1];
    if (previous && areFramesVisuallyDuplicate(previous.imageData, processed)) {
      previous.duration += frameDuration;
    } else {
      prepared.push({ imageData: processed, duration: frameDuration });
    }
    if (onProgress && (i === total - 1 || i % 2 === 0)) {
      onProgress(0.5 + ((i + 1) / total) * 0.5);
      await nextAnimationFrame();
    }
  }

  if (prepared.length === 1) prepared.push(prepared[0]); // gifski requires ≥ 2

  return {
    frames: prepared.map((f) => f.imageData),
    frameDurations: prepared.map((f) => Math.max(MIN_FRAME_DURATION_MS, Math.round(f.duration))),
  };
}
