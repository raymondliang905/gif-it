import {
  EDGE_MATTE_COLOR_DELTA,
  EDGE_MATTE_MIN_LUMA,
  MAX_GIF_LONG_EDGE,
} from '../constants.js';
import { clampDimension } from './formatters.js';

export function fullCropRect(imageData) {
  return { x: 0, y: 0, width: imageData.width, height: imageData.height };
}

export function clampCropRect(rect, imageData) {
  const width = Math.max(1, Math.min(Math.round(rect.width), imageData.width));
  const height = Math.max(1, Math.min(Math.round(rect.height), imageData.height));
  const x = Math.max(0, Math.min(Math.round(rect.x), imageData.width - width));
  const y = Math.max(0, Math.min(Math.round(rect.y), imageData.height - height));
  return { x, y, width, height };
}

export function maxCornerRadiusForRect(rect) {
  return Math.max(0, Math.floor(Math.min(rect.width, rect.height) / 2));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Estimate the stage background from the FOUR CORNERS, not an all-edges strip.
// A centered subject (e.g. a tall phone) often touches the top/bottom (or left/
// right) edges, which would pollute an edge-strip average and make the whole
// frame read as foreground. The corners are reliably margin for a centered
// subject; taking the per-channel MEDIAN across the four corner patches stays
// robust even if one or two corners are contaminated (a stray overlay/dot).
function sampleBackgroundColor(imageData) {
  const { data, width, height } = imageData;
  const patch = Math.max(4, Math.floor(Math.min(width, height) / 40));
  const origins = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  const cornerColors = [];
  for (const [ox, oy] of origins) {
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = oy; y < oy + patch; y += 1) {
      for (let x = ox; x < ox + patch; x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 16) continue;
        r += data[offset];
        g += data[offset + 1];
        b += data[offset + 2];
        count += 1;
      }
    }
    if (count) cornerColors.push([r / count, g / count, b / count]);
  }
  if (!cornerColors.length) return [0, 0, 0];
  return [0, 1, 2].map((c) => median(cornerColors.map((col) => col[c])));
}

function isBackgroundLike(data, offset, background) {
  if (data[offset + 3] < 16) return true;
  const dr = data[offset] - background[0];
  const dg = data[offset + 1] - background[1];
  const db = data[offset + 2] - background[2];
  return dr * dr + dg * dg + db * db <= 300;
}

export function detectForegroundBounds(imageData) {
  const { data, width, height } = imageData;
  const background = sampleBackgroundColor(imageData);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;

  const tryEnqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (visited[index]) return;
    const offset = index * 4;
    if (!isBackgroundLike(data, offset, background)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    tryEnqueue(x, 0);
    tryEnqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    tryEnqueue(0, y);
    tryEnqueue(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    tryEnqueue(x + 1, y);
    tryEnqueue(x - 1, y);
    tryEnqueue(x, y + 1);
    tryEnqueue(x, y - 1);
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (visited[index]) continue;
      const offset = index * 4;
      if (data[offset + 3] < 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return null;
  const padding = 1;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const areaRatio = (cropWidth * cropHeight) / (width * height);
  if (areaRatio < 0.08 || areaRatio > 0.98) return null;
  return { x: minX, y: minY, width: cropWidth, height: cropHeight };
}

export function cropImageData(imageData, rect) {
  if (
    !rect ||
    (rect.x === 0 && rect.y === 0 && rect.width === imageData.width && rect.height === imageData.height)
  ) {
    return imageData;
  }
  const cropped = new ImageData(rect.width, rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * imageData.width + rect.x) * 4;
    const sourceEnd = sourceStart + rect.width * 4;
    const targetStart = y * rect.width * 4;
    cropped.data.set(imageData.data.subarray(sourceStart, sourceEnd), targetStart);
  }
  return cropped;
}

export function resizeImageData(imageData, width, height) {
  if (imageData.width === width && imageData.height === height) return imageData;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  sourceCanvas.getContext('2d').putImageData(imageData, 0, 0);
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = width;
  targetCanvas.height = height;
  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

// Scale so the LONG edge (max of width/height) hits the requested target,
// orientation-independent (portrait and landscape both scale). The target is
// clamped to the absolute ceiling MAX_GIF_LONG_EDGE and never upscaled past the
// source. Aspect ratio is preserved.
export function exportDimensionsFor(imageData, targetLongEdge) {
  const srcLong = Math.max(imageData.width, imageData.height);
  const target = Math.min(srcLong, clampDimension(targetLongEdge, 1, MAX_GIF_LONG_EDGE));
  const scale = target / srcLong;
  return {
    width: Math.max(1, Math.round(imageData.width * scale)),
    height: Math.max(1, Math.round(imageData.height * scale)),
  };
}

export function applyCornerRadius(imageData, radiusValue) {
  const radius = Math.min(
    Math.max(0, Math.round(radiusValue)),
    Math.floor(Math.min(imageData.width, imageData.height) / 2),
  );
  if (radius < 1) return imageData;
  const rounded = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const { data, width, height } = rounded;
  const radiusEdge = radius - 0.5;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = x < radius;
      const right = x >= width - radius;
      const top = y < radius;
      const bottom = y >= height - radius;
      if (!(left || right) || !(top || bottom)) continue;
      const centerX = left ? radiusEdge : width - radius - 0.5;
      const centerY = top ? radiusEdge : height - radius - 0.5;
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radiusEdge) continue;
      const offset = (y * width + x) * 4;
      const coverage = Math.max(0, 1 - (distance - radiusEdge));
      data[offset + 3] = Math.round(data[offset + 3] * coverage);
    }
  }
  return rounded;
}

