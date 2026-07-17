import { useCallback, useRef, useState } from 'react';

// Records another browser tab/window/screen via getDisplayMedia + MediaRecorder.
// MediaRecorder encodes at the browser's media-pipeline level, so it keeps
// recording even while the GIFit tab is backgrounded (unlike a JS draw loop,
// which background tabs throttle). On stop it yields a webm Blob that the app
// feeds into the existing video-source pipeline.

export function isTabRecordingSupported() {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  }) || '';
}

export function useTabRecorder() {
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const callbacksRef = useRef({});
  const [isRecording, setIsRecording] = useState(false);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  const start = useCallback(async ({ onComplete, onError } = {}) => {
    callbacksRef.current = { onComplete, onError };
    // No preferCurrentTab: let the user pick a DIFFERENT tab. Exclude GIFit
    // itself from the picker so it can't be chosen by accident.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // Ask for native (Retina) pixels — the browser clamps to what the source
      // surface can provide. Reliable for window/screen capture; tab capture is
      // capped at the tab's logical size, where bitrate + contentHint matter more.
      video: {
        displaySurface: 'browser',
        frameRate: { ideal: 30 },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
    streamRef.current = stream;
    chunksRef.current = [];

    // 'detail' tells the VP9 encoder to favor per-frame sharpness over smooth
    // motion — the right tradeoff for UI/text recordings headed for a GIF.
    const track = stream.getVideoTracks()[0];
    if (track) {
      try { track.contentHint = 'detail'; } catch {}
    }

    // MediaRecorder defaults to ~2.5 Mbps, which blocks up sharp UI/text edges
    // before frames are ever sampled. Target ~0.3 bits/pixel for screen content,
    // clamped to a sane 8–24 Mbps from the track's actual resolution.
    const { width = 1280, height = 720, frameRate = 30 } = track?.getSettings?.() ?? {};
    const videoBitsPerSecond = Math.min(
      24_000_000,
      Math.max(8_000_000, Math.round(width * height * frameRate * 0.3)),
    );

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      cleanup();
      if (blob.size > 0) callbacksRef.current.onComplete?.(blob);
      else callbacksRef.current.onError?.('No video was captured.');
    };
    recorder.onerror = () => {
      cleanup();
      callbacksRef.current.onError?.('Tab recording failed.');
    };

    // The browser's "Stop sharing" control ends the track — finalize on that.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    });

    recorder.start();
    setIsRecording(true);
  }, [cleanup]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop(); // → onstop → onComplete
    } else {
      cleanup();
    }
  }, [cleanup]);

  return { isRecording, start, stop };
}
