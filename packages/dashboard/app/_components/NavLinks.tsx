"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

// 전역 네비 — 앱의 최상위 섹션 전부를 한 줄에. 예전엔 상단(영어 Projects/
// History/Usage)과 홈 안 탭(프로젝트/리서치/팀)으로 갈려 있었는데, 같은 급의
// 목적지를 두 바에 나눠 담아 헷갈렸다. 이제 5개 모두 진짜 라우트 + 한 바.
// 아이콘/텍스트를 분리해 두면 모바일에서 세로 쌓기(아이콘 위·글자 아래)가 된다.
const SECTIONS = [
  { href: "/", icon: "📁", text: "프로젝트", match: (p: string) => p === "/" || p.startsWith("/projects") },
  { href: "/research", icon: "🔍", text: "리서치", match: (p: string) => p.startsWith("/research") },
  { href: "/team", icon: "👋", text: "팀", match: (p: string) => p.startsWith("/team") },
  { href: "/history", icon: "🗂", text: "히스토리", match: (p: string) => p.startsWith("/history") },
  { href: "/usage", icon: "📊", text: "사용량", match: (p: string) => p.startsWith("/usage") },
] as const;

// 제안함 배지 동기화용 이벤트 — TeamIntro가 승인/거절 직후 쏘면 배지가 다시
// 센다. (팀 탭은 소개 화면인데 제안함은 "처리 대기 큐"라, 탭 밖에서도 쌓인
// 게 보여야 승인 게이트가 병목이 안 된다.)
export const PROPOSALS_CHANGED = "proposals-changed";

export function NavLinks() {
  const pathname = usePathname() ?? "/";
  // 승인 대기 교훈 개수 — 팀 링크에 배지로. 실패는 조용히 0 (배지는 보조 정보).
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const refresh = () =>
      api.learningProposals().then((p) => setPending(p.length)).catch(() => {});
    refresh();
    window.addEventListener(PROPOSALS_CHANGED, refresh);
    return () => window.removeEventListener(PROPOSALS_CHANGED, refresh);
  }, [pathname]); // 라우트 이동 때도 다시 센다 — 회고가 새 제안을 쌓았을 수 있다.

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
            <span className="nav-ico" aria-hidden>{s.icon}</span>
            <span className="nav-text">{s.text}</span>
            {s.href === "/team" && pending > 0 && (
              <span className="nav-badge" aria-label={`승인 대기 교훈 ${pending}건`}>
                {pending}
              </span>
            )}
          </a>
        );
      })}
    </div>
  );
}