function colorLuma([r, g, b]) {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function sampleCornerColor(imageData, corner) {
  const { data, width, height } = imageData;
  const size = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) / 12)));
  const startX = corner.includes('e') ? width - size : 0;
  const startY = corner.includes('s') ? height - size : 0;
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = startY; y < startY + size; y += 1) {
    for (let x = startX; x < startX + size; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 16) continue;
      r += data[offset];
      g += data[offset + 1];
      b += data[offset + 2];
      count += 1;
    }
  }
  return count ? [r / count, g / count, b / count] : null;
}

function isColorNear(data, offset, color, maxDelta = EDGE_MATTE_COLOR_DELTA) {
  const dr = data[offset] - color[0];
  const dg = data[offset + 1] - color[1];
  const db = data[offset + 2] - color[2];
  return dr * dr + dg * dg + db * db <= maxDelta;
}

export function makeLightCornerMatteTransparent(imageData, referenceImageData, cornerRadius = 0) {
  const transparent = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  const { data, width, height } = transparent;
  // The matte only ever cleans the light pixels inside the rounded-corner boxes.
  // Bounding the flood-fill to a radius×radius box per corner is essential:
  // unbounded, it walks along any connected light region and erases an entire
  // light background — exactly the "video loses the background" failure when a
  // full-frame clip of a light UI has light corners connected to the whole frame.
  // With no corner radius there is no matte to clean, so do nothing.
  const radius = Math.min(
    Math.max(0, Math.round(cornerRadius)),
    Math.floor(Math.min(width, height) / 2),
  );
  if (radius < 1) return transparent;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const corners = [
    { name: 'nw', x: 0, y: 0, minX: 0, maxX: radius, minY: 0, maxY: radius },
    { name: 'ne', x: width - 1, y: 0, minX: width - radius, maxX: width, minY: 0, maxY: radius },
    { name: 'sw', x: 0, y: height - 1, minX: 0, maxX: radius, minY: height - radius, maxY: height },
    { name: 'se', x: width - 1, y: height - 1, minX: width - radius, maxX: width, minY: height - radius, maxY: height },
  ];

  function removeConnectedMatte(corner, color) {
    let head = 0, tail = 0;
    const tryEnqueue = (x, y) => {
      if (x < corner.minX || y < corner.minY || x >= corner.maxX || y >= corner.maxY) return;
      const index = y * width + x;
      if (visited[index]) return;
      const offset = index * 4;
      if (data[offset + 3] >= 16 && !isColorNear(data, offset, color)) return;
      visited[index] = 1;
      queue[tail] = index;
      tail += 1;
    };
    tryEnqueue(corner.x, corner.y);
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const offset = index * 4;
      data[offset + 3] = 0;
      tryEnqueue(x + 1, y);
      tryEnqueue(x - 1, y);
      tryEnqueue(x, y + 1);
      tryEnqueue(x, y - 1);
    }
  }

  for (const corner of corners) {
    const color = sampleCornerColor(referenceImageData, corner.name);
    if (!color || colorLuma(color) < EDGE_MATTE_MIN_LUMA) continue;
    removeConnectedMatte(corner, color);
  }
  return transparent;
}

export function processFrameImageData(imageData, cropRect, cornerRadius) {
  const rect = cropRect ?? fullCropRect(imageData);
  const cropped = cropImageData(imageData, rect);
  const rounded = applyCornerRadius(cropped, cornerRadius);
  return makeLightCornerMatteTransparent(rounded, cropped, cornerRadius);
}

export function exportReadyImageData(imageData, cropRect, cornerRadius, gifLongEdge) {
  const processed = processFrameImageData(imageData, cropRect, cornerRadius);
  const { width, height } = exportDimensionsFor(processed, gifLongEdge);
  return resizeImageData(processed, width, height);
}

export function makeThumbnailDataUrl(imageData) {
  const targetWidth = 88;
  const height = Math.max(1, Math.round(targetWidth * (imageData.height / imageData.width)));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = imageData.width;
  sourceCanvas.height = imageData.height;
  sourceCanvas.getContext('2d').putImageData(imageData, 0, 0);
  const thumb = document.createElement('canvas');
  thumb.width = targetWidth;
  thumb.height = height;
  const ctx = thumb.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, 0, 0, targetWidth, height);
  return thumb.toDataURL('image/jpeg', 0.68);
}
