// Helpers to bring the user back to GIFit after a background tab recording.
// A page can't programmatically activate its own tab, so the best we can do is
// (1) a notification whose click focuses this tab, and (2) a tab-title cue.

export async function requestNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// Clicking a notification IS allowed to focus the originating tab — the closest
// thing to an automatic switch-back. Returns the Notification or null.
export function notifyRecordingDone({ title, body, onActivate } = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return null;
  try {
    const notification = new Notification(title, {
      body,
      tag: 'gifit-recording-done',
      renotify: true,
    });
    notification.onclick = () => {
      try { window.focus(); } catch {}
      notification.close();
      onActivate?.();
    };
    return notification;
  } catch {
    return null;
  }
}

// Tab cue: change the document title so the finished recording is obvious in
// the tab strip. Auto-restores once the user returns (tab becomes visible),
// and returns a manual restore() as well.
export function flashTabCue(text) {
  const original = document.title;
  document.title = text;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = original;
    document.removeEventListener('visibilitychange', onVisible);
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') restore();
  };
  document.addEventListener('visibilitychange', onVisible);
  return restore;
}
