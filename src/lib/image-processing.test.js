import { beforeAll, describe, expect, it } from 'vitest';

import { processFrameImageData } from './image-processing.js';

beforeAll(() => {
  globalThis.ImageData = class ImageData {
    constructor(dataOrWidth, widthOrHeight, height) {
      if (typeof dataOrWidth === 'number') {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
        return;
      }

      this.data = dataOrWidth;
      this.width = widthOrHeight;
      this.height = height;
    }
  };
});

function solidImage(width, height, value = 240) {
  const image = new ImageData(width, height);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  return image;
}

function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

describe('processFrameImageData', () => {
  it('uses the requested crop rectangle without color-based corner removal', () => {
    const source = solidImage(12, 12);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const offset = (y * source.width + x) * 4;
        source.data[offset] = x;
        source.data[offset + 1] = y;
      }
    }
    const result = processFrameImageData(
      source,
      { x: 2, y: 3, width: 8, height: 7 },
      3,
    );

    expect(result.width).toBe(8);
    expect(result.height).toBe(7);
    expect(result.data[(3 * result.width + 4) * 4]).toBe(6);
    expect(result.data[(3 * result.width + 4) * 4 + 1]).toBe(6);
    expect(alphaAt(result, 0, 0)).toBe(0);
    expect(alphaAt(result, 1, 1)).toBe(255);
    expect(alphaAt(result, 0, 3)).toBe(255);
    expect(alphaAt(result, 7, 3)).toBe(255);
    expect(alphaAt(result, 1, 5)).toBe(255);
  });

  it('preserves light screen pixels inside the rounded-corner curve', () => {
    const radius = 24;
    const source = solidImage(100, 200);
    const result = processFrameImageData(source, null, radius);

    let transparentBottomLeft = 0;
    for (let y = result.height - radius; y < result.height; y += 1) {
      for (let x = 0; x < radius; x += 1) {
        if (alphaAt(result, x, y) === 0) transparentBottomLeft += 1;
      }
    }

    expect(transparentBottomLeft).toBeGreaterThan(0);
    expect(transparentBottomLeft).toBeLessThan(radius * radius);
    expect(alphaAt(result, radius - 1, result.height - 2)).toBe(255);
  });
});
