import "./globals.css";
import type { ReactNode } from "react";
import { LogoMark } from "./lib/agents";

export const metadata = {
  title: "Agent Loop",
  description: "기획(호재) → 개발(태경·민재·주희·성민·연한) → 검증(주호·동환·유준·성호) → 커밋",
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
          <a href="/" className="logo" style={{ color: "var(--text)" }}>
            <LogoMark size={26} />
            <b>Agent Loop</b>
          </a>
          <a href="/">Projects</a>
          <a href="/history">History</a>
          <a href="/usage">Usage</a>
          <span className="muted small pixel" style={{ marginLeft: "auto" }}>
            기획 1 · 개발 5 · 검증 4
          </span>
        </nav>
        {children}
      </body>
    </html>
  );
}
