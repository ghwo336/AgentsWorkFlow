"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared markdown renderer. Agents (Opus/Sonnet) reply in markdown, so anywhere
// we show their prose — the requirements chat, plans, summaries — we render it
// instead of dumping the raw source. Styling lives under `.md` in globals.css.
// Links open in a new tab; everything else is plain GFM.
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `md ${className}` : "md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
