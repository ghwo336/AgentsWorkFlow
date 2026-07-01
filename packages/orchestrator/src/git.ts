import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const pexec = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

// True only when `cwd` is the ROOT of its own git repo — not merely somewhere
// inside a parent repo's work tree. This distinction is critical: workspaces
// live under ./workspaces which is itself inside the agent-loop repo, so a naive
// "is inside a work tree?" check would report true and skip isolation, letting
// `git add -A` / `commit` operate on the whole parent repo.
export async function isRepoRoot(cwd: string): Promise<boolean> {
  try {
    const top = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return (await realpath(top)) === (await realpath(cwd));
  } catch {
    return false;
  }
}

export async function ensureRepo(cwd: string): Promise<void> {
  // Already its own repo root (e.g. a user-supplied target repo) → leave as-is.
  if (await isRepoRoot(cwd)) return;
  // Otherwise give this run an ISOLATED repo, even when the directory sits
  // inside a parent repo's work tree. `git init` here makes commits/diffs scope
  // to this workspace only.
  await runGit(cwd, ["init"]);
  // Make sure there's an identity so commits don't fail in fresh envs.
  await runGit(cwd, ["config", "user.name", "agent-loop"]).catch(() => {});
  await runGit(cwd, ["config", "user.email", "agent-loop@local"]).catch(() => {});
}

// Diff of uncommitted work (staged + unstaged + untracked), same surface codex reviews.
export async function uncommittedDiff(cwd: string): Promise<string> {
  await runGit(cwd, ["add", "-A"]); // stage so untracked files show in the diff
  return runGit(cwd, ["diff", "--cached"]);
}

export async function hasChanges(cwd: string): Promise<boolean> {
  const out = await runGit(cwd, ["status", "--porcelain"]);
  return out.trim().length > 0;
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  await runGit(cwd, ["add", "-A"]);
  await runGit(cwd, ["commit", "-m", message]);
  const sha = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
  return sha;
}

// Abstraction the pipeline depends on, so the VCS implementation can be swapped
// (or stubbed in tests) without touching the orchestration logic (DIP).
export interface GitOps {
  ensureRepo(cwd: string): Promise<void>;
  uncommittedDiff(cwd: string): Promise<string>;
  hasChanges(cwd: string): Promise<boolean>;
  commitAll(cwd: string, message: string): Promise<string>;
}

export const git: GitOps = { ensureRepo, uncommittedDiff, hasChanges, commitAll };
