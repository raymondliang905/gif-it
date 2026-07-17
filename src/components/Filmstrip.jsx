import { useEffect, useMemo, useState } from 'react';
import { MAX_TIMELINE_THUMBS } from '../constants.js';
import { makeThumbnailDataUrl, processFrameImageData } from '../lib/image-processing.js';

export default function Filmstrip({ frames, cropRect, cornerRadius, displayedFrame, onSelectFrame }) {
  const segments = useMemo(() => {
    if (!frames.length) return [];
    const thumbCount = Math.min(frames.length, MAX_TIMELINE_THUMBS);
    const result = [];
    for (let slot = 0; slot < thumbCount; slot += 1) {
      const segmentStart = Math.floor((slot * frames.length) / thumbCount);
      const segmentEnd = Math.min(
        frames.length - 1,
        Math.floor(((slot + 1) * frames.length) / thumbCount) - 1,
      );
      const index = Math.round((segmentStart + segmentEnd) / 2);
      result.push({ index, segmentStart, segmentEnd });
    }
    return result;
  }, [frames]);

  const [thumbs, setThumbs] = useState([]);

  useEffect(() => {
    if (!frames.length) {
      setThumbs([]);
      return;
    }
    let cancelled = false;
    const ids = setTimeout(() => {
      if (cancelled) return;
      const next = segments.map(({ index, segmentStart, segmentEnd }) => ({
        url: makeThumbnailDataUrl(processFrameImageData(frames[index].imageData, cropRect, cornerRadius)),
        index,
        segmentStart,
        segmentEnd,
      }));
      if (!cancelled) setThumbs(next);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(ids);
    };
  }, [frames, segments, cropRect, cornerRadius]);

  if (!thumbs.length) return null;

  return (
    <div
      className="timeline"
      style={{ gridTemplateColumns: `repeat(${thumbs.length}, minmax(0, 1fr))` }}
    >
      {thumbs.map((thumb) => {
        const active = displayedFrame >= thumb.segmentStart && displayedFrame <= thumb.segmentEnd;
        return (
          <button
            key={thumb.index}
            type="button"
            className={`thumb${active ? ' active' : ''}`}
            data-frame-index={thumb.index}
            data-segment-start={thumb.segmentStart}
            data-segment-end={thumb.segmentEnd}
            draggable={false}
            aria-label={
              thumb.segmentStart === thumb.segmentEnd
                ? `Preview frame ${thumb.index}`
                : `Preview frames ${thumb.segmentStart} to ${thumb.segmentEnd}`
            }
            onClick={(event) => {
              event.stopPropagation();
              onSelectFrame(thumb.index);
            }}
          >
            <img src={thumb.url} alt="" draggable={false} />
          </button>
        );
      })}
    </div>
  );
}
