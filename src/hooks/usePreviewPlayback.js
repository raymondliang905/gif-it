import { useCallback, useEffect, useRef, useState } from 'react';

export function usePreviewPlayback({ frames, trimStart, trimEnd, fps, onTick }) {
  const timerRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const frameRef = useRef(trimStart);

  const stop = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const start = useCallback((startFrame = trimStart) => {
    if (!frames.length) return;
    frameRef.current = Math.max(trimStart, Math.min(trimEnd, startFrame));
    setIsPlaying(true);
    const intervalMs = Math.round(1000 / Math.max(1, fps));
    const tick = () => {
      onTick(frameRef.current);
      frameRef.current += 1;
      if (frameRef.current > trimEnd) stop();
    };
    tick();
    timerRef.current = window.setInterval(tick, intervalMs);
  }, [frames.length, trimStart, trimEnd, fps, onTick, stop]);

  const toggle = useCallback((displayed) => {
    if (timerRef.current) {
      stop();
    } else {
      start(displayed ?? trimStart);
    }
  }, [start, stop, trimStart]);

  useEffect(() => () => stop(), [stop]);

  return { isPlaying, start, stop, toggle };
}
