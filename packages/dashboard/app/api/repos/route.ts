import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

// Roots to scan for git repos, ":"-separated. Defaults to the user's srv tree.
const ROOTS = (process.env.REPO_SCAN_ROOTS ?? "/Users/Shared/srv")
  .split(":")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_DEPTH = 3;
const SKIP = new Set(["node_modules", ".next", "dist", "build", ".cache", "workspaces"]);

// Depth-first walk that stops descending once it finds a repo (a dir with .git),
// so we return repo roots, not their internals. Hidden/build dirs are skipped.
async function scan(dir: string, depth: number, out: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable/nonexistent root — skip silently
  }

  if (entries.some((e) => e.name === ".git")) {
    out.add(dir);
    return;
  }
  if (depth >= MAX_DEPTH) return;

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    await scan(join(dir, e.name), depth + 1, out);
  }
}

// List git repos under the configured roots, for the repo picker.
export async function GET() {
  const out = new Set<string>();
  for (const root of ROOTS) await scan(root, 0, out);
  return Response.json([...out].sort());
}
