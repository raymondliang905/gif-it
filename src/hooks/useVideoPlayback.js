import { useCallback, useEffect, useRef, useState } from 'react';

// Drives a <video> element for the preview/trim experience.
// - play/pause use native video controls
// - currentTime stays clamped to [trimStartMs, trimEndMs] during playback
// - when playback reaches trimEnd, the loop wraps to trimStart
// - external scrubbing (handleSelectPos) seeks the video and reports back
//
// `sourceKey` (the current object URL) is a dependency of the listener effect
// purely so it re-runs once the preview <video> actually mounts. Refs don't
// trigger effects, so without it the listeners would never bind for a video
// uploaded after first render.
export function useVideoPlayback({ videoRef, sourceKey, trimStartMs, trimEndMs, onTimeChange }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const trimRef = useRef({ start: trimStartMs, end: trimEndMs });
  trimRef.current = { start: trimStartMs, end: trimEndMs };

  // Sync video element listeners.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      setIsPlaying(false);
      return;
    }
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      const tMs = video.currentTime * 1000;
      const { start, end } = trimRef.current;
      if (tMs >= end - 16) {
        // Loop back to start
        video.currentTime = start / 1000;
        onTimeChange?.(start);
      } else {
        onTimeChange?.(tMs);
      }
    };
    const onSeeked = () => {
      onTimeChange?.(video.currentTime * 1000);
    };
    const onEnded = () => {
      video.currentTime = trimRef.current.start / 1000;
      try { video.play(); } catch {}
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoRef, sourceKey, onTimeChange]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const { start, end } = trimRef.current;
    // If currentTime is outside the trim range or at the very end, snap back to start.
    const tMs = video.currentTime * 1000;
    if (tMs < start || tMs >= end - 16) {
      video.currentTime = start / 1000;
    }
    video.play().catch(() => {});
  }, [videoRef]);

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
  }, [videoRef]);

  const toggle = useCallback(() => {
    if (isPlaying) pause(); else play();
  }, [isPlaying, play, pause]);

  const seek = useCallback((ms) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, ms / 1000);
    video.currentTime = clamped;
  }, [videoRef]);

  return { isPlaying, play, pause, toggle, seek };
}
