import type { FastifyInstance } from "fastify";
import { loadAllHarnesses } from "./agents/harness.js";

// Agent-roster API — file-backed (agents-config/*.md), unlike http-data.ts
// which owns the SQLite reads. The dashboard's 팀 소개 modal shows each
// teammate's harness verbatim, so editing an md file updates the intro too.
export function registerAgentRoutes(app: FastifyInstance): void {
  // agentId → harness markdown. Agents without a file are simply absent.
  app.get("/data/agents/harnesses", async () => loadAllHarnesses());
}
