import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Agent Loop",
  description: "Plan (Opus) → Build (Sonnet) → Verify (codex) → Commit",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <a href="/" style={{ color: "var(--text)" }}>
            <b>🔁 Agent Loop</b>
          </a>
          <a href="/">Projects</a>
          <a href="/history">History</a>
          <a href="/usage">Usage</a>
          <span className="muted small" style={{ marginLeft: "auto" }}>
            Opus → Sonnet → codex → commit
          </span>
        </nav>
        {children}
      </body>
    </html>
  );
}
