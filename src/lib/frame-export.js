import {
  DUPLICATE_AVERAGE_DELTA,
  DUPLICATE_CHANGED_DELTA,
  DUPLICATE_CHANGED_RATIO,
  MAX_DUPLICATE_COMPARE_SAMPLES,
  MIN_FRAME_DURATION_MS,
} from '../constants.js';
import { exportReadyImageData } from './image-processing.js';

export function nominalFrameDurationMs(fps) {
  return 1000 / Math.max(1, fps);
}

export function frameCapturedAt(frames, index, fps) {
  const capturedAt = frames[index]?.capturedAt;
  return Number.isFinite(capturedAt) ? capturedAt : index * nominalFrameDurationMs(fps);
}

export function frameDurationMs(frames, index, end, fps) {
  const fallback = nominalFrameDurationMs(fps);
  if (index >= end) return fallback;
  const duration = frameCapturedAt(frames, index + 1, fps) - frameCapturedAt(frames, index, fps);
  if (!Number.isFinite(duration) || duration <= 0) return fallback;
  return Math.max(MIN_FRAME_DURATION_MS, duration);
}

export function frameRangeDurationMs(frames, start, end, fps) {
  let duration = 0;
  for (let i = start; i <= end; i += 1) {
    duration += frameDurationMs(frames, i, end, fps);
  }
  return duration;
}

export function areFramesVisuallyDuplicate(previous, next) {
  if (!previous || previous.width !== next.width || previous.height !== next.height) return false;
  const pixelCount = previous.width * previous.height;
  const step = Math.max(1, Math.floor(Math.sqrt(pixelCount / MAX_DUPLICATE_COMPARE_SAMPLES)));
  const prevData = previous.data;
  const nextData = next.data;
  let totalDelta = 0, changedSamples = 0, samples = 0;

  for (let y = 0; y < previous.height; y += step) {
    for (let x = 0; x < previous.width; x += step) {
      const offset = (y * previous.width + x) * 4;
      const delta =
        (Math.abs(prevData[offset] - nextData[offset]) +
          Math.abs(prevData[offset + 1] - nextData[offset + 1]) +
          Math.abs(prevData[offset + 2] - nextData[offset + 2])) /
        3;
      totalDelta += delta;
      if (delta > DUPLICATE_CHANGED_DELTA) changedSamples += 1;
      samples += 1;
    }
  }
  if (!samples) return false;
  return (
    totalDelta / samples <= DUPLICATE_AVERAGE_DELTA &&
    changedSamples / samples <= DUPLICATE_CHANGED_RATIO
  );
}

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

// gifski's batch encoder holds every frame in memory at once (the frame array is
// also cloned into the worker and packed into one contiguous buffer), so a long,
// high-fps, native-resolution take can OOM-crash the worker. Budget the number of
// frames handed to the encoder; if the take exceeds it, subsample in time
// (effectively lowering fps) and fold each skipped frame's duration into the kept
// one — so the GIF stays the right length, just at a lower frame rate, instead of
// crashing. Mirrors the video path's memory guard. Sized at ~1 GB: the worker
// hand-off now TRANSFERS frame buffers (see useEncoder.js) instead of copying,
// which frees the main-thread copy and buys back the headroom for this larger
// budget at roughly the same peak.
const ENCODE_FRAME_BUDGET_BYTES = 1_000_000_000;

export async function prepareExportFrames(frames, start, end, settings, { onProgress } = {}) {
  // Probe the output frame size to budget memory (all frames are uniform).
  const probe = exportReadyImageData(
    frames[start].imageData,
    settings.cropRect,
    settings.cornerRadius,
    settings.gifLongEdge,
  );
  const bytesPerFrame = Math.max(1, probe.width * probe.height * 4);
  const totalFrames = end - start + 1;
  const maxFrames = Math.max(2, Math.floor(ENCODE_FRAME_BUDGET_BYTES / bytesPerFrame));
  const stride = Math.max(1, Math.ceil(totalFrames / maxFrames));
  if (stride > 1) {
    console.log(
      `[gif-it] frame budget: ${totalFrames} frames @ ${probe.width}×${probe.height} ` +
      `exceeds ~${Math.round(ENCODE_FRAME_BUDGET_BYTES / 1e6)}MB — subsampling every ${stride} ` +
      `(~${Math.round(1000 / (frameDurationMs(frames, start, end, settings.fps) * stride))} fps effective).`,
    );
  }

  const prepared = [];
  let mergedFrameCount = 0;
  const total = Math.max(1, Math.ceil(totalFrames / stride));
  let processed = 0;

  for (let i = start; i <= end; i += stride) {
    // Fold the durations of the (stride - 1) skipped frames into this kept one
    // so the overall GIF length is preserved.
    const spanEnd = Math.min(end, i + stride - 1);
    let duration = 0;
    for (let j = i; j <= spanEnd; j += 1) {
      duration += frameDurationMs(frames, j, end, settings.fps);
    }

    const imageData = i === start ? probe : exportReadyImageData(
      frames[i].imageData,
      settings.cropRect,
      settings.cornerRadius,
      settings.gifLongEdge,
    );
    const previous = prepared[prepared.length - 1];
    processed += 1;

    if (previous && areFramesVisuallyDuplicate(previous.imageData, imageData)) {
      previous.duration += duration;
      mergedFrameCount += 1;
    } else {
      prepared.push({ imageData, duration });
    }

    if (onProgress && (processed === total || processed % 2 === 0)) {
      onProgress(Math.min(1, processed / total));
      await nextAnimationFrame();
    }
  }

  return {
    frames: prepared.map((f) => f.imageData),
    frameDurations: prepared.map((f) => Math.max(MIN_FRAME_DURATION_MS, Math.round(f.duration))),
    mergedFrameCount,
  };
}
