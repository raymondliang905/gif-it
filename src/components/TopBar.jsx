import OpenSourceNotice from './OpenSourceNotice.jsx';

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
  return (
    <header className="topbar" role="banner">
      <p className="status-text visually-hidden" aria-live="polite">
        {status}
      </p>
      <button
        type="button"
        className="brand-button"
        onClick={onHome}
        disabled={isBusy}
        aria-label="Go to GIFit start screen"
      >
        <img src={`${import.meta.env.BASE_URL}assets/gifit-logo.svg`} alt="GIFit" draggable="false" />
      </button>

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
            <span className={`recording-timer${recordingSeconds >= 15 ? ' is-over' : ''}`}>
              {Math.floor(recordingSeconds)}s
            </span>
            <span className="shortcut-tip">
              Keep under <strong>15s</strong>
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

        {hasPrototype && !isRecording && !hasCapturedTake && (
          <span className="shortcut-tip">
            Press <kbd>R</kbd> to reset interaction
          </span>
        )}

        {!isRecording && (
          <button
            type="button"
            onClick={onHome}
            disabled={isBusy}
          >
            Menu
          </button>
        )}

        <OpenSourceNotice />
      </div>
    </header>
  );
}
