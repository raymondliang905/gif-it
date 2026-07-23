import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialState, reducer } from './state/appReducer.js';
import {
  DEFAULT_HEAD_TRIM_MS,
  DEFAULT_TAIL_TRIM_MS,
  MIN_FRAME_DURATION_MS,
  UPLOAD_VIDEO_ENABLED,
  presetFor,
} from './constants.js';
import { extractFigmaInput, toFigmaEmbedUrls } from './lib/figma-url.js';
import {
  clearLatestRecording,
  loadLatestRecording,
  saveLatestRecording,
} from './lib/storage.js';
import { captureSupportMessage, canStartCapture, captureErrorMessage } from './lib/capture-support.js';
import { requestNotifyPermission, notifyRecordingDone, flashTabCue } from './lib/notify.js';
import { formatBytes } from './lib/formatters.js';
import {
  clampCropRect,
  detectForegroundBounds,
  fullCropRect,
  maxCornerRadiusForRect,
} from './lib/image-processing.js';
import {
  frameCapturedAt,
  frameRangeDurationMs,
  nominalFrameDurationMs,
  prepareExportFrames,
} from './lib/frame-export.js';
import { extractAndProcessVideoRange } from './lib/video-export.js';
import { useCaptureStream } from './hooks/useCaptureStream.js';
import { useTabRecorder, isTabRecordingSupported } from './hooks/useTabRecorder.js';
import { useVideoSource, isVideoFile } from './hooks/useVideoSource.js';
import { useVideoPlayback } from './hooks/useVideoPlayback.js';
import { useEncoder } from './hooks/useEncoder.js';
import { usePreviewPlayback } from './hooks/usePreviewPlayback.js';
import TopBar from './components/TopBar.jsx';
import EmptyStage from './components/EmptyStage.jsx';
import PrototypeStage from './components/PrototypeStage.jsx';
import StageLoading from './components/StageLoading.jsx';
import BrowserWarning from './components/BrowserWarning.jsx';
import GifPreviewStage from './components/GifPreviewStage.jsx';
import GifResultPreview from './components/GifResultPreview.jsx';
import TimelineShell from './components/TimelineShell.jsx';

function cacheBustEmbedUrl(rawUrl, attempt) {
  const url = new URL(rawUrl);
  url.searchParams.set('recorder-reload', `${Date.now()}-${attempt}`);
  return url.toString();
}

function defaultTrimEndFrame(frames, max, trimTailMs, fps) {
  if (!trimTailMs || max <= 0) return max;
  const lastCapturedAt = frameCapturedAt(frames, max, fps);
  if (!Number.isFinite(lastCapturedAt)) {
    return Math.max(0, max - Math.round(trimTailMs / nominalFrameDurationMs(fps)));
  }
  const targetTime = Math.max(0, lastCapturedAt - trimTailMs);
  for (let i = max; i >= 0; i -= 1) {
    if (frameCapturedAt(frames, i, fps) <= targetTime) return i;
  }
  return 0;
}

function defaultTrimStartFrame(frames, max, trimHeadMs, fps) {
  if (!trimHeadMs || max <= 0) return 0;
  for (let i = 0; i <= max; i += 1) {
    if (frameCapturedAt(frames, i, fps) >= trimHeadMs) return i;
  }
  return max;
}

