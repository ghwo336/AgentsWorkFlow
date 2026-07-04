"use client";

import { useEffect } from "react";

// Subscribe to the orchestrator's Server-Sent Events stream.
//
// The connection is opened only AFTER the window `load` event: a long-lived
// EventSource opened during initial render pins the page's load lifecycle,
// leaving the browser tab spinner running forever (and delaying first paint).
//
// `onEvent` must be stable (wrap it in useCallback) or the subscription will
// tear down and reopen on every render.
export function useOrchestratorEvents(onEvent: (m: MessageEvent) => void) {
  useEffect(() => {
    let es: EventSource | null = null;
    const open = () => {
      es = new EventSource("/api/orch/events");
      es.onmessage = onEvent;
    };
    if (document.readyState === "complete") open();
    else window.addEventListener("load", open, { once: true });
    return () => {
      es?.close();
      window.removeEventListener("load", open);
    };
  }, [onEvent]);
}
