export const DEFAULT_STAGE_SIZE = 900;
export const MIN_STAGE_SIZE = 240;
export const MAX_STAGE_SIZE = 1920;
export const MIN_GIF_WIDTH = 120;
export const MAX_GIF_WIDTH = 1440;
// Safety ceiling on the LONG edge of any exported GIF. Preserves the resolution
// of typical prototypes/recordings (which sit under this) while bounding the
// per-frame buffer for tall portrait sources so batch gifski stays within a tab.
export const MAX_GIF_LONG_EDGE = 1440;
export const CAPTURE_WARMUP_MS = 450;
export const CAPTURE_WARMUP_FRAMES = 4;
export const MIN_FRAME_DURATION_MS = 20;
export const MAX_DUPLICATE_COMPARE_SAMPLES = 16000;
export const DUPLICATE_AVERAGE_DELTA = 0.3;
export const DUPLICATE_CHANGED_DELTA = 3;
export const DUPLICATE_CHANGED_RATIO = 0.0005;
export const EDGE_MATTE_MIN_LUMA = 180;
export const EDGE_MATTE_COLOR_DELTA = 3600;
export const TRIM_TRACK_INSET = 4;
export const MAX_TIMELINE_THUMBS = 18;
export const DEFAULT_QUALITY_PRESET = 'best';
export const DEFAULT_CORNER_RADIUS = 24;
export const DEFAULT_HEAD_TRIM_MS = 1000;
export const DEFAULT_TAIL_TRIM_MS = 1000;

// "Upload video" (file input + drag-drop) is temporarily disabled — its export
// path is producing broken GIFs and needs more debugging. Screen recording is
// unaffected by this flag: its completion handler passes fromTabRecorder=true,
// which bypasses the gate in App.jsx's handleVideoFile.
export const UPLOAD_VIDEO_ENABLED = false;

// fps           — prototype recording / GIF fps for screen-capture mode
// maxFps        — max fps for video-file mode (source fps is capped at this)
// quality       — gifski quality 0–100 (100 = lossy OFF, max fidelity, largest +
//                 slowest; 80 enables lossy LZW for smaller, faster output)
// maxGifLongEdge — requested output LONG edge (max of width/height) for both
//                 modes; orientation-independent so portrait and landscape both
//                 scale. Capped to MAX_GIF_LONG_EDGE and never upscaled.
//
// `best` is the no-compromise tier: native resolution (1440 long edge — typical
// prototypes sit under it) at quality 100, matching the gifski Mac app's "max".
// `balanced`/`small` trade resolution + lossy quality + fps for smaller, lighter
// files. For tall sources the video memory budget reduces fps rather than failing.
export const QUALITY_PRESETS = {
  small:    { fps: 15, maxFps: 50, quality: 80, maxGifLongEdge: 800  },
  balanced: { fps: 24, maxFps: 50, quality: 80, maxGifLongEdge: 1024 },
  best:     { fps: 24, maxFps: 50, quality: 100, maxGifLongEdge: 1440 },
};

export function presetFor(name) {
  return QUALITY_PRESETS[name] ?? QUALITY_PRESETS[DEFAULT_QUALITY_PRESET];
}
