import { orchProxy } from "../../../../lib/orch";

export const dynamic = "force-dynamic";

// 팀 학습 노트 원문 ({projects, agents} → md) — 팀 소개 탭의 배운 것 표시용.
export async function GET() {
  return orchProxy("/data/agents/learned");
}
