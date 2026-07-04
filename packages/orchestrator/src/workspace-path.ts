import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { RunStore } from "./run-store.js";

// 워크스페이스 경로 정책 — "이 run이 어느 폴더에서 작업하는가"의 규칙 전부.
// Precedence: explicit targetDir → per-run named workspace → project's
// remembered default → the project's own folder (agent-workspaces/<project>).
// In the last case we persist it as the project default so every run in the
// project lands in — and accumulates within — one folder, with no path input.
//
// A user-supplied targetDir is ALSO a security boundary: the workspace guard
// treats the resolved dir as the run's safe root, so an unchecked path would
// hand the agents write access to anywhere on disk. Explicit dirs must resolve
// (symlinks included) inside an allowlisted root — config.allowedTargetRoots.

// Raised for a disallowed explicit targetDir; the HTTP layer maps it to a 400.
export class TargetDirError extends Error {}

function isUnder(child: string, root: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Resolve a path with symlinks flattened, tolerating not-yet-existing suffixes:
// realpath the deepest existing ancestor, then re-append the remainder. This is
// what defeats `targetDir: <workspace>/link-to-home/...` style escapes.
async function realResolve(path: string): Promise<string> {
  let dir = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    try {
      return join(await realpath(dir), ...suffix.reverse());
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return resolve(path); // hit the fs root — nothing existed
      suffix.push(basename(dir));
      dir = parent;
    }
  }
}

// Explicit/remembered dirs must land inside one of the allowlisted roots.
// Exported for the HTTP boundary's early validation and for tests.
export async function assertAllowedTargetDir(dir: string, roots: string[]): Promise<string> {
  const real = await realResolve(dir);
  const resolvedRoots = await Promise.all(roots.map((r) => realResolve(r)));
  if (!resolvedRoots.some((root) => isUnder(real, root))) {
    throw new TargetDirError(
      `허용되지 않은 작업 폴더입니다: ${dir} — 워크스페이스(${roots[0]}) 또는 저장소 스캔 경로 아래만 지정할 수 있습니다.`
    );
  }
  return real;
}

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
  allowedRoots: string[];
  project: string;
  runId: string; // last-resort folder name when the project name is unusable
  targetDir?: string;
  workspaceName?: string;
}): Promise<string> {
  const named = args.workspaceName ? sanitizeWorkspaceName(args.workspaceName) : "";
  let targetDir = args.targetDir?.trim() || "";
  if (targetDir) {
    // Explicit dir — the untrusted input. Throws TargetDirError when outside
    // the allowlist (the HTTP layer already pre-validates; this is the backstop).
    targetDir = await assertAllowedTargetDir(targetDir, args.allowedRoots);
  }
  if (!targetDir && named) targetDir = join(args.workspacesDir, named);
  if (!targetDir) {
    // A remembered default was itself user-supplied once — re-check it against
    // the CURRENT allowlist and fall through to a fresh folder if it no longer
    // passes (e.g. the allowlist tightened since it was stored).
    const remembered = (await args.store.getProjectDefaultDir(args.project)) || "";
    if (remembered) {
      targetDir = await assertAllowedTargetDir(remembered, args.allowedRoots).catch(() => "");
    }
  }
  if (!targetDir) {
    targetDir = join(args.workspacesDir, projectDirName(args.project) || args.runId);
    await args.store.setProjectDefaultDir(args.project, targetDir); // remember it for next time
  }
  await mkdir(targetDir, { recursive: true });
  return targetDir;
}
