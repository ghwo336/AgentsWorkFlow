"use client";

import { usePathname } from "next/navigation";

// 전역 네비 — 앱의 최상위 섹션 전부를 한 줄에. 예전엔 상단(영어 Projects/
// History/Usage)과 홈 안 탭(프로젝트/리서치/팀)으로 갈려 있었는데, 같은 급의
// 목적지를 두 바에 나눠 담아 헷갈렸다. 이제 5개 모두 진짜 라우트 + 한 바.
const SECTIONS = [
  { href: "/", label: "📁 프로젝트", match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/research", label: "🔍 리서치", match: (p: string) => p.startsWith("/research") },
  { href: "/team", label: "👋 팀", match: (p: string) => p.startsWith("/team") },
  { href: "/history", label: "🗂 히스토리", match: (p: string) => p.startsWith("/history") },
  { href: "/usage", label: "📊 사용량", match: (p: string) => p.startsWith("/usage") },
] as const;

export function NavLinks() {
  const pathname = usePathname() ?? "/";
  return (
    <div className="nav-links">
      {SECTIONS.map((s) => {
        const active = s.match(pathname);
        return (
          <a
            key={s.href}
            href={s.href}
            className={`nav-link${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            {s.label}
          </a>
        );
      })}
    </div>
  );
}
