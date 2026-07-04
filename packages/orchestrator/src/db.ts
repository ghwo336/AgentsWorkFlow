import { PrismaClient } from "@prisma/client";

// The Prisma client lives HERE, in the orchestrator — the DB is the
// orchestrator's alone. The dashboard never touches Prisma; it reads run state
// over HTTP/SSE. Keeping this out of @agent-loop/shared makes that boundary a
// compile-time fact (shared can't leak a DB handle to the dashboard) rather than
// a convention.
//
// Single client reused across the long-lived orchestrator process (and any
// hot-reload under tsx watch).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
