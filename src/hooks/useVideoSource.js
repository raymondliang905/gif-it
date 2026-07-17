import { useCallback } from 'react';
import { MAX_STAGE_SIZE } from '../constants.js';

function waitForMediaEvent(media, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener(eventName, handle);
      media.removeEventListener('error', handleError);
    };
    const handle = () => { cleanup(); resolve(); };
    const handleError = () => {
      cleanup();
      reject(new Error('This video could not be decoded by the browser.'));
    };
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

// MediaRecorder-produced webm reports duration === Infinity until the browser
// is forced to scan to the end. Seeking past the end resolves the real value.
// Plain uploaded files already have a finite duration and skip this.
function resolveDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('durationchange', onChange);
      video.removeEventListener('timeupdate', onChange);
      try { video.currentTime = 0; } catch {}
      resolve(value);
    };
    const onChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) finish(video.duration);
    };
    const timer = setTimeout(
      () => finish(Number.isFinite(video.duration) ? video.duration : 0),
      3000,
    );
    video.addEventListener('durationchange', onChange);
    video.addEventListener('timeupdate', onChange);
    try { video.currentTime = 1e7; } catch {}
  });
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

// Sample a single frame from the video so callers can run detectForegroundBounds
// and offer a tight initial crop. Returns ImageData at the fitted dimensions
// (videoSource.width × videoSource.height), or null on failure.
//
// MediaRecorder-produced webm files have no seek index, so seeking to an
// arbitrary time silently fails and the frame returned is black. Instead we
// play from the start and capture the first frame the decoder presents via
// requestVideoFrameCallback. This works for both seekable uploaded files and
// non-seekable tab/screen recordings.
export async function sampleFirstVideoFrame(videoSource) {
  const { objectUrl, width, height } = videoSource;
  if (!objectUrl || !width || !height) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  try {
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      setTimeout(reject, 5000);
    });
    await new Promise((resolve) => {
      let done = false;
      const capture = () => {
        if (done) return;
        done = true;
        ctx.drawImage(video, 0, 0, width, height);
        try { video.pause(); } catch {}
        resolve();
      };
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(capture);
      } else {
        video.addEventListener('timeupdate', function once() {
          video.removeEventListener('timeupdate', once);
          capture();
        }, { once: true });
      }
      setTimeout(resolve, 3000); // fallback: resolve even if no frame fires
      video.play().catch(() => resolve());
    });
    return ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  } finally {
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
  }
}

// Metadata-only loader. No frames are extracted; the video file stays as the
// source of truth and the editor plays it directly via <video>. Frames are
// only sampled on export, inside the trim range.
export function useVideoSource() {
  return useCallback(async (file) => {
    if (!isVideoFile(file)) {
      throw new Error('Upload a video file such as MP4, MOV, or WebM.');
    }

    const objectUrl = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = 'metadata';
    probe.src = objectUrl;

    try {
      await loadVideoMetadata(probe);
      const duration = await resolveDuration(probe);
      const nativeWidth = probe.videoWidth;
      const nativeHeight = probe.videoHeight;
      if (
        !Number.isFinite(duration) || duration <= 0 ||
        !nativeWidth || !nativeHeight
      ) {
        URL.revokeObjectURL(objectUrl);
        throw new Error('This video has no readable duration or dimensions.');
      }
      // Detect native fps via captureStream — mirrors Gifski's assetFrameRate.
      // captureStream() on an HTMLVideoElement returns a MediaStream whose video
      // track settings include the file's actual frame rate. Falls back to 24fps
      // (safe for most UI recordings) if the API is unavailable or returns 0.
      let sourceFps = 0;
      try {
        const stream = probe.captureStream?.();
        if (stream) {
          const settings = stream.getVideoTracks()[0]?.getSettings?.();
          if (settings?.frameRate > 0) sourceFps = Math.round(settings.frameRate);
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch {}
      if (!(sourceFps > 0)) sourceFps = 24;

      const dimensions = fitVideoDimensions(nativeWidth, nativeHeight);
      return {
        file,
        objectUrl,
        duration,
        width: dimensions.width,
        height: dimensions.height,
        nativeWidth,
        nativeHeight,
        sourceFps,
      };
    } finally {
      // Always release the probe so it doesn't hold a decoder.
      try {
        probe.removeAttribute('src');
        probe.load();
      } catch {}
    }
  }, []);
}
