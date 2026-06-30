export const ORCHESTRATOR_URL =
  (process.env.ORCH_INTERNAL_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

