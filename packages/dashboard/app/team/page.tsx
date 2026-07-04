import { TeamIntro } from "../_components/TeamIntro";

// 팀 소개 섹션 — 예전엔 홈 안 탭이었지만 이제 독립 라우트(/team)다.
export default function TeamPage() {
  return (
    <div className="wrap">
      <TeamIntro />
    </div>
  );
}
