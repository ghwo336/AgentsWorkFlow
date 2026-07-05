import "./globals.css";
import type { ReactNode } from "react";
import { NavLinks } from "./_components/NavLinks";
import { LogoMark } from "./lib/agents";

export const metadata = {
  title: "LoopWorks",
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
          <div className="nav-inner">
            <a href="/" className="logo" style={{ color: "var(--text)" }}>
              <LogoMark size={26} />
              <b>LoopWorks</b>
            </a>
            <NavLinks />
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
