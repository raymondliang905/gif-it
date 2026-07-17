export default function BrowserWarning({ message }) {
  if (!message) return null;
  return (
    <div className="browser-warning" role="status">
      {message}
    </div>
  );
}
