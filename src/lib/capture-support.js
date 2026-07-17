export function isSafariBrowser() {
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor;
  return (
    /Safari/i.test(userAgent) &&
    /Apple/i.test(vendor) &&
    !/Chrome|CriOS|Chromium|Edg|OPR|Firefox|FxiOS/i.test(userAgent)
  );
}

export function captureSupportMessage() {
  if (isSafariBrowser()) {
    return 'Recording is not supported in Safari. Open this tool in Chrome or Edge to capture a tab/window.';
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return 'Recording needs Chrome or Edge with screen capture support. Open this localhost URL in a regular browser to record.';
  }
  if (window.isSecureContext === false) {
    return 'Recording needs a secure browser context. Use localhost in Chrome or Edge to record.';
  }
  return '';
}

export function canStartCapture() {
  return !captureSupportMessage();
}

export function captureBrowserHint() {
  return `Open ${window.location.origin}${window.location.pathname} in Chrome or Edge to record.`;
}

export function captureErrorMessage(error) {
  const hint = captureBrowserHint();
  const recoverable = new Set(['AbortError', 'NotAllowedError', 'NotFoundError', 'SecurityError']);
  if (recoverable.has(error?.name)) {
    return `Screen capture did not start. ${hint}`;
  }
  return error?.message ? `${error.message} ${hint}` : `Capture was cancelled. ${hint}`;
}
