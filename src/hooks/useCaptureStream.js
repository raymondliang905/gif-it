import { useCallback, useRef } from 'react';
import { CAPTURE_WARMUP_FRAMES, CAPTURE_WARMUP_MS } from '../constants.js';
import { captureSupportMessage } from '../lib/capture-support.js';

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useCaptureStream({ videoRef, captureStageRef, captureCanvasRef }) {
  const streamRef = useRef(null);
  const captureTimerRef = useRef(null);
  const onEndedRef = useRef(null);
  // Output canvas dims, pinned once per recording so every frame is the same
  // size (the encoder requires uniform frames).
  const outputDimsRef = useRef(null);

  const setOnEnded = useCallback((cb) => {
    onEndedRef.current = cb;
  }, []);

  const drawStageSnapshot = useCallback((width, height) => {
    const video = videoRef.current;
    const stage = captureStageRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!video || !stage || !captureCanvas || !video.videoWidth || !video.videoHeight) {
      return null;
    }
    const rect = stage.getBoundingClientRect();

    // Output dims: keep the requested width as the long edge, but derive height
    // from the stage's true on-screen aspect ratio, NOT the caller's height —
    // state.stage.height is clamped/floored independently of width, so it can
    // carry a wrong aspect. Combined with the per-axis source sampling below,
    // drawing into a stage-aspect canvas cancels non-uniform capture scaling
    // and reproduces the stage's real proportions. Pinned for the whole
    // recording so frame sizes stay uniform.
    if (!outputDimsRef.current) {
      const stageAspect = rect.height > 0 ? rect.width / rect.height : width / height;
      outputDimsRef.current = {
        width,
        height: Math.max(1, Math.round(width / stageAspect)),
      };
    }
    const outW = outputDimsRef.current.width;
    const outH = outputDimsRef.current.height;
    captureCanvas.width = outW;
    captureCanvas.height = outH;
    const ctx = captureCanvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // The captured frame is the ENTIRE tab viewport rastered to videoWidth ×
    // videoHeight, so the CSS-px → video-px mapping is linear and INDEPENDENT
    // per axis: horizontal = videoWidth/innerWidth, vertical = videoHeight/innerHeight.
    // These are only equal when the browser captures at the exact viewport aspect
    // ratio — Chrome routinely clamps/snaps the capture resolution, so they differ.
    const scaleX = video.videoWidth / window.innerWidth;
    const scaleY = video.videoHeight / window.innerHeight;
    const sourceX = Math.max(0, rect.left * scaleX);
    const sourceY = Math.max(0, rect.top * scaleY);
    const sourceWidth = Math.max(1, Math.min(video.videoWidth - sourceX, rect.width * scaleX));
    const sourceHeight = Math.max(1, Math.min(video.videoHeight - sourceY, rect.height * scaleY));

    ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outW, outH);
    return ctx.getImageData(0, 0, outW, outH);
  }, [videoRef, captureStageRef, captureCanvasRef]);

  const stopStream = useCallback(() => {
    if (captureTimerRef.current) {
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, [videoRef]);

  const startStream = useCallback(async (fps) => {
    const unsupported = captureSupportMessage();
    if (unsupported) throw new Error(unsupported);
    outputDimsRef.current = null; // re-pin output dims from the next session's stage rect

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: fps, displaySurface: 'browser' },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    });
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) throw new Error('Capture video element not mounted.');
    video.srcObject = stream;
    await video.play();
    // When the user clicks "Stop sharing" in the browser bar, this fires.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (captureTimerRef.current && onEndedRef.current) {
        onEndedRef.current();
      } else {
        stopStream();
      }
    });
  }, [videoRef, stopStream]);

  const warmUp = useCallback(async ({ width, height }) => {
    const startedAt = performance.now();
    while (performance.now() - startedAt < CAPTURE_WARMUP_MS) {
      await nextAnimationFrame();
      drawStageSnapshot(width, height);
    }
    for (let i = 0; i < CAPTURE_WARMUP_FRAMES; i += 1) {
      await nextAnimationFrame();
      drawStageSnapshot(width, height);
    }
    await wait(60);
  }, [drawStageSnapshot]);

  const startCaptureLoop = useCallback(({ width, height, fps, onFrame }) => {
    if (captureTimerRef.current) {
      window.clearInterval(captureTimerRef.current);
    }
    const intervalMs = Math.round(1000 / Math.max(1, fps));
    const startedAt = performance.now();
    const tick = () => {
      const snapshot = drawStageSnapshot(width, height);
      if (!snapshot) return;
      onFrame({ imageData: snapshot, capturedAt: performance.now() - startedAt });
    };
    tick();
    captureTimerRef.current = window.setInterval(tick, intervalMs);
    return startedAt;
  }, [drawStageSnapshot]);

  return { startStream, startCaptureLoop, stopStream, warmUp, setOnEnded };
}
