import { useEffect, useRef, useState } from 'react';

// AGPL-3.0 compliance affordance. gifski (the GIF encoder) is AGPL-3.0, so the
// combined app is served under AGPL — §13 requires prominently offering the
// Corresponding Source of the running version to network users. This is the
// first-level visible entry point; the source offer + notices live one click in.
const APP_SOURCE_URL = 'https://github.com/raymondliang905/gif-it';
const GIFSKI_URL = 'https://github.com/ImageOptim/gifski';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

export default function OpenSourceNotice() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="oss-notice" ref={ref}>
      <button
        type="button"
        className="oss-notice-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Open source
      </button>
      {open && (
        <aside className="oss-notice-popover" role="dialog" aria-label="Open source licenses">
          <p className="oss-notice-line">
            GIF encoding by{' '}
            <a href={GIFSKI_URL} target="_blank" rel="noreferrer noopener">gifski</a>{' '}
            — © Kornel Lesiński &amp; contributors.
          </p>
          <p className="oss-notice-line">
            Licensed under the{' '}
            <a href={LICENSE_URL} target="_blank" rel="noreferrer noopener">GNU AGPL-3.0</a>.
            This program comes with no warranty.
          </p>
          <p className="oss-notice-line">
            <a href={APP_SOURCE_URL} target="_blank" rel="noreferrer noopener">
              Source code for this app
            </a>{' '}
            — offered under AGPL-3.0 §13.
          </p>
        </aside>
      )}
    </div>
  );
}
