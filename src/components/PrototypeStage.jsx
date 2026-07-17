import { forwardRef } from 'react';

const PrototypeStage = forwardRef(function PrototypeStage(
  { embedUrl, hidden, onLoad },
  ref,
) {
  return (
    <iframe
      ref={ref}
      id="prototypeFrame"
      title="Figma prototype"
      src={embedUrl || undefined}
      allowFullScreen
      allow="fullscreen"
      referrerPolicy="strict-origin-when-cross-origin"
      hidden={hidden}
      onLoad={onLoad}
    />
  );
});

export default PrototypeStage;
