import {
  DEFAULT_CORNER_RADIUS,
  DEFAULT_QUALITY_PRESET,
  DEFAULT_STAGE_SIZE,
  presetFor,
} from '../constants.js';

export function initialState() {
  const preset = presetFor(DEFAULT_QUALITY_PRESET);
  return {
    source: {
      type: 'none',                       // 'none' | 'prototype' | 'video'
      embedUrl: '',
      embedCandidates: [],
      embedAttempt: 0,
      input: '',                          // current text shown in URL inputs
      // For type === 'video' only — file stays as the source-of-truth;
      // frames are not pre-extracted. Set null otherwise.
      video: null,                        // { file, objectUrl, duration, width, height, nativeWidth, nativeHeight }
    },
    loading: {
      prototype: false,
      video: false,
      videoDetail: '',
    },
    stage: {
      view: 'prototype',                  // 'prototype' | 'preview'
      width: DEFAULT_STAGE_SIZE,
      height: DEFAULT_STAGE_SIZE,
      hasManualSize: false,
      hasManualGifWidth: false,
    },
    quality: {
      preset: DEFAULT_QUALITY_PRESET,
      fps: preset.fps,
      quality: preset.quality,
      gifLongEdge: preset.maxGifLongEdge,
      cornerRadius: DEFAULT_CORNER_RADIUS,
      autoCrop: true,
    },
    recording: {
      isRecording: false,
      hasCapturedTakeThisSession: false,
      durationSeconds: 0,
    },
    frames: [],                           // [{ imageData, capturedAt }]
    trim: { start: 0, end: 0, displayed: 0 },
    crop: { rect: null },
    encoding: { isEncoding: false, progress: 0, status: '', indeterminate: false },
    output: { url: '', sizeBytes: 0 },
    status: 'Ready',
    drawerOpen: false,
    dragDropActive: false,
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.status };

    case 'SET_INPUT':
      return { ...state, source: { ...state.source, input: action.value } };

    case 'SET_PROTOTYPE_LOADING':
      return { ...state, loading: { ...state.loading, prototype: action.loading } };

    case 'SET_VIDEO_LOADING':
      return {
        ...state,
        loading: { ...state.loading, video: action.loading, videoDetail: action.detail ?? '' },
      };

    case 'LOAD_PROTOTYPE':
      return {
        ...state,
        source: {
          type: 'prototype',
          embedUrl: action.embedUrl,
          embedCandidates: action.candidates,
          embedAttempt: action.attempt,
          input: action.input,
        },
        stage: { ...state.stage, view: 'prototype' },
      };

    case 'NEXT_EMBED_ATTEMPT': {
      const next = (state.source.embedAttempt + 1) % state.source.embedCandidates.length;
      return {
        ...state,
        source: {
          ...state.source,
          embedAttempt: next,
          embedUrl: action.embedUrl,
        },
      };
    }

    case 'LOAD_VIDEO_FRAMES':
      return {
        ...state,
        source: { ...state.source, type: 'video', embedUrl: '', embedCandidates: [], video: null },
        frames: action.frames,
        stage: {
          ...state.stage,
          view: 'preview',
          width: action.dimensions.width,
          height: action.dimensions.height,
        },
        recording: {
          ...state.recording,
          durationSeconds: action.durationSeconds,
          hasCapturedTakeThisSession: action.frames.length > 0,
        },
        crop: { rect: null },
      };

    // New Gifski-style video load: keep the source file, don't pre-extract.
    // Trim is in MILLISECONDS (start/end/displayed) for video sources.
    case 'LOAD_VIDEO_SOURCE': {
      const v = action.video;
      return {
        ...state,
        source: {
          ...state.source,
          type: 'video',
          fromTabRecorder: Boolean(action.fromTabRecorder),
          embedUrl: '',
          embedCandidates: [],
          input: '',
          video: v,
        },
        frames: [],
        stage: {
          ...state.stage,
          view: 'preview',
          width: v.width,
          height: v.height,
          hasManualSize: true,
        },
        recording: {
          ...state.recording,
          durationSeconds: v.duration,
          hasCapturedTakeThisSession: true,
        },
        trim: {
          start: 0,
          end: Math.round(v.duration * 1000),
          displayed: 0,
        },
        // Seed a full-frame crop so the crop box + corner-radius handle render
        // (CropOverlay no-ops on a null rect). Coordinate space is the fitted
        // preview size (v.width/v.height), matching GifPreviewStage/CropOverlay.
        crop: { rect: { x: 0, y: 0, width: v.width, height: v.height } },
        output: { url: '', sizeBytes: 0 },
      };
    }

    case 'SET_STAGE_VIEW':
      return { ...state, stage: { ...state.stage, view: action.view } };

    case 'SET_STAGE_SIZE':
      return {
        ...state,
        stage: {
          ...state.stage,
          width: action.width,
          height: action.height,
          hasManualSize: action.manual ?? state.stage.hasManualSize,
        },
      };

    case 'SET_QUALITY_PRESET': {
      const preset = presetFor(action.preset);
      return {
        ...state,
        quality: {
          ...state.quality,
          preset: action.preset,
          fps: preset.fps,
          quality: preset.quality,
          gifLongEdge: state.stage.hasManualGifWidth ? state.quality.gifLongEdge : preset.maxGifLongEdge,
        },
      };
    }

    case 'SET_QUALITY_FIELD':
      return { ...state, quality: { ...state.quality, [action.field]: action.value } };

    case 'START_RECORDING':
      return {
        ...state,
        recording: { ...state.recording, isRecording: true, durationSeconds: 0 },
        frames: [],
        output: { url: '', sizeBytes: 0 },
        drawerOpen: false,
      };

    case 'APPEND_FRAME':
      return {
        ...state,
        frames: [...state.frames, action.frame],
        recording: { ...state.recording, durationSeconds: action.durationSeconds },
      };

    case 'STOP_RECORDING':
      return {
        ...state,
        recording: {
          ...state.recording,
          isRecording: false,
          hasCapturedTakeThisSession: state.frames.length > 0,
          durationSeconds: action.durationSeconds ?? state.recording.durationSeconds,
        },
        stage: { ...state.stage, view: 'preview' },
      };

    case 'SET_TRIM':
      return {
        ...state,
        trim: {
          start: action.start,
          end: action.end,
          displayed: action.displayed ?? state.trim.displayed,
        },
      };

    case 'SET_DISPLAYED_FRAME':
      return { ...state, trim: { ...state.trim, displayed: action.index } };

    case 'SET_CROP_RECT':
      return { ...state, crop: { rect: action.rect } };

    case 'SET_ENCODING':
      return {
        ...state,
        encoding: {
          isEncoding: action.isEncoding,
          progress: action.progress ?? state.encoding.progress,
          status: action.status ?? state.encoding.status,
          indeterminate: action.indeterminate ?? state.encoding.indeterminate,
        },
      };

    case 'SET_ENCODING_PROGRESS':
      return { ...state, encoding: { ...state.encoding, progress: action.progress } };

    case 'SET_OUTPUT':
      return {
        ...state,
        output: { url: action.url, sizeBytes: action.sizeBytes },
        encoding: { isEncoding: false, progress: 100, status: '', indeterminate: false },
      };

    case 'CLEAR_OUTPUT':
      return { ...state, output: { url: '', sizeBytes: 0 } };

    case 'CLEAR_TAKE':
      return {
        ...state,
        frames: [],
        trim: { start: 0, end: 0, displayed: 0 },
        crop: { rect: null },
        recording: { ...state.recording, durationSeconds: 0 },
        output: { url: '', sizeBytes: 0 },
        // Unlock stage so it can re-fit if the prior take was a video upload.
        stage: { ...state.stage, hasManualSize: false },
      };

    case 'RESET_SOURCE':
      return {
        ...state,
        source: { type: 'none', embedUrl: '', embedCandidates: [], embedAttempt: 0, input: '', video: null },
        frames: [],
        trim: { start: 0, end: 0, displayed: 0 },
        crop: { rect: null },
        recording: { isRecording: false, hasCapturedTakeThisSession: false, durationSeconds: 0 },
        output: { url: '', sizeBytes: 0 },
        // Clear hasManualSize so the workspace-fit effect re-runs and
        // resizes the stage from any prior video aspect ratio back to default.
        stage: { ...state.stage, view: 'prototype', hasManualSize: false },
      };

    case 'SET_DRAWER':
      return { ...state, drawerOpen: action.open };

    case 'SET_DRAG_DROP':
      return { ...state, dragDropActive: action.active };

    default:
      return state;
  }
}
