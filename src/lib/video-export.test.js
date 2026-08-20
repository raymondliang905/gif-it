import { describe, expect, it } from 'vitest';

import { containedCropDrawRect } from './video-export.js';

function expectRectClose(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual[key]).toBeCloseTo(value, 6);
  }
}

describe('containedCropDrawRect', () => {
  it('maps the selected crop into a same-aspect decoded frame', () => {
    const result = containedCropDrawRect({
      frameWidth: 1920,
      frameHeight: 1080,
      viewportWidth: 960,
      viewportHeight: 540,
      cropRect: { x: 240, y: 90, width: 480, height: 360 },
      outputWidth: 960,
      outputHeight: 720,
    });

    expectRectClose(result, {
      sourceX: 480,
      sourceY: 180,
      sourceWidth: 960,
      sourceHeight: 720,
      destinationX: 0,
      destinationY: 0,
      destinationWidth: 960,
      destinationHeight: 720,
    });
  });

  it('recomputes source coordinates when later frame resolution changes', () => {
    const result = containedCropDrawRect({
      frameWidth: 1280,
      frameHeight: 720,
      viewportWidth: 960,
      viewportHeight: 540,
      cropRect: { x: 240, y: 90, width: 480, height: 360 },
      outputWidth: 960,
      outputHeight: 720,
    });

    expectRectClose(result, {
      sourceX: 320,
      sourceY: 120,
      sourceWidth: 640,
      sourceHeight: 480,
      destinationX: 0,
      destinationY: 0,
      destinationWidth: 960,
      destinationHeight: 720,
    });
  });

  it('preserves contain letterboxing when a later frame changes aspect ratio', () => {
    const result = containedCropDrawRect({
      frameWidth: 1440,
      frameHeight: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      cropRect: { x: 0, y: 0, width: 960, height: 1080 },
      outputWidth: 800,
      outputHeight: 900,
    });

    expectRectClose(result, {
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 720,
      sourceHeight: 1080,
      destinationX: 200,
      destinationY: 0,
      destinationWidth: 600,
      destinationHeight: 900,
    });
  });
});