function computeTrimDefaults(frames, fps, { trimHeadMs = 0, trimTailMs = 0 } = {}) {
  const max = Math.max(0, frames.length - 1);
  const endCandidate = defaultTrimEndFrame(frames, max, trimTailMs, fps);
  const startCandidate = defaultTrimStartFrame(frames, max, trimHeadMs, fps);
  const start = Math.min(startCandidate, endCandidate);
  return { start, end: endCandidate, displayed: start };
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const browserWarning = useMemo(() => captureSupportMessage(), []);

  // Refs for imperative DOM/canvases/streams
  const iframeRef = useRef(null);
  const captureVideoRef = useRef(null);
  const captureStageRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const previewVideoRef = useRef(null);     // <video> element for uploaded-video preview
  const exportAbortRef = useRef(null);      // AbortController for an in-flight video export
  const dragDepthRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const framesRef = useRef([]);
  const stateRef = useRef(state);

  // Keep refs in sync (so capture loop closures see latest state)
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { framesRef.current = state.frames; }, [state.frames]);

  // Hooks
  const capture = useCaptureStream({
    videoRef: captureVideoRef,
    captureStageRef,
    captureCanvasRef,
  });
  const loadVideoSource = useVideoSource();
  const encoder = useEncoder();
  const tabRecorder = useTabRecorder();

  // A "video source" is an uploaded video file kept whole (Gifski-style): we
  // play it natively and only sample frames at export. Recorded takes and
  // restored recordings still use the in-memory frame array, so they are NOT
  // video sources even though their reducer source.type is also 'video'.
  const videoSource = state.source.video;
  const isVideoSource = Boolean(videoSource);
  const hasPrototype = Boolean(state.source.embedUrl);
  const hasLoadedSource = hasPrototype || isVideoSource;
  const isRecording = state.recording.isRecording;
  const isBusy =
    isRecording ||
    state.encoding.isEncoding ||
    state.loading.prototype ||
    state.loading.video;
  const hasCapturedTake = state.recording.hasCapturedTakeThisSession;
  const showTopBar = hasLoadedSource || state.frames.length > 0 || Boolean(state.output.url);
  const hasFrames = state.frames.length > 0;
  // Clamp + round defensively: trim.displayed can briefly be fractional or out
  // of range while the timeline reports positions in extent units.
  const displayedFrameIndex = Math.max(
    0,
    Math.min(Math.round(state.trim.displayed) || 0, state.frames.length - 1),
  );
  const currentImageData = hasFrames
    ? state.frames[displayedFrameIndex].imageData
    : null;

  // Preview playback — frame array (recorded/restored takes).
  const playback = usePreviewPlayback({
    frames: state.frames,
    trimStart: state.trim.start,
    trimEnd: state.trim.end,
    fps: state.quality.fps,
    onTick: useCallback((frameIndex) => {
      dispatch({ type: 'SET_DISPLAYED_FRAME', index: frameIndex });
    }, []),
  });

  // Preview playback — native <video> (uploaded video source). Trim units are
  // milliseconds here, so the playhead (trim.displayed) is also in ms.
  const videoPlayback = useVideoPlayback({
    videoRef: previewVideoRef,
    sourceKey: videoSource?.objectUrl,
    trimStartMs: state.trim.start,
    trimEndMs: state.trim.end,
    onTimeChange: useCallback((ms) => {
      dispatch({ type: 'SET_DISPLAYED_FRAME', index: Math.round(ms) });
    }, []),
  });

  const isPlaying = isVideoSource ? videoPlayback.isPlaying : playback.isPlaying;

  // Output URL cleanup
  useEffect(() => {
    const url = state.output.url;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [state.output.url]);

  // Uploaded-video object URL cleanup. Revoke the previous source's URL when it
  // is replaced (new upload) or on unmount, so blobs don't accumulate.
  useEffect(() => {
    const url = videoSource?.objectUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [videoSource?.objectUrl]);

  // ============ Source handlers ============
  const submitUrl = useCallback((rawValue, { closeDrawer = false } = {}) => {
    try {
      const input = extractFigmaInput(rawValue);
      const candidates = toFigmaEmbedUrls(input);
      const firstUrl = cacheBustEmbedUrl(candidates[0], 0);
      dispatch({ type: 'LOAD_PROTOTYPE', embedUrl: firstUrl, candidates, attempt: 0, input });
      dispatch({ type: 'SET_PROTOTYPE_LOADING', loading: true });
      dispatch({ type: 'SET_STATUS', status: `Loading prototype (1/${candidates.length})` });
      if (closeDrawer) dispatch({ type: 'SET_DRAWER', open: false });
    } catch (error) {
      dispatch({ type: 'SET_PROTOTYPE_LOADING', loading: false });
      dispatch({ type: 'SET_STATUS', status: error.message });
    }
  }, []);

  const handleInputChange = useCallback((value) => {
    dispatch({ type: 'SET_INPUT', value });
  }, []);

  const handleInputPaste = useCallback((event, { autoLoad = false } = {}) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const candidates = [clipboard.getData('text/html'), clipboard.getData('text/plain')].filter(Boolean);
    for (const candidate of candidates) {
      const input = extractFigmaInput(candidate);
      try {
        toFigmaEmbedUrls(input);
        event.preventDefault();
        dispatch({ type: 'SET_INPUT', value: input });
        if (autoLoad) submitUrl(input);
        return;
      } catch {}
    }
  }, [submitUrl]);

  // ============ Video file load (metadata only) ============
  // Gifski-style: we keep the file whole and play it natively. No frames are
  // extracted up front — they're sampled from the trim window at export time.
  const handleVideoFile = useCallback(async (file, { fromTabRecorder = false } = {}) => {
    if (!fromTabRecorder && !UPLOAD_VIDEO_ENABLED) {
      dispatch({ type: 'SET_STATUS', status: 'Video upload is coming soon — check back later.' });
      return;
    }
    if (!isVideoFile(file)) {
      dispatch({ type: 'SET_STATUS', status: 'Upload a video file such as MP4, MOV, or WebM.' });
      return;
    }
    dispatch({ type: 'SET_VIDEO_LOADING', loading: true, detail: `Reading ${file.name}` });
    dispatch({ type: 'SET_STATUS', status: 'Loading video' });
    try {
      const video = await loadVideoSource(file);
      dispatch({ type: 'LOAD_VIDEO_SOURCE', video, fromTabRecorder });
      dispatch({
        type: 'SET_STATUS',
        status: `Loaded video (${video.nativeWidth}×${video.nativeHeight})`,
      });
    } catch (error) {
      dispatch({ type: 'SET_STATUS', status: error.message || 'Could not load this video.' });
    } finally {
      dispatch({ type: 'SET_VIDEO_LOADING', loading: false });
    }
  }, [loadVideoSource]);

  // ============ Record another tab (Mode 3) ============
  // Capture a different tab/window via getDisplayMedia + MediaRecorder. The
  // recording survives GIFit being backgrounded; on stop we route the webm into
  // the same video-source pipeline as an upload, and nudge the user back here.
  const handleRecordTab = useCallback(async () => {
    const unsupported = captureSupportMessage();
    if (unsupported) {
      dispatch({ type: 'SET_STATUS', status: unsupported });
      return;
    }
    if (!isTabRecordingSupported()) {
      dispatch({ type: 'SET_STATUS', status: 'Tab recording needs Chrome or Edge with MediaRecorder support.' });
      return;
    }
    try {
      await tabRecorder.start({
        onComplete: async (blob) => {
          // GIFit is likely backgrounded here — bring the user back.
          flashTabCue('✅ Recording ready — GIFit');
          notifyRecordingDone({
            title: 'Recording ready',
            body: 'Click to return to GIFit and trim your GIF.',
          });
          const file = new File([blob], `tab-recording-${Date.now()}.webm`, {
            type: blob.type || 'video/webm',
          });
          await handleVideoFile(file, { fromTabRecorder: true });
        },
        onError: (message) => {
          dispatch({ type: 'SET_STATUS', status: message || 'Tab recording failed.' });
        },
      });
      // Best-effort: ask for notification permission once capture is underway.
      requestNotifyPermission();
      dispatch({
        type: 'SET_STATUS',
        status: 'Recording another tab — use the browser “Stop sharing” bar (or Stop here) when done.',
      });
    } catch (error) {
      dispatch({ type: 'SET_STATUS', status: captureErrorMessage(error) });
    }
  }, [tabRecorder, handleVideoFile]);

  // ============ Recording ============
  const startRecording = useCallback(async () => {
    const unsupported = captureSupportMessage();
    if (unsupported) {
      dispatch({ type: 'SET_STATUS', status: unsupported });
      return;
    }
    if (!hasPrototype) return;
    playback.stop();
    dispatch({ type: 'CLEAR_OUTPUT' });
    dispatch({ type: 'SET_STAGE_VIEW', view: 'prototype' });
    try {
      const fps = stateRef.current.quality.fps;
      const width = stateRef.current.stage.width;
      const height = stateRef.current.stage.height;
      await capture.startStream(fps);
      await capture.warmUp({ width, height });
      dispatch({ type: 'START_RECORDING' });
      recordingStartedAtRef.current = performance.now();
      const startedAt = capture.startCaptureLoop({
        width,
        height,
        fps,
        onFrame: (frame) => {
          dispatch({
            type: 'APPEND_FRAME',
            frame,
            durationSeconds: (performance.now() - recordingStartedAtRef.current) / 1000,
          });
        },
      });
      recordingStartedAtRef.current = startedAt;
      dispatch({ type: 'SET_STATUS', status: 'Recording' });
    } catch (error) {
      dispatch({ type: 'SET_STATUS', status: error.message || 'Capture cancelled.' });
      capture.stopStream();
      dispatch({ type: 'STOP_RECORDING' });
    }
  }, [hasPrototype, capture, playback]);

  const stopRecording = useCallback(() => {
    capture.stopStream();
    const frames = framesRef.current;
    const fps = stateRef.current.quality.fps;
    const lastCapturedAt = frames[frames.length - 1]?.capturedAt;
    const durationSeconds = Number.isFinite(lastCapturedAt)
      ? lastCapturedAt / 1000
      : frames.length / fps;

    // Auto-crop from a SETTLED mid-recording frame. The first frames are often
    // transitional (loading / entry animation), so their foreground bounds come
    // out loose. Sample around the middle and fall outward if a frame fails to
    // detect; take the first valid bounding box.
    if (stateRef.current.quality.autoCrop && frames.length) {
      let auto = null;
      for (const p of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        const idx = Math.floor((frames.length - 1) * p);
        const f = frames[idx];
        const bounds = f && detectForegroundBounds(f.imageData);
        // One-shot auto-crop diagnostic: if the crop isn't tight, this shows
        // whether detection returned a box (and how tight) or null per frame.
        if (f) {
          const fr = f.imageData;
        }
        if (bounds) { auto = bounds; break; }
      }
      const ref = frames[Math.floor((frames.length - 1) / 2)] ?? frames[0];
      dispatch({ type: 'SET_CROP_RECT', rect: auto ?? fullCropRect(ref.imageData) });
    } else if (!stateRef.current.crop.rect && frames[0]) {
      dispatch({ type: 'SET_CROP_RECT', rect: fullCropRect(frames[0].imageData) });
    }

    // Configure trim with default head/tail trim
    const trim = computeTrimDefaults(frames, fps, {
      trimHeadMs: DEFAULT_HEAD_TRIM_MS,
      trimTailMs: DEFAULT_TAIL_TRIM_MS,
    });
    dispatch({ type: 'SET_TRIM', start: trim.start, end: trim.end, displayed: trim.start });
    dispatch({ type: 'STOP_RECORDING', durationSeconds });
    dispatch({ type: 'SET_STATUS', status: `Captured ${frames.length} frames` });
  }, [capture]);

  // Persist recording when frames change after capture
  useEffect(() => {
    if (state.recording.isRecording || !state.frames.length) return;
    saveLatestRecording({
      frames: state.frames,
      settings: state.quality,
      cropRect: state.crop.rect,
      stage: state.stage,
      durationSeconds: state.recording.durationSeconds,
    }).catch(() => {});
  }, [state.recording.isRecording, state.frames, state.quality, state.crop.rect, state.stage, state.recording.durationSeconds]);

  // ============ Home / reset ============
  const handleHome = useCallback(() => {
    if (isBusy) return;
    capture.stopStream();
    playback.stop();
    videoPlayback.pause();
    exportAbortRef.current?.abort();
    encoder.cancel();
    dispatch({ type: 'RESET_SOURCE' });
    dispatch({ type: 'SET_STATUS', status: 'Ready' });
    clearLatestRecording().catch(() => {});
  }, [isBusy, capture, playback, videoPlayback, encoder]);

  const handleReset = useCallback(() => {
    if (!state.source.embedCandidates.length) return;
    if (state.frames.length > 0) {
      const confirmed = window.confirm(
        'Discard this recording and reload the prototype? Your captured frames and current GIF export will be cleared.',
      );
      if (!confirmed) return;
      dispatch({ type: 'CLEAR_TAKE' });
      dispatch({ type: 'SET_STATUS', status: 'Recording discarded. Reloading prototype.' });
      clearLatestRecording().catch(() => {});
    }
    const next = (state.source.embedAttempt + 1) % state.source.embedCandidates.length;
    const nextUrl = cacheBustEmbedUrl(state.source.embedCandidates[next], next);
    dispatch({ type: 'NEXT_EMBED_ATTEMPT', embedUrl: nextUrl });
    dispatch({ type: 'SET_PROTOTYPE_LOADING', loading: true });
  }, [state.source.embedAttempt, state.source.embedCandidates, state.frames.length]);

  // ============ Crop (commit-only — drag is local to CropOverlay) ============
  // Crop math only needs source dimensions. A recorded take reads them from
  // the first frame's ImageData; an uploaded video reads them from its
  // metadata (no frames exist). clampCropRect/fullCropRect only touch
  // .width/.height, so a plain {width,height} is sufficient.
  const cropDimensions = useCallback(() => {
    const v = stateRef.current.source.video;
    if (v) return { width: v.width, height: v.height };
    return framesRef.current[0]?.imageData ?? null;
  }, []);

  const handleCropChange = useCallback((rect) => {
    const dims = cropDimensions();
    if (!dims || !rect) return;
    const clamped = clampCropRect(rect, dims);
    dispatch({ type: 'SET_CROP_RECT', rect: clamped });
    const maxRadius = maxCornerRadiusForRect(clamped);
    if (stateRef.current.quality.cornerRadius > maxRadius) {
      dispatch({ type: 'SET_QUALITY_FIELD', field: 'cornerRadius', value: maxRadius });
    }
    dispatch({ type: 'CLEAR_OUTPUT' });
  }, [cropDimensions]);

  const handleCornerRadiusChange = useCallback((value) => {
    const dims = cropDimensions();
    if (!dims) return;
    const rect = stateRef.current.crop.rect ?? fullCropRect(dims);
    const maxRadius = maxCornerRadiusForRect(rect);
    const clamped = Math.max(0, Math.min(maxRadius, Math.round(value)));
    dispatch({ type: 'SET_QUALITY_FIELD', field: 'cornerRadius', value: clamped });
    dispatch({ type: 'CLEAR_OUTPUT' });
  }, [cropDimensions]);

  // ============ Trim & playback ============
  // Position units differ by source: frame indices for takes, milliseconds for
  // uploaded video. TimelineShell speaks "extent units" generically and these
  // handlers translate to whichever playback driver is active.
  const handleTrimChange = useCallback(({ start, end, displayed }) => {
    const nextDisplayed = displayed ?? start;
    if (stateRef.current.source.video) {
      // Video positions are milliseconds and may be fractional — that's fine.
      videoPlayback.pause();
      dispatch({ type: 'SET_TRIM', start, end, displayed: nextDisplayed });
      videoPlayback.seek(nextDisplayed);
    } else {
      // Frame positions are array indices and MUST be integers — the timeline
      // reports fractional positions in extent units.
      playback.stop();
      dispatch({
        type: 'SET_TRIM',
        start: Math.round(start),
        end: Math.round(end),
        displayed: Math.round(nextDisplayed),
      });
    }
    dispatch({ type: 'CLEAR_OUTPUT' });
  }, [playback, videoPlayback]);

  // pos is a frame index (take) or a millisecond offset (video).
  const handleSelectPos = useCallback((pos) => {
    if (stateRef.current.source.video) {
      videoPlayback.pause();
      videoPlayback.seek(pos);   // 'seeked' listener updates trim.displayed
    } else {
      playback.stop();
      dispatch({ type: 'SET_DISPLAYED_FRAME', index: Math.round(pos) });
    }
  }, [playback, videoPlayback]);

  const handleTogglePlay = useCallback(() => {
    if (stateRef.current.source.video) {
      videoPlayback.toggle();
    } else {
      playback.toggle(stateRef.current.trim.displayed);
    }
  }, [playback, videoPlayback]);

  const handleQualityChange = useCallback((preset) => {
    dispatch({ type: 'SET_QUALITY_PRESET', preset });
    dispatch({ type: 'CLEAR_OUTPUT' });
  }, []);

  // ============ Export ============
  // Hands a set of already-processed (cropped/rounded/resized) ImageData frames
  // plus per-frame durations to the GIF encoder. Shared by both source types.
  const encodePreparedFrames = useCallback(({ frames, frameDurations }, fps, quality) => {
    const first = frames[0];
    if (!first) {
      dispatch({ type: 'SET_ENCODING', isEncoding: false });
      dispatch({ type: 'SET_STATUS', status: 'No frames available to export.' });
      return;
    }
    const dims = `${first.width}×${first.height}`;
    const frameCount = frames.length;
    const finishOutput = (bytes, encoderName) => {
      const blob = new Blob([bytes], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const label = `${encoderName || 'GIFSKI'} · ${dims} · ${frameCount}f · q${quality} · ${formatBytes(blob.size)}`;
      dispatch({ type: 'SET_OUTPUT', url, sizeBytes: blob.size });
      dispatch({ type: 'SET_STATUS', status: `GIF ready · ${label}` });
    };
    const failOutput = (message) => {
      dispatch({ type: 'SET_ENCODING', isEncoding: false });
      dispatch({ type: 'SET_STATUS', status: message || 'Encoding failed.' });
    };

    // ── Real gifski (imagequant global palette + Floyd–Steinberg dither + lossy
    // + alpha→transparent-index). Same engine as the gifski Mac app — this is the
    // single encoder for all three modes (prototype, uploaded video, tab record).
    // Memory is bounded upstream by the long-edge cap + duplicate-frame collapse,
    // so the batch heap stays well within a tab's budget.
    // gifski's batch encode() is a single all-at-once call with no progress
    // callback, so this phase is indeterminate — show an animated bar rather
    // than a frozen percentage.
    dispatch({ type: 'SET_ENCODING', isEncoding: true, progress: 52, status: 'Encoding with GIFSKI', indeterminate: true });
    dispatch({ type: 'SET_STATUS', status: 'Encoding with GIFSKI' });
    encoder.encode(
      {
        frames,
        width: first.width,
        height: first.height,
        fps,
        frameDurations,
        quality,
        repeat: -1, // -1 = loop forever (gifski Repeat::Infinite); n >= 0 plays n times
      },
      {
        onStatus: (message) => {
          dispatch({ type: 'SET_ENCODING', isEncoding: true, status: message });
        },
        onDone: (bytes, encoderName) => finishOutput(bytes, encoderName),
        onError: (message) => failOutput(message),
      },
    );
  }, [encoder]);

  const handleExport = useCallback(async () => {
    dispatch({ type: 'CLEAR_OUTPUT' });
    const trim = stateRef.current.trim;
    const quality = stateRef.current.quality;
    const cropRect = stateRef.current.crop.rect;
    const video = stateRef.current.source.video;

    // ---- Uploaded video: sample the trim window on demand ----
    if (video) {
      if (trim.end <= trim.start) return;
      videoPlayback.pause();
      const controller = new AbortController();
      exportAbortRef.current = controller;
      dispatch({ type: 'SET_ENCODING', isEncoding: true, progress: 3, status: 'Sampling video frames', indeterminate: false });
      dispatch({ type: 'SET_STATUS', status: 'Sampling video frames' });
      let result;
      try {
        // Use the source video's native fps capped at the preset's maxFps —
        // mirrors Gifski which uses assetFrameRate up to its 50fps ceiling.
        // The preset fps field is for prototype (screen-capture) mode only.
        const { maxFps = 50 } = presetFor(quality.preset);
        const videoFps = Math.min(video.sourceFps || 24, maxFps);

        // Sample the trim window and run every frame through the SAME
        // crop → corner-radius → matte → resize → dedup chain the prototype
        // path uses, so all three modes produce identical, transparency-correct
        // frames for the single gifski encoder.
        result = await extractAndProcessVideoRange({
          videoSource: video,
          startMs: trim.start,
          endMs: trim.end,
          fps: videoFps,
          cropRect,
          cornerRadius: quality.cornerRadius,
          gifLongEdge: quality.gifLongEdge,
          fittedWidth: video.width,
          fittedHeight: video.height,
          onProgress: (p) => dispatch({ type: 'SET_ENCODING_PROGRESS', progress: 3 + p * 47 }),
          signal: controller.signal,
        });
      } catch (error) {
        dispatch({ type: 'SET_ENCODING', isEncoding: false });
        if (!controller.signal.aborted) {
          dispatch({ type: 'SET_STATUS', status: error.message || 'Could not sample video frames.' });
        }
        return;
      } finally {
        if (exportAbortRef.current === controller) exportAbortRef.current = null;
      }
      encodePreparedFrames(result, quality.fps, quality.quality);
      return;
    }

    // ---- Recorded take: frames are already in memory ----
    const frames = framesRef.current;
    if (!frames.length || trim.end < trim.start) return;

    dispatch({ type: 'SET_ENCODING', isEncoding: true, progress: 3, status: 'Preparing GIF frames', indeterminate: false });
    dispatch({ type: 'SET_STATUS', status: 'Preparing GIF frames' });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    let prepared;
    try {
      prepared = await prepareExportFrames(
        frames,
        trim.start,
        trim.end,
        {
          fps: quality.fps,
          cropRect,
          cornerRadius: quality.cornerRadius,
          gifLongEdge: quality.gifLongEdge,
        },
        { onProgress: (p) => dispatch({ type: 'SET_ENCODING_PROGRESS', progress: 3 + p * 47 }) },
      );
    } catch (error) {
      dispatch({ type: 'SET_ENCODING', isEncoding: false });
      dispatch({ type: 'SET_STATUS', status: error.message || 'Could not prepare GIF frames.' });
      return;
    }

    encodePreparedFrames(prepared, quality.fps, quality.quality);
  }, [encodePreparedFrames, videoPlayback]);

  const handleCancelExport = useCallback(() => {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    encoder.cancel();
    dispatch({ type: 'SET_ENCODING', isEncoding: false });
    dispatch({ type: 'SET_STATUS', status: 'Encoding cancelled' });
  }, [encoder]);

  const handleBackToEditing = useCallback(() => {
    dispatch({ type: 'CLEAR_OUTPUT' });
  }, []);

  // ============ Drag/drop ============
  const handleDragEnter = useCallback((event) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    dispatch({ type: 'SET_DRAG_DROP', active: true });
  }, []);
  const handleDragLeave = useCallback((event) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) dispatch({ type: 'SET_DRAG_DROP', active: false });
  }, []);
  const handleDragOver = useCallback((event) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDrop = useCallback((event) => {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    dispatch({ type: 'SET_DRAG_DROP', active: false });
    const file = Array.from(event.dataTransfer.files ?? [])[0];
    if (file) handleVideoFile(file);
  }, [handleVideoFile]);

  // Document-level drop (prevent default page behavior)
  useEffect(() => {
    const onDragOver = (event) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
    };
    const onDrop = (event) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      dispatch({ type: 'SET_DRAG_DROP', active: false });
      const file = Array.from(event.dataTransfer.files ?? [])[0];
      if (file) handleVideoFile(file);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, [handleVideoFile]);

  // ============ iframe load ============
  const handleIframeLoad = useCallback(() => {
    if (!state.source.embedUrl) return;
    dispatch({ type: 'SET_PROTOTYPE_LOADING', loading: false });
    dispatch({
      type: 'SET_STATUS',
      status:
        browserWarning ||
        `Prototype embed loaded (${state.source.embedAttempt + 1}/${state.source.embedCandidates.length})`,
    });
  }, [browserWarning, state.source.embedAttempt, state.source.embedCandidates.length, state.source.embedUrl]);

  // ============ Keyboard shortcuts ============
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        dispatch({ type: 'SET_DRAWER', open: false });
      }
      if (event.key === 'Enter') {
        if (stateRef.current.recording.isRecording) {
          event.preventDefault();
          stopRecording();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stopRecording]);

  // ============ Cleanup on unload ============
  useEffect(() => {
    const onBeforeUnload = () => capture.stopStream();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [capture]);

  // ============ Wire "Stop sharing" → stopRecording ============
  useEffect(() => {
    capture.setOnEnded(() => {
      // Defer to next tick so any in-flight capture tick settles first.
      window.setTimeout(() => stopRecording(), 0);
    });
  }, [capture, stopRecording]);

  // ============ Fit stage to the available workspace ============
  // The stage fills the workspace (matching its aspect ratio). Figma scales
  // the prototype inside to fit. Recording resolution = stage dimensions.
  useEffect(() => {
    if (state.stage.hasManualSize) return;
    if (state.frames.length > 0) return;
    if (state.recording.isRecording) return;
    if (state.recording.selectingRegion) return; // don't resize while user is drawing region

    const fit = () => {
      const column = captureStageRef.current?.parentElement;
      if (!column) return;
      const rect = column.getBoundingClientRect();
      const width = Math.max(240, Math.min(1920, Math.floor(rect.width)));
      const height = Math.max(320, Math.min(1920, Math.floor(rect.height)));
      if (width === stateRef.current.stage.width && height === stateRef.current.stage.height) return;
      dispatch({ type: 'SET_STAGE_SIZE', width, height, manual: false });
    };

    fit();
    const observer = new ResizeObserver(fit);
    if (captureStageRef.current?.parentElement) {
      observer.observe(captureStageRef.current.parentElement);
    }
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [state.stage.hasManualSize, state.frames.length, state.recording.isRecording]);

  // ============ Initialization: query param + restore ============
  const initRunRef = useRef(false);
  useEffect(() => {
    if (initRunRef.current) return;
    initRunRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const prototypeUrl = params.get('prototype') ?? params.get('figma') ?? params.get('url');
    const hasQuery = Boolean(prototypeUrl);

    (async () => {
      if (hasQuery) {
        submitUrl(prototypeUrl);
        // Try to restore captured frames silently
        try {
          const recording = await loadLatestRecording();
          if (recording?.frames?.length) {
            const fps = recording.settings?.fps ?? stateRef.current.quality.fps;
            const trim = computeTrimDefaults(recording.frames, fps);
            dispatch({ type: 'LOAD_VIDEO_FRAMES',
              frames: recording.frames,
              dimensions: recording.stage ?? { width: stateRef.current.stage.width, height: stateRef.current.stage.height },
              durationSeconds: recording.durationSeconds ?? recording.frames.length / fps,
            });
            dispatch({ type: 'SET_STAGE_VIEW', view: 'prototype' });
            if (recording.cropRect) dispatch({ type: 'SET_CROP_RECT', rect: recording.cropRect });
            dispatch({ type: 'SET_TRIM', start: trim.start, end: trim.end, displayed: trim.start });
          }
        } catch {}
      } else if (!browserWarning) {
        dispatch({ type: 'SET_STATUS', status: 'Paste a Figma link' });
      } else {
        dispatch({ type: 'SET_STATUS', status: browserWarning });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --stage-max-height is left to the CSS default (calc(100vh - 42px))
  // so a portrait video upload (e.g., 1080x1920) doesn't blow past the
  // viewport cap. The recording aspect ratio comes from --stage-ratio.
  const showStageView = state.stage.view;
  const showEmpty = !hasLoadedSource && !state.loading.video;
  const showLoading =
    state.stage.view === 'prototype' && (state.loading.prototype || state.loading.video);

  // Timeline geometry differs by source: video uses the full duration in ms,
  // a take uses the frame count. selectionMs is the trimmed length for display.
  const hasPreview = hasFrames || isVideoSource;

  // When the floating timeline panel is visible it sits over the bottom ~120px
  // of the stage (position:absolute; bottom:10px; max-height:92px). Reduce
  // --stage-max-height so the stage shrinks to fit above it, keeping the full
  // prototype frame (phone bottom, crop handles) visible and unobscured.
  const stageStyle = {
    '--stage-width': `${state.stage.width}px`,
    '--stage-ratio': `${state.stage.width} / ${state.stage.height}`,
    '--stage-ratio-number': String(state.stage.width / state.stage.height),
    '--stage-max-height': (showStageView === 'preview' && hasPreview)
      ? `calc(100vh - 42px - ${isVideoSource ? 160 : 120}px)`
      : 'calc(100vh - 42px)',
  };

  const timelineExtent = isVideoSource
    ? Math.round(videoSource.duration * 1000)
    : state.frames.length;
  const selectionMs = isVideoSource
    ? Math.max(0, state.trim.end - state.trim.start)
    : frameRangeDurationMs(state.frames, state.trim.start, state.trim.end, state.quality.fps);

  return (
    <div className="app-shell">
      {showTopBar && (
        <TopBar
          status={state.status}
          hasPrototype={hasPrototype}
          isVideoSource={isVideoSource}
          isTabRecording={isVideoSource && state.source.fromTabRecorder}
          isRecording={isRecording}
          recordingSeconds={state.recording.durationSeconds}
          isBusy={isBusy}
          hasCapturedTake={hasCapturedTake}
          canRecord={canStartCapture()}
          onRecord={startRecording}
          onStop={stopRecording}
          onHome={handleHome}
          onReRecord={handleRecordTab}
        />
      )}

      <main className="workspace">
        <section className="stage-column" aria-label="Recording stage">
          <div
            ref={captureStageRef}
            id="captureStage"
            className={`capture-stage${state.dragDropActive ? ' is-dragging-file' : ''}${showStageView === 'preview' ? ' is-previewing' : ''}`}
            style={stageStyle}
          >
            <PrototypeStage
              ref={iframeRef}
              embedUrl={state.source.embedUrl}
              hidden={showStageView !== 'prototype' || !state.source.embedUrl}
              onLoad={handleIframeLoad}
            />
            <BrowserWarning message={browserWarning} />
            {showEmpty && (
              <EmptyStage
                inputValue={state.source.input}
                loading={state.loading.prototype}
                videoLoading={state.loading.video}
                onInputChange={handleInputChange}
                onInputPaste={handleInputPaste}
                onSubmitUrl={submitUrl}
                onVideoFile={handleVideoFile}
                onRecordTab={handleRecordTab}
                dragDropActive={state.dragDropActive}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            )}
            <StageLoading
              title={state.loading.video ? 'Loading video' : 'Loading prototype'}
              detail={state.loading.video ? state.loading.videoDetail : 'Opening Figma embed'}
              hidden={!showLoading}
            />
            <GifPreviewStage
              ref={previewVideoRef}
              imageData={currentImageData}
              videoSource={isVideoSource ? videoSource : null}
              cropRect={state.crop.rect}
              cornerRadius={state.quality.cornerRadius}
              onCropChange={handleCropChange}
              onCornerRadiusChange={handleCornerRadiusChange}
              hidden={showStageView !== 'preview' || !hasPreview}
            />
            <GifResultPreview
              url={state.output.url}
              sizeBytes={state.output.sizeBytes}
              hidden={showStageView !== 'preview' || !state.output.url}
            />
            {/* The recording indicator lives in the TopBar, not here — anything
                overlaying the stage gets baked into the captured frames (and
                throws off auto-crop detection). */}
          </div>

          {showStageView === 'preview' && hasPreview && (
            <TimelineShell
              mode={isVideoSource ? 'video' : 'frames'}
              extent={timelineExtent}
              trim={state.trim}
              selectionMs={selectionMs}
              frames={state.frames}
              fps={state.quality.fps}
              videoSource={isVideoSource ? videoSource : null}
              cropRect={state.crop.rect}
              cornerRadius={state.quality.cornerRadius}
              qualityPreset={state.quality.preset}
              isPlaying={isPlaying}
              isEncoding={state.encoding.isEncoding}
              hasOutput={Boolean(state.output.url)}
              outputSizeBytes={state.output.sizeBytes}
              encoding={state.encoding}
              onTrimChange={handleTrimChange}
              onSelectPos={handleSelectPos}
              onTogglePlay={handleTogglePlay}
              onQualityChange={handleQualityChange}
              onExport={handleExport}
              onCancelExport={handleCancelExport}
              onBackToEditing={handleBackToEditing}
              downloadHref={state.output.url}
            />
          )}
        </section>
      </main>

      {tabRecorder.isRecording && (
        <div className="tab-recording-overlay" role="status" aria-live="polite">
          <div className="tab-recording-card">
            <span className="tab-recording-dot" aria-hidden="true" />
            <strong>Recording another tab…</strong>
            <p>
              Switch to the tab you want to capture. When you’re done, click the browser’s
              {' '}<em>Stop sharing</em> bar or the button below — we’ll notify you to come back.
            </p>
            <button type="button" className="primary-button" onClick={() => tabRecorder.stop()}>
              Stop recording
            </button>
          </div>
        </div>
      )}

      {/* Hidden capture targets */}
      <video ref={captureVideoRef} className="visually-hidden" playsInline muted />
      <canvas ref={captureCanvasRef} hidden />
    </div>
  );
}
