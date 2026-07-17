import { useCallback, useEffect, useRef, useState } from 'react';
import { TRIM_TRACK_INSET } from '../constants.js';
import { formatBytes } from '../lib/formatters.js';
import Filmstrip from './Filmstrip.jsx';
import VideoFilmstrip from './VideoFilmstrip.jsx';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function posFromPointer(track, event, extent, { clampToTrim, trim } = {}) {
  const rect = track.getBoundingClientRect();
  const inset = Math.min(TRIM_TRACK_INSET, Math.max(0, rect.width / 2));
  const usableLeft = rect.left + inset;
  const usableWidth = Math.max(1, rect.width - inset * 2);
  const normalized = clamp((event.clientX - usableLeft) / usableWidth, 0, 1);
  const raw = normalized * extent;
  const pos = clamp(raw, 0, extent);
  if (!clampToTrim) return pos;
  return clamp(pos, trim.start, trim.end);
}

function trimEdgeFromPointer(track, event, edge, extent) {
  const rect = track.getBoundingClientRect();
  const inset = Math.min(TRIM_TRACK_INSET, Math.max(0, rect.width / 2));
  const usableLeft = rect.left + inset;
  const usableWidth = Math.max(1, rect.width - inset * 2);
  const normalized = clamp((event.clientX - usableLeft) / usableWidth, 0, 1);
  return clamp(normalized * extent, 0, extent);
}

