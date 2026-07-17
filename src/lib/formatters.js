export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function clampDimension(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function numericValueOf(input, fallback) {
  if (input == null || input === '') return fallback;
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}
