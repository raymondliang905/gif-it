import { useEffect, useMemo, useState } from 'react';
import { MAX_TIMELINE_THUMBS } from '../constants.js';
import { makeThumbnailDataUrl, processFrameImageData } from '../lib/image-processing.js';

// Seek to `time` and draw the frame into ctx. The critical detail: a bare
// 'seeked' event can fire BEFORE the new frame is actually presented to the
// compositor, so drawImage right after 'seeked' often grabs a blank/black
// frame on a detached <video>. We instead wait for requestVideoFrameCallback
// (fires only when a frame is painted) before drawing — the same guarantee the
// export path relies on. Falls back to rAF, and to a timeout so one stubborn
// seek can't hang the strip.
function captureFrameAt(video, time, ctx, w, h, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const draw = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      try { ctx.drawImage(video, 0, 0, w, h); } catch {}
      resolve();
    };
    const onPresented = () => {
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => draw());
      } else {
        requestAnimationFrame(() => requestAnimationFrame(draw));
      }
    };
    const onSeeked = () => onPresented();
    const timer = setTimeout(draw, timeoutMs);
    if (Math.abs(video.currentTime - time) < 0.002 && video.readyState >= 2) {
      onPresented();
    } else {
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = time;
    }
  });
}

// Resolve once metadata (duration + dimensions) is available — readyState >= 1
// / the 'loadedmetadata' event — mirroring the proven export path in
// video-export.js. We deliberately do NOT wait for readyState >= 2
// ('loadeddata'): a detached preload='auto' <video> commonly stalls at
// HAVE_METADATA and only loads frame data once *played*, so waiting for
// 'loadeddata' here hangs forever and the strip never samples. A timeout
// guards against a probe that never even reports metadata.
function waitForMetadata(video, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('This video could not be decoded.')); };
    const onTimeout = () => { cleanup(); reject(new Error('Timed out waiting for video metadata.')); };
    const timer = setTimeout(onTimeout, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

// Generates a fixed set of thumbnails by seeking the video to evenly-spaced
// times. The raw ImageData per slot is cached; reapplying crop/cornerRadius
// only re-runs the cheap post-processing pass, not the seek/decode.
export default function VideoFilmstrip({ videoSource, cropRect, cornerRadius }) {
  const [rawFrames, setRawFrames] = useState([]); // [{ time, imageData }]
  const [thumbnails, setThumbnails] = useState([]); // [{ time, url }]

  // Seek through the video once per video source to grab raw frames.
  useEffect(() => {
    if (!videoSource?.objectUrl) {
      setRawFrames([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const probe = document.createElement('video');
      probe.muted = true;
      probe.playsInline = true;
      probe.preload = 'auto';
      probe.src = videoSource.objectUrl;
      try {
        await waitForMetadata(probe);
        if (cancelled) return;

        const slotCount = MAX_TIMELINE_THUMBS;
        // Prefer the source's resolved duration: MediaRecorder webm probes can
        // report Infinity, and useVideoSource has already recovered the real value.
        const duration = Number.isFinite(videoSource.duration) && videoSource.duration > 0
          ? videoSource.duration
          : probe.duration;
        const w = videoSource.width;
        const h = videoSource.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Evenly-spaced target timestamps across the clip.
        const targets = [];
        for (let i = 0; i < slotCount; i += 1) {
          targets.push(Math.min(((i + 0.5) / slotCount) * duration, Math.max(0, duration - 0.001)));
        }

        const frames = [];
        const pushFrame = (time) => {
          ctx.drawImage(probe, 0, 0, w, h);
          frames.push({ time, imageData: ctx.getImageData(0, 0, w, h) });
          // Publish progressively so thumbnails fill in as they decode.
          if (!cancelled) setRawFrames(frames.slice());
        };

        if (typeof probe.requestVideoFrameCallback === 'function') {
          // Preferred: play muted at high speed and grab each frame as playback
          // passes a target. requestVideoFrameCallback only fires for frames
          // actually *presented* to the compositor, so captures are never the
          // blank/black result a paused seek+drawImage can produce. This is the
          // same technique the GIF exporter uses, which is known to work here.
          await new Promise((resolve) => {
            let next = 0;
            let settled = false;
            const stop = () => {
              if (settled) return;
              settled = true;
              clearTimeout(safety);
              try { probe.pause(); } catch {}
              resolve();
            };
            // MediaRecorder webm blobs have duration=Infinity in the container, so
            // Chrome treats the probe like a live stream and never fires 'ended'.
            // Instead, when the decoder runs out of blob data it fires 'waiting'.
            // We also stop if mediaTime reaches within 0.1s of the real duration.
            const safety = setTimeout(stop, 2000);
            const onFrame = (_now, meta) => {
              if (cancelled) return stop();
              const t = meta.mediaTime;
              while (next < targets.length && t >= targets[next] - 0.05) {
                pushFrame(targets[next]);
                next += 1;
              }
              if (next >= targets.length) return stop();
              // Near the end of known duration — no more useful frames coming.
              if (Number.isFinite(duration) && t >= duration - 0.1) return stop();
              probe.requestVideoFrameCallback(onFrame);
            };
            probe.addEventListener('ended', stop, { once: true });
            probe.addEventListener('waiting', stop, { once: true });
            probe.addEventListener('error', stop, { once: true });
            probe.requestVideoFrameCallback(onFrame);
            probe.playbackRate = 16;
            probe.play().then(() => { probe.playbackRate = 16; }).catch(stop);
          });
        } else {
          // Fallback (no rVFC): per-target seek, waiting for the painted frame.
          for (let i = 0; i < slotCount; i += 1) {
            if (cancelled) return;
            await captureFrameAt(probe, targets[i], ctx, w, h);
            if (cancelled) return;
            pushFrame(targets[i]);
          }
        }
      } catch {
        // best-effort; if thumbnails fail we just show the trim track with no thumbs
      } finally {
        try {
          probe.removeAttribute('src');
          probe.load();
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoSource?.objectUrl, videoSource?.width, videoSource?.height]);

  // Re-render thumbnails when crop/radius changes (uses cached raw frames).
  useEffect(() => {
    if (!rawFrames.length) {
      setThumbnails([]);
      return;
    }
    setThumbnails(
      rawFrames.map((rf) => ({
        time: rf.time,
        url: makeThumbnailDataUrl(processFrameImageData(rf.imageData, cropRect, cornerRadius)),
      })),
    );
  }, [rawFrames, cropRect, cornerRadius]);

  const columns = useMemo(() => thumbnails.length || 1, [thumbnails.length]);

  if (!thumbnails.length) return <div className="timeline" />;

  return (
    <div
      className="timeline"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {thumbnails.map((thumb, i) => (
        <span key={i} className="thumb" aria-hidden="true">
          <img src={thumb.url} alt="" draggable={false} />
        </span>
      ))}
    </div>
  );
}