// mode: 'frames' for recorded takes (extent = frames.length, units = frame indices)
//       'video' for uploaded videos (extent = durationMs, units = milliseconds)
export default function TimelineShell({
  mode,
  extent,
  trim,
  selectionMs,         // duration of trim selection in ms (computed by parent)
  // For frame-mode filmstrip:
  frames,
  fps,
  // For video-mode filmstrip:
  videoSource,
  // Crop/radius for filmstrip rendering:
  cropRect,
  cornerRadius,
  // Playback:
  isPlaying,
  isEncoding,
  hasOutput,
  outputSizeBytes,
  encoding,
  qualityPreset,
  // Callbacks:
  onTrimChange,
  onSelectPos,          // pos in extent units
  onTogglePlay,
  onQualityChange,
  onExport,
  onCancelExport,
  onBackToEditing,
  downloadHref,
}) {
  const trackRef = useRef(null);
  const trimDragRef = useRef(null);
  const scrubDragRef = useRef(null);

  const onStartTrim = useCallback((edge) => (event) => {
    event.preventDefault();
    trimDragRef.current = { edge, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onTrackPointerDown = useCallback((event) => {
    if (extent <= 0 || event.target.closest('.trim-handle')) return;
    scrubDragRef.current = { pointerId: event.pointerId };
    trackRef.current?.setPointerCapture(event.pointerId);
    const next = posFromPointer(trackRef.current, event, extent, {
      clampToTrim: true,
      trim,
    });
    onSelectPos(next);
  }, [extent, trim, onSelectPos]);

  const onPointerMove = useCallback((event) => {
    if (trimDragRef.current && trackRef.current) {
      const drag = trimDragRef.current;
      const pos = trimEdgeFromPointer(trackRef.current, event, drag.edge, extent);
      if (drag.edge === 'start') {
        const nextStart = Math.min(pos, trim.end);
        onTrimChange({ start: nextStart, end: trim.end, displayed: nextStart });
      } else {
        const nextEnd = Math.max(pos, trim.start);
        onTrimChange({ start: trim.start, end: nextEnd, displayed: nextEnd });
      }
      return;
    }
    if (scrubDragRef.current && trackRef.current) {
      const pos = posFromPointer(trackRef.current, event, extent, {
        clampToTrim: true,
        trim,
      });
      onSelectPos(pos);
    }
  }, [extent, trim, onTrimChange, onSelectPos]);

  const onPointerUp = useCallback(() => {
    trimDragRef.current = null;
    scrubDragRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // ---- Draggable panel ----
  // The whole bar is draggable by clicking on any empty/non-interactive area.
  // Interactive regions (.trim-track, buttons, selects, links) are excluded so
  // their own pointer semantics are preserved.
  const shellRef = useRef(null);
  const panelDragRef = useRef(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const onShellPointerDown = useCallback((event) => {
    if (event.target.closest('.trim-track, button, select, a')) return;
    event.preventDefault();
    panelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: dragOffset.x,
      baseY: dragOffset.y,
      rect: shellRef.current?.getBoundingClientRect(),
    };
    shellRef.current?.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'grabbing';
  }, [dragOffset]);

  const onShellPointerMove = useCallback((event) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    let dx = event.clientX - drag.startX;
    let dy = event.clientY - drag.startY;
    const r = drag.rect;
    if (r) {
      dx = Math.min(Math.max(dx, 12 - r.left), window.innerWidth - 12 - r.right);
      dy = Math.min(Math.max(dy, 48 - r.top), window.innerHeight - 8 - r.bottom);
    }
    setDragOffset({ x: drag.baseX + dx, y: drag.baseY + dy });
  }, []);

  const onShellPointerUp = useCallback(() => {
    if (!panelDragRef.current) return;
    panelDragRef.current = null;
    document.body.style.cursor = '';
  }, []);

  if (extent <= 0) return null;

  const trackWidth = trackRef.current?.clientWidth ?? trackRef.current?.getBoundingClientRect().width ?? 0;
  const inset = Math.min(TRIM_TRACK_INSET, Math.max(0, trackWidth / 2));
  const usableWidth = Math.max(1, trackWidth - inset * 2);
  const left = inset + (trim.start / extent) * usableWidth;
  const widthPx = ((trim.end - trim.start) / extent) * usableWidth || 2;
  const right = Math.max(0, trackWidth - left - widthPx);
  const playheadX = inset + (clamp(trim.displayed, 0, extent) / extent) * usableWidth;

  const seconds = (selectionMs / 1000).toFixed(1);
  const sizeLabel = outputSizeBytes ? ` · ${formatBytes(outputSizeBytes)}` : '';

  return (
    <div
      ref={shellRef}
      className={`timeline-shell${isEncoding ? ' is-encoding' : ''}${hasOutput ? ' is-exported' : ''}${mode === 'video' ? ' is-video' : ''}`}
      style={{ transform: `translateX(50%) translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
      tabIndex={0}
      aria-label="GIF preview controls"
      onPointerDown={onShellPointerDown}
      onPointerMove={onShellPointerMove}
      onPointerUp={onShellPointerUp}
      onPointerCancel={onShellPointerUp}
    >

      {!hasOutput && !isEncoding && (
        <button
          type="button"
          className={`trim-play-button${isPlaying ? ' is-playing' : ''}`}
          onClick={onTogglePlay}
          aria-label={isPlaying ? 'Pause trimmed preview' : 'Play trimmed preview'}
        >
          <span />
        </button>
      )}
      {!hasOutput && !isEncoding && (
        <div className="trim-track" ref={trackRef} onPointerDown={onTrackPointerDown}>
          {mode === 'video' ? (
            <VideoFilmstrip
              videoSource={videoSource}
              cropRect={cropRect}
              cornerRadius={cornerRadius}
            />
          ) : (
            <Filmstrip
              frames={frames}
              cropRect={cropRect}
              cornerRadius={cornerRadius}
              displayedFrame={trim.displayed}
              onSelectFrame={onSelectPos}
            />
          )}
          <div
            className="trim-mask start"
            style={{ left: `${inset}px`, width: `${Math.max(0, left - inset)}px` }}
          />
          <div
            className="trim-mask end"
            style={{ right: `${inset}px`, width: `${Math.max(0, right - inset)}px` }}
          />
          <div
            className="trim-selection"
            style={{ left: `${left}px`, width: `${Math.max(2, widthPx)}px` }}
          >
            <button
              type="button"
              className="trim-handle start"
              aria-label="Trim start"
              onPointerDown={onStartTrim('start')}
            />
            <button
              type="button"
              className="trim-handle end"
              aria-label="Trim end"
              onPointerDown={onStartTrim('end')}
            />
          </div>
          <div className="trim-playhead" style={{ left: `${playheadX}px` }} />
        </div>
      )}

      {isEncoding && (
        <div className="encoding-state" role="status" aria-live="polite">
          <div className="encoding-copy">
            <div className="encoding-header">
              <strong>{encoding.status || `Encoding ${seconds}s GIF`}</strong>
              <span>{encoding.indeterminate ? '…' : `${Math.round(encoding.progress)}%`}</span>
            </div>
            <div
              className={`encoding-progress${encoding.indeterminate ? ' is-indeterminate' : ''}`}
              role="progressbar"
              aria-label="GIF export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={encoding.indeterminate ? undefined : Math.round(encoding.progress)}
            >
              <span style={encoding.indeterminate ? undefined : { width: `${Math.round(encoding.progress)}%` }} />
            </div>
          </div>
          <button type="button" onClick={onCancelExport} disabled={!isEncoding}>
            Cancel
          </button>
        </div>
      )}

      {!isEncoding && (
        <span className="trim-info">
          {seconds}s{sizeLabel}
        </span>
      )}

      <div className="timeline-actions">
        {!hasOutput && !isEncoding && (
          <select
            aria-label="Export quality"
            value={qualityPreset}
            onChange={(event) => onQualityChange(event.target.value)}
          >
            <option value="balanced">Balanced</option>
            <option value="small">Small file</option>
            <option value="best">Best quality</option>
            <option value="max" disabled>Max (not on web)</option>
          </select>
        )}
        {!hasOutput && !isEncoding && (
          <button type="button" className="primary-button" onClick={onExport}>
            Export
          </button>
        )}
        {hasOutput && (
          <button type="button" onClick={onBackToEditing}>
            Back to editing
          </button>
        )}
        {hasOutput && (
          <a className="download-link" href={downloadHref} download="prototype.gif">
            Download
          </a>
        )}
      </div>
    </div>
  );
}
