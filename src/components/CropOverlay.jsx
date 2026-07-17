import { useCallback, useEffect, useRef } from 'react';

// Drag is intentionally kept out of React state.
// On every pointermove we mutate the crop-box element's style directly.
// We only dispatch to the reducer on pointerUp, so the Filmstrip / preview
// canvas don't re-render once per move.
export default function CropOverlay({
  cropRect,
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  cornerRadius,
  onCommit,
  onCommitRadius,
}) {
  const overlayRef = useRef(null);
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const liveRectRef = useRef(cropRect);
  const liveRadiusRef = useRef(cornerRadius);

  // Sync refs whenever the parent gives us a new committed rect/radius.
  useEffect(() => {
    liveRectRef.current = cropRect;
    liveRadiusRef.current = cornerRadius;
    paintBox(boxRef.current, cropRect, cornerRadius, displayWidth, displayHeight, imageWidth, imageHeight);
  }, [cropRect, cornerRadius, displayWidth, displayHeight, imageWidth, imageHeight]);

  const cropPointFromEvent = useCallback((event) => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(imageWidth, ((event.clientX - rect.left) / rect.width) * imageWidth)),
      y: Math.max(0, Math.min(imageHeight, ((event.clientY - rect.top) / rect.height) * imageHeight)),
    };
  }, [imageWidth, imageHeight]);

  const handlePointerDown = useCallback((event) => {
    const point = cropPointFromEvent(event);
    if (!point || !liveRectRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.target.dataset?.handle ?? 'move';
    dragRef.current = {
      handle,
      point,
      rect: { ...liveRectRef.current },
      radius: liveRadiusRef.current,
      pointerId: event.pointerId,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  }, [cropPointFromEvent]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = cropPointFromEvent(event);
    if (!point) return;

    if (drag.handle === 'radius') {
      const dy = point.y - drag.rect.y;
      const dxR = drag.rect.x + drag.rect.width - point.x;
      const maxRadius = Math.floor(Math.min(drag.rect.width, drag.rect.height) / 2);
      const next = Math.max(0, Math.min(maxRadius, Math.round((dy + dxR) / 2)));
      liveRadiusRef.current = next;
      paintBox(boxRef.current, liveRectRef.current, next, displayWidth, displayHeight, imageWidth, imageHeight);
      return;
    }

    const minSize = Math.max(8, Math.round(Math.min(imageWidth, imageHeight) * 0.02));
    const startRight = drag.rect.x + drag.rect.width;
    const startBottom = drag.rect.y + drag.rect.height;
    let next = { ...drag.rect };

    if (drag.handle === 'move') {
      next.x = drag.rect.x + point.x - drag.point.x;
      next.y = drag.rect.y + point.y - drag.point.y;
    } else {
      if (drag.handle.includes('w')) {
        const x = Math.min(point.x, startRight - minSize);
        next.x = x;
        next.width = startRight - x;
      }
      if (drag.handle.includes('e')) {
        next.width = Math.max(minSize, point.x - drag.rect.x);
      }
      if (drag.handle.includes('n')) {
        const y = Math.min(point.y, startBottom - minSize);
        next.y = y;
        next.height = startBottom - y;
      }
      if (drag.handle.includes('s')) {
        next.height = Math.max(minSize, point.y - drag.rect.y);
      }
    }

    next.x = Math.max(0, Math.min(next.x, imageWidth - next.width));
    next.y = Math.max(0, Math.min(next.y, imageHeight - next.height));
    next.width = Math.max(minSize, Math.min(next.width, imageWidth - next.x));
    next.height = Math.max(minSize, Math.min(next.height, imageHeight - next.y));

    liveRectRef.current = next;
    paintBox(boxRef.current, next, liveRadiusRef.current, displayWidth, displayHeight, imageWidth, imageHeight);
  }, [cropPointFromEvent, imageWidth, imageHeight, displayWidth, displayHeight]);

  const handlePointerUp = useCallback((event) => {
    if (!dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch {}
    if (drag.handle === 'radius') {
      onCommitRadius(liveRadiusRef.current);
    } else {
      onCommit(liveRectRef.current);
    }
  }, [onCommit, onCommitRadius]);

  if (!cropRect) return null;

  return (
    <div className="crop-overlay" ref={overlayRef}>
      <div
        className="crop-box"
        ref={boxRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'].map((h) => (
          <span key={h} className={`crop-handle ${h}`} data-handle={h} />
        ))}
        {onCommitRadius && (
          <span className="crop-radius-handle" data-handle="radius" title="Adjust corner radius" />
        )}
      </div>
    </div>
  );
}

function paintBox(box, rect, radius, displayWidth, displayHeight, imageWidth, imageHeight) {
  if (!box || !rect || !displayWidth || !displayHeight) return;
  const scaleX = displayWidth / imageWidth;
  const scaleY = displayHeight / imageHeight;
  const displayRadius = Math.min(
    radius * Math.min(scaleX, scaleY),
    Math.min(rect.width * scaleX, rect.height * scaleY) / 2,
  );
  const handleOffset = Math.min(
    Math.max(12, displayRadius),
    Math.min(rect.width * scaleX, rect.height * scaleY) / 2,
  );
  box.style.left = `${rect.x * scaleX}px`;
  box.style.top = `${rect.y * scaleY}px`;
  box.style.width = `${rect.width * scaleX}px`;
  box.style.height = `${rect.height * scaleY}px`;
  box.style.borderRadius = `${displayRadius}px`;
  box.style.setProperty('--radius-handle-offset', `${handleOffset}px`);
}
