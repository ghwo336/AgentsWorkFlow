import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RunStore } from "./run-store.js";

// 워크스페이스 경로 정책 — "이 run이 어느 폴더에서 작업하는가"의 규칙 전부.
// Precedence: explicit targetDir → per-run named workspace → project's
// remembered default → the project's own folder (agent-workspaces/<project>).
// In the last case we persist it as the project default so every run in the
// project lands in — and accumulates within — one folder, with no path input.

// Reduce a user-supplied workspace name to a safe single folder name — drop any
// path separators (no escaping workspacesDir) and leading dots, keep it tidy.
function sanitizeWorkspaceName(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? "";
  return base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "");
}

// A readable, filesystem-safe folder name from a project name — but Unicode-
// friendly (keeps Korean etc.), unlike sanitizeWorkspaceName. Only strips path
// separators / control / illegal chars and leading dots so "투두리스트" stays
// "투두리스트". Returns "" if nothing usable is left (caller falls back).
function projectDirName(project: string): string {
  const base = project.trim().split(/[\\/]/).pop() ?? "";
  return base
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .trim();
}

// Resolve (and create) the working directory for a new run.
export async function resolveTargetDir(args: {
  store: RunStore;
  workspacesDir: string;
  project: string;
  runId: string; // last-resort folder name when the project name is unusable
  targetDir?: string;
  workspaceName?: string;
}): Promise<string> {
  const named = args.workspaceName ? sanitizeWorkspaceName(args.workspaceName) : "";
  let targetDir = args.targetDir?.trim() || "";
  if (!targetDir && named) targetDir = join(args.workspacesDir, named);
  if (!targetDir) targetDir = (await args.store.getProjectDefaultDir(args.project)) || "";
  if (!targetDir) {
    targetDir = join(args.workspacesDir, projectDirName(args.project) || args.runId);
    await args.store.setProjectDefaultDir(args.project, targetDir); // remember it for next time
  }
  await mkdir(targetDir, { recursive: true });
  return targetDir;
}
