import { PrismaClient } from "@prisma/client";

// Single Prisma client reused across hot-reloads (dashboard) and the
// long-lived orchestrator process.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
