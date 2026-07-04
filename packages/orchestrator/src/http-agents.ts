import type { FastifyInstance } from "fastify";
import { loadAllHarnesses } from "./agents/harness.js";
import { listPendingProposals, loadAllLearned, resolveProposal } from "./agents/learn-store.js";

// Agent-roster API — file-backed (agents-config/*.md), unlike http-data.ts
// which owns the SQLite reads. The dashboard's 팀 소개 modal shows each
// teammate's harness verbatim, so editing an md file updates the intro too.
// 같은 원칙으로 learned/(팀 학습 노트)도 파일 원문을 그대로 내보낸다.
export function registerAgentRoutes(app: FastifyInstance): void {
  // agentId → harness markdown. Agents without a file are simply absent.
  app.get("/data/agents/harnesses", async () => loadAllHarnesses());

  // 팀 학습 노트 원문 — { projects: 프로젝트명 → md, agents: agentId → md }.
  app.get("/data/agents/learned", async () => loadAllLearned());

  // 제안함: 승인 대기 중인 에이전트 교훈 목록.
  app.get("/data/learning/proposals", async () => listPendingProposals());

  // 제안 결정 — approve는 해당 에이전트의 learned 파일에 편입, reject는 기록만.
  app.post("/data/learning/proposals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const action = (req.body as { action?: string } | null)?.action;
    if (action !== "approve" && action !== "reject") {
      return reply.code(400).send({ error: "action은 approve 또는 reject여야 합니다." });
    }
    if (!resolveProposal(id, action)) {
      return reply.code(404).send({ error: "대기 중인 제안이 없습니다." });
    }
    return { ok: true };
  });
}
