import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function ensureRepo(cwd: string): Promise<void> {
  if (await isRepo(cwd)) return;
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
