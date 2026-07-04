import { orchProxy } from "../../../../lib/orch";

export const dynamic = "force-dynamic";

// 제안함 — 승인 대기 중인 에이전트 교훈 목록.
export async function GET() {
  return orchProxy("/data/learning/proposals");
}
