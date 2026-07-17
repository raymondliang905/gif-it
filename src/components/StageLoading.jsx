export default function StageLoading({ title, detail, hidden }) {
  if (hidden) return null;
  return (
    <div className="stage-loading" role="status" aria-live="polite">
      <span className="stage-spinner" aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
