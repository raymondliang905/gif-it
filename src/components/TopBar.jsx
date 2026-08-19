import { useEffect, useState } from 'react';

import OpenSourceNotice from './OpenSourceNotice.jsx';

const RECORDING_TIPS = [
  { key: 'R', copy: 'to replay from the start' },
  { key: 'Z', copy: 'to use Fill screen for sharper captures' },
];

function RecordingTip({ tip }) {
  return (
    <span className="hint-tip-copy">
      Press <kbd className="hint-kbd">{tip.key}</kbd> {tip.copy}
    </span>
  );
}

export default function TopBar({
  status,
  hasPrototype,
  isVideoSource,
  isTabRecording,
  isRecording,
  recordingSeconds = 0,
  isBusy,
  hasCapturedTake,
  canRecord,
  onRecord,
  onStop,
  onHome,
  onReRecord,
}) {
  const [tipIndex, setTipIndex] = useState(0);
  const shouldRotateTips = hasPrototype && !isRecording && !hasCapturedTake;

  useEffect(() => {
    setTipIndex(0);
    if (!shouldRotateTips) return undefined;

    const interval = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % RECORDING_TIPS.length);
    }, 4000);
    return () => window.clearInterval(interval);
  }, [shouldRotateTips]);

  return (
    <header className="topbar" role="banner">
      <p className="status-text visually-hidden" aria-live="polite">
        {status}
      </p>
      <div className="brand-cluster">
        <button
          type="button"
          className="brand-button"
          onClick={onHome}
          disabled={isBusy}
          aria-label="Go to GIFit start screen"
        >
          <img src={`${import.meta.env.BASE_URL}assets/gifit-logo.svg`} alt="GIFit" draggable="false" />
        </button>
        {!isRecording && (
          <button
            type="button"
            className="ghost-button home-button"
            onClick={onHome}
            disabled={isBusy}
          >
            Home
          </button>
        )}
      </div>

      <div className="viewer-actions">
        {!isRecording && !isVideoSource && (
          <button
            id="recordButton"
            type="button"
            className="danger-button"
            onClick={onRecord}
            disabled={!hasPrototype || !canRecord}
          >
            {hasCapturedTake ? 'Re-record' : 'Record'}
          </button>
        )}
        {isRecording && (
          <>
            <button id="stopButton" type="button" onClick={onStop}>
              Stop
            </button>
            <span
              className={`recording-pill${recordingSeconds >= 15 ? ' is-over' : ''}`}
              title="Keep recordings under 15s"
            >
              <span className="recording-dot" aria-hidden="true" />
              {Math.floor(recordingSeconds)}s
            </span>
          </>
        )}

        {isTabRecording && !isRecording && (
          <button
            type="button"
            className="danger-button"
            onClick={onReRecord}
            disabled={isBusy}
          >
            Re-record
          </button>
        )}

        {hasPrototype && (isRecording || !hasCapturedTake) && (
          <span className="hint-tip">
            {isRecording ? (
              <RecordingTip tip={RECORDING_TIPS[0]} />
            ) : (
              <span className="hint-tip-viewport">
                <span
                  className="hint-tip-track"
                  style={{ '--hint-tip-index': tipIndex }}
                >
                  {RECORDING_TIPS.map((tip, index) => (
                    <span key={tip.key} aria-hidden={index !== tipIndex}>
                      <RecordingTip tip={tip} />
                    </span>
                  ))}
                </span>
              </span>
            )}
          </span>
        )}
      </div>

      <div className="utility-actions">
        <OpenSourceNotice />
      </div>
    </header>
  );
}
