"use client";

import { useState } from "react";

// Busy-state for a group of mutually-exclusive action buttons (approve/reject/
// revise, guide/commit/skip/abort). Tracks which action is in flight so every
// button can disable and the clicked one can show its spinner label; ignores
// re-entrant clicks. On FAILURE the group re-enables (so the user can retry);
// on success it stays busy — the panel is expected to unmount or re-seed when
// the new state arrives (status flip / revised plan), which is what makes the
// click feel registered instead of dead.
export function useBusyAction<K extends string>() {
  const [busy, setBusy] = useState<K | null>(null);

  async function run(kind: K, fn: () => void | Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } catch {
      setBusy(null);
    }
  }

  return { busy, run, reset: () => setBusy(null) };
}
