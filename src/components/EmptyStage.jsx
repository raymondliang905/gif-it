import { useEffect, useState } from 'react';

export default function EmptyStage({
  inputValue,
  loading,
  videoLoading,
  onInputChange,
  onInputPaste,
  onSubmitUrl,
  onVideoFile,
  onRecordTab,
  dragDropActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}) {
  const [localValue, setLocalValue] = useState(inputValue);

  useEffect(() => setLocalValue(inputValue), [inputValue]);

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (file) onVideoFile(file);
  };

  return (
    <div className="stage-empty">
      <form
        className="empty-prototype-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitUrl(localValue);
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <img className="landing-logo" src={`${import.meta.env.BASE_URL}assets/gifit-logo.svg`} alt="GIFit" draggable={false} />

        <section className="prototype-source" aria-label="Figma prototype source">
          <div className="empty-copy">
            <strong>Paste a Figma prototype link</strong>
            <span>Share link, embed code, or published Make URL</span>
          </div>
          <label className="field prototype-url-field">
            <span className="visually-hidden">Figma URL</span>
            <input
              type="text"
              value={localValue}
              onChange={(event) => {
                setLocalValue(event.target.value);
                onInputChange(event.target.value);
              }}
              onPaste={(event) => onInputPaste(event, { autoLoad: true })}
              placeholder="https://www.figma.com/proto/... or https://name.figma.site"
              autoComplete="off"
              required
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={loading || videoLoading}
          >
            {loading ? 'Loading...' : 'Load prototype'}
          </button>
        </section>

        <div className="sources-divider" aria-hidden="true"><span>Or</span></div>

        <div className="alt-sources">
          <label className={`source-button${dragDropActive ? ' is-drag-target' : ''}`} aria-label="Upload video file">
            <input
              type="file"
              accept="video/*,.mov,.mp4,.webm"
              onChange={handleFile}
              disabled={videoLoading}
            />
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path fillRule="evenodd" clipRule="evenodd" d="M12.5303 1.46967C12.2374 1.17678 11.7626 1.17678 11.4697 1.46967L7.46967 5.46967C7.17678 5.76256 7.17678 6.23744 7.46967 6.53033C7.76256 6.82322 8.23744 6.82322 8.53033 6.53033L11.25 3.81066V15C11.25 15.4142 11.5858 15.75 12 15.75C12.4142 15.75 12.75 15.4142 12.75 15V3.81066L15.4697 6.53033C15.7626 6.82322 16.2374 6.82322 16.5303 6.53033C16.8232 6.23744 16.8232 5.76256 16.5303 5.46967L12.5303 1.46967ZM3.75 14C3.75 13.5858 3.41421 13.25 3 13.25C2.58579 13.25 2.25 13.5858 2.25 14V18C2.25 19.7949 3.70507 21.25 5.5 21.25H18.5C20.2949 21.25 21.75 19.7949 21.75 18V14C21.75 13.5858 21.4142 13.25 21 13.25C20.5858 13.25 20.25 13.5858 20.25 14V18C20.25 18.9665 19.4665 19.75 18.5 19.75H5.5C4.5335 19.75 3.75 18.9665 3.75 18V14Z" fill="currentColor" />
            </svg>
            Upload video
          </label>
          <button
            type="button"
            className="source-button"
            onClick={onRecordTab}
            disabled={loading || videoLoading}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="10" cy="10" r="8.5" stroke="currentColor" />
              <circle cx="10" cy="10" r="5" fill="currentColor" />
            </svg>
            Record screen
          </button>
        </div>
      </form>
    </div>
  );
}
