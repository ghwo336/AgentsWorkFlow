// Collapsible, syntax-colored unified diff (client component).
"use client";

import { useState } from "react";

export function DiffView({ diff }: { diff: string }) {
  const [open, setOpen] = useState(false);
  const lines = diff.split("\n");
  return (
    <div style={{ marginTop: 6 }}>
      <button className="ghost small" onClick={() => setOpen((o) => !o)}>
        {open ? "▾ hide diff" : `▸ show diff (${lines.length} lines)`}
      </button>
      {open && (
        <pre className="diff">
          {lines.map((l, i) => (
            <div
              key={i}
              className={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : ""}
            >
              {l || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
