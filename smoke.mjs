// End-to-end smoke test. Reads state directly from the DB (no dashboard
// dependency); only POSTs start/approve to the orchestrator on :4000.
import { PrismaClient } from "@prisma/client";

const ORCH = "http://localhost:4000";
const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const start = await fetch(`${ORCH}/runs`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "smoke: hello file",
    brief:
      "Create a file named hello.txt whose contents are exactly the single line: Hello from agent-loop",
    targetDir: "/Users/Shared/srv/agent-loop/workspaces/smoke-" + process.pid,
  }),
});
const { id } = await start.json();
console.log("started run", id);

let approved = false;
for (let i = 0; i < 100; i++) {
  await sleep(3000);
  const run = await prisma.run.findUnique({ where: { id }, include: { verdicts: true } });
  console.log(`[${i}] status=${run.status}`);
  if (run.status === "awaiting_approval" && !approved) {
    await fetch(`${ORCH}/runs/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    approved = true;
    console.log("approved ✓");
  }
  if (["committed", "rejected", "failed", "cancelled"].includes(run.status)) {
    console.log("=== TERMINAL:", run.status, "commit:", run.commit, "===");
    for (const v of run.verdicts)
      console.log(`  verdict#${v.attempt}: ${v.passed ? "PASS" : "FAIL"} - ${v.reason.slice(0, 200)}`);
    await prisma.$disconnect();
    process.exit(0);
  }
}
console.log("TIMED OUT");
await prisma.$disconnect();
process.exit(1);
