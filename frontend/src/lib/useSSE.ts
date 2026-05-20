import { useEffect, useRef } from "react";

type Handlers = Record<string, (data: unknown) => void>;

export function useSSE(url: string, handlers: Handlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const es = new EventSource(url);
    const wrapped: { type: string; fn: (e: MessageEvent) => void }[] = [];

    const types = Object.keys(ref.current);
    for (const type of types) {
      const handler = (e: MessageEvent) => {
        try {
          ref.current[type]?.(JSON.parse(e.data));
        } catch {
          ref.current[type]?.(e.data);
        }
      };
      es.addEventListener(type, handler);
      wrapped.push({ type, fn: handler });
    }

    return () => {
      for (const { type, fn } of wrapped) {
        es.removeEventListener(type, fn);
      }
      es.close();
    };
  }, [url]);
}
