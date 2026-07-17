import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import CropOverlay from './CropOverlay.jsx';

// Renders either a <video> element (for uploaded video sources) or a <canvas>
// (for recorded frame sequences). Crop overlay sits on top of either.
const GifPreviewStage = forwardRef(function GifPreviewStage(
  {
    // Frame-array source (recording)
    imageData,
    // Video source (uploaded file)
    videoSource,        // { objectUrl, width, height } | null
    // Common
    cropRect,
    cornerRadius,
    onCropChange,
    onCornerRadiusChange,
    hidden,
  },
  videoRef,
) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  const sourceWidth = videoSource ? videoSource.width : imageData?.width ?? 0;
  const sourceHeight = videoSource ? videoSource.height : imageData?.height ?? 0;

  // Paint canvas when image data changes (frame-array source only).
  useLayoutEffect(() => {
    if (videoSource) return;
    if (!imageData || hidden) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }, [imageData, hidden, videoSource]);

  // Compute display size to fit container while preserving source aspect.
  useEffect(() => {
    if (hidden || !sourceWidth || !sourceHeight) return;
    const compute = () => {
      const container = containerRef.current;
      if (!container) return;
      const maxWidth = Math.max(1, container.clientWidth - 24);
      const maxHeight = Math.max(1, container.clientHeight - 24);
      const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
      setDisplaySize({
        width: Math.max(1, Math.floor(sourceWidth * scale)),
        height: Math.max(1, Math.floor(sourceHeight * scale)),
      });
    };
    compute();
    const observer = new ResizeObserver(compute);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [sourceWidth, sourceHeight, hidden]);

  if (hidden) return null;

  return (
    <div className="gif-preview-stage" ref={containerRef}>
      <div
        className="stage-preview-frame"
        style={{
          width: displaySize.width ? `${displaySize.width}px` : undefined,
          height: displaySize.height ? `${displaySize.height}px` : undefined,
        }}
      >
        {videoSource ? (
          <video
            ref={videoRef}
            className="stage-preview-canvas"
            src={videoSource.objectUrl}
            muted
            playsInline
            preload="auto"
            style={{
              width: displaySize.width ? `${displaySize.width}px` : undefined,
              height: displaySize.height ? `${displaySize.height}px` : undefined,
              objectFit: 'fill',
              background: '#050706',
            }}
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="stage-preview-canvas"
            style={{
              width: displaySize.width ? `${displaySize.width}px` : undefined,
              height: displaySize.height ? `${displaySize.height}px` : undefined,
            }}
          />
        )}
        {sourceWidth > 0 && displaySize.width > 0 && (
          <CropOverlay
            cropRect={cropRect}
            imageWidth={sourceWidth}
            imageHeight={sourceHeight}
            displayWidth={displaySize.width}
            displayHeight={displaySize.height}
            cornerRadius={cornerRadius}
            onCommit={onCropChange}
            onCommitRadius={onCornerRadiusChange}
          />
        )}
      </div>
    </div>
  );
});

export default GifPreviewStage;
