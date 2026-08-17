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
  // The full source→output sampling transform (crop rect in video px + output
  // canvas dims), pinned once at the first real capture frame and reused for
  // every subsequent frame. Recomputing it per frame let the mapping drift —
  // e.g. Chrome's "sharing this tab" bar shrinks window.innerHeight right after
  // capture starts, which inflated scaleY and squeezed every frame after the
  // first. Pinning keeps all frames uniformly sized AND identically sampled.
  const sampleRef = useRef(null);

  const setOnEnded = useCallback((cb) => {
    onEndedRef.current = cb;
  }, []);

  // Compute the live source→output transform from the current stage rect, the
  // captured video resolution, and the viewport size.
  const computeSample = useCallback((width, height) => {
    const video = videoRef.current;
    const stage = captureStageRef.current;
    if (!video || !stage || !video.videoWidth || !video.videoHeight) return null;
    const rect = stage.getBoundingClientRect();

    // Output dims: keep the requested width as the long edge, but derive height
    // from the stage's true on-screen aspect ratio, NOT the caller's height —
    // state.stage.height is clamped/floored independently of width, so it can
    // carry a wrong aspect. Drawing into a stage-aspect canvas cancels
    // non-uniform capture scaling and reproduces the stage's real proportions.
    const stageAspect = rect.height > 0 ? rect.width / rect.height : width / height;
    const outW = width;
    const outH = Math.max(1, Math.round(width / stageAspect));

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

    return { outW, outH, sourceX, sourceY, sourceWidth, sourceHeight };
  }, [videoRef, captureStageRef]);

  const drawStageSnapshot = useCallback((width, height, { pin = false } = {}) => {
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!video || !captureCanvas || !video.videoWidth || !video.videoHeight) return null;

    // Reuse the pinned transform once set (recording loop); otherwise compute it
    // live (warm-up / settling, where pin is false so it is never stored).
    let sample = sampleRef.current;
    if (!sample) {
      sample = computeSample(width, height);
      if (!sample) return null;
      if (pin) sampleRef.current = sample;
    }

    const { outW, outH, sourceX, sourceY, sourceWidth, sourceHeight } = sample;
    captureCanvas.width = outW;
    captureCanvas.height = outH;
    const ctx = captureCanvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outW, outH);
    return ctx.getImageData(0, 0, outW, outH);
  }, [videoRef, captureCanvasRef, computeSample]);

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
    sampleRef.current = null; // re-pin the sampling transform for the next session

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
      // Pin the sampling transform on the first frame; all later frames reuse it.
      const snapshot = drawStageSnapshot(width, height, { pin: true });
      if (!snapshot) return;
      onFrame({ imageData: snapshot, capturedAt: performance.now() - startedAt });
    };
    tick();
    captureTimerRef.current = window.setInterval(tick, intervalMs);
    return startedAt;
  }, [drawStageSnapshot]);

  return { startStream, startCaptureLoop, stopStream, warmUp, setOnEnded };
}
