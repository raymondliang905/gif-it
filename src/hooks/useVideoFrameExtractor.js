import { useCallback } from 'react';
import { MAX_STAGE_SIZE } from '../constants.js';

function waitForMediaEvent(media, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener(eventName, handle);
      media.removeEventListener('error', handleError);
    };
    const handle = () => { cleanup(); resolve(); };
    const handleError = () => { cleanup(); reject(new Error('This video could not be decoded by the browser.')); };
    media.addEventListener(eventName, handle, { once: true });
    media.addEventListener('error', handleError, { once: true });
  });
}

async function loadVideoMetadata(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  const loaded = waitForMediaEvent(video, 'loadedmetadata');
  video.load();
  await loaded;
}

async function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.002 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const seeked = waitForMediaEvent(video, 'seeked');
  video.currentTime = time;
  await seeked;
}

function fitVideoDimensions(width, height) {
  const scale = Math.min(1, MAX_STAGE_SIZE / width, MAX_STAGE_SIZE / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isVideoFile(file) {
  return Boolean(file) && (file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name));
}

function nextAnimationFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

export function useVideoFrameExtractor() {
  return useCallback(async (file, fps, { onProgress, signal } = {}) => {
    if (!isVideoFile(file)) throw new Error('Upload a video file such as MP4, MOV, or WebM.');

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    try {
      await loadVideoMetadata(video);
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth || !video.videoHeight) {
        throw new Error('This video has no readable duration or dimensions.');
      }

      const dimensions = fitVideoDimensions(video.videoWidth, video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const frameCount = Math.max(1, Math.ceil(duration * fps));
      const maxSeekTime = Math.max(0, duration - 0.001);
      const frames = [];

      for (let i = 0; i < frameCount; i += 1) {
        if (signal?.aborted) throw new Error('Video frame extraction aborted.');
        const time = Math.min(i / fps, maxSeekTime);
        await seekVideo(video, time);
        ctx.drawImage(video, 0, 0, dimensions.width, dimensions.height);
        frames.push({
          imageData: ctx.getImageData(0, 0, dimensions.width, dimensions.height),
          capturedAt: time * 1000,
        });
        if (i % 8 === 0 || i === frameCount - 1) {
          onProgress?.({ frame: i + 1, total: frameCount });
          await nextAnimationFrame();
        }
      }

      return { frames, dimensions, durationSeconds: duration };
    } finally {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    }
  }, []);
}
