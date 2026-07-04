import { orchProxy } from "../../../../lib/orch";

export const dynamic = "force-dynamic";

// Agent harness md files (agentId → markdown) — for the 팀 소개 modal.
export async function GET() {
  return orchProxy("/data/agents/harnesses");
}
