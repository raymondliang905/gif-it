import { useCallback, useRef } from 'react';

export function useEncoder() {
  const workerRef = useRef(null);

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  const encode = useCallback((options, callbacks) => {
    cancel();
    const worker = new Worker(new URL('../lib/encoder-worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'status') {
        callbacks.onStatus?.(message.message);
      } else if (message.type === 'progress') {
        callbacks.onProgress?.(message.progress);
      } else if (message.type === 'done') {
        callbacks.onDone?.(message.bytes, message.encoder);
        if (workerRef.current === worker) {
          worker.terminate();
          workerRef.current = null;
        }
      } else if (message.type === 'error') {
        callbacks.onError?.(message.message);
        if (workerRef.current === worker) {
          worker.terminate();
          workerRef.current = null;
        }
      }
    };

    worker.onerror = (event) => {
      callbacks.onError?.(event.message || 'Encoding failed.');
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onmessageerror = () => {
      callbacks.onError?.('Could not pass frames to the GIF encoder.');
      if (workerRef.current === worker) {
        worker.terminate();
        workerRef.current = null;
      }
    };

    try {
      // Transfer (move) each frame's backing ArrayBuffer to the worker instead
      // of structured-cloning it. This frees the main-thread copy immediately,
      // roughly halving peak memory during encode. The prepared frames are
      // export-only and regenerated from the raw recording on every export, so
      // detaching them here is safe. Dedupe buffers — a duplicated final frame
      // (gifski needs ≥2) can share one ArrayBuffer, and a buffer may only
      // appear once in the transfer list.
      const transfer = [];
      const seen = new Set();
      if (Array.isArray(options.frames)) {
        for (const frame of options.frames) {
          const buffer = frame?.data?.buffer ?? frame?.buffer;
          if (buffer && !seen.has(buffer)) {
            seen.add(buffer);
            transfer.push(buffer);
          }
        }
      }
      worker.postMessage({ type: 'encode', options }, transfer);
    } catch (error) {
      callbacks.onError?.(error.message || 'Could not start GIF export.');
      worker.terminate();
      workerRef.current = null;
    }
  }, [cancel]);

  const isEncoding = useCallback(() => Boolean(workerRef.current), []);

  return { encode, cancel, isEncoding };
}
