import { formatBytes } from '../lib/formatters.js';

// Shown over the stage after a successful export. The encoded GIF is rendered
// in a plain <img>, which decodes and loops natively (we encode with
// repeat:0 = infinite loop) — so the user previews the real artifact in-app,
// exactly as it will look when downloaded, without opening the file elsewhere.
// Sits below the floating control panel (z-index), which keeps "Back to
// editing" / "Download" reachable.
export default function GifResultPreview({ url, sizeBytes, hidden }) {
  if (hidden || !url) return null;
  return (
    <div className="gif-result-preview">
      <span className="gif-result-badge">
        GIF preview · loops automatically{sizeBytes ? ` · ${formatBytes(sizeBytes)}` : ''}
      </span>
      <img
        className="gif-result-image"
        src={url}
        alt="Exported GIF — looping preview"
        draggable={false}
      />
    </div>
  );
}
