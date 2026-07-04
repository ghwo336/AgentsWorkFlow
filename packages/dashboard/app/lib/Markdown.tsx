"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Agent/LLM output is untrusted markdown — only let links through on schemes
// that can't execute script (javascript:, data:, vnd… are rendered as text).
// Relative paths and #fragments have no scheme and pass as-is.
const SAFE_SCHEME = /^(https?|mailto|tel):/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  if (!HAS_SCHEME.test(href)) return href; // relative / #anchor / query
  return SAFE_SCHEME.test(href) ? href : undefined;
}

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
          a: ({ href, children }) => {
            const url = safeHref(href);
            return url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
