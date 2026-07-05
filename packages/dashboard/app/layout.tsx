import "./globals.css";
import type { ReactNode } from "react";
import { NavLinks } from "./_components/NavLinks";
import { PushToggle } from "./_components/PushToggle";
import { LogoMark } from "./lib/agents";

export const metadata = {
  title: "LoopWorks",
  description: "기획(호재) → 개발(태경·민재·주희·성민·연한) → 검증(주호·동환·유준·성호) → 커밋",
  // 홈 화면 설치(PWA) 시 사파리 크롬 없이 standalone으로 — manifest.ts와 짝.
  appleWebApp: { capable: true, title: "LoopWorks", statusBarStyle: "black" as const },
  // ?v= 은 사파리의 사이트 아이콘 캐시 무력화용 — 아이콘 그림을 바꿀 때마다
  // 올려야 기존 방문자에게도 새 아이콘이 보인다.
  icons: { apple: "/icons/apple-touch-icon.png?v=2" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12141c",
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
            <PushToggle />
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
