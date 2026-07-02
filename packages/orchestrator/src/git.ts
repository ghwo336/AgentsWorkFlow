import { execFile } from "node:child_process";
import { access, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);

// Baseline ignore rules for workspaces WE initialize. Builders scaffold projects
// and run installs before any .gitignore exists — without this, `git add -A`
// staged 1,191 node_modules files (a 37MB diff) on a real run, which nuked every
// reviewer (E2BIG / prompt-too-long) and bloated the DB. User-supplied repos are
// never touched (ensureRepo returns early for existing repo roots).
const BASELINE_GITIGNORE = `node_modules/
.next/
dist/
build/
out/
coverage/
.cache/
.turbo/
*.log
.DS_Store
.env
.env.*
!.env.example
`;

// Diff surface reviewers see: exclude machine-generated files that carry no
// review signal but massive byte counts. (node_modules is belt-and-braces for
// workspaces that staged junk before the baseline .gitignore existed.)
const DIFF_EXCLUDES = [
  ":(exclude)node_modules/**",
  ":(exclude)**/node_modules/**",
  ":(exclude)package-lock.json",
  ":(exclude)**/package-lock.json",
  ":(exclude)pnpm-lock.yaml",
  ":(exclude)**/pnpm-lock.yaml",
  ":(exclude)yarn.lock",
  ":(exclude)**/yarn.lock",
  ":(exclude)*.min.js",
  ":(exclude)*.min.css",
];

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
  // Seed ignore rules BEFORE any add -A can vacuum up node_modules and friends.
  const gi = join(cwd, ".gitignore");
  const exists = await access(gi).then(() => true, () => false);
  if (!exists) await writeFile(gi, BASELINE_GITIGNORE).catch(() => {});
}

// Diff of uncommitted work (staged + unstaged + untracked), same surface codex reviews.
export async function uncommittedDiff(cwd: string): Promise<string> {
  await runGit(cwd, ["add", "-A"]); // stage so untracked files show in the diff
  return runGit(cwd, ["diff", "--cached", "--", ".", ...DIFF_EXCLUDES]);
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

// Throw away all uncommitted work (revert tracked files to HEAD, delete
// untracked). Used when the user chooses to SKIP a stuck step so its failed
// attempt doesn't leak into the next step's diff. Tolerant of a repo with no
// commits yet (fresh workspace on step 1): reset --hard is a no-op there, clean
// still removes the scaffolded files.
export async function discardChanges(cwd: string): Promise<void> {
  await runGit(cwd, ["reset", "--hard"]).catch(() => {});
  await runGit(cwd, ["clean", "-fd"]).catch(() => {});
}

// Current commit sha, or "" if the repo has no commits yet.
export async function headSha(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "HEAD"])
    .then((s) => s.trim())
    .catch(() => "");
}

// Abstraction the pipeline depends on, so the VCS implementation can be swapped
// (or stubbed in tests) without touching the orchestration logic (DIP).
export interface GitOps {
  ensureRepo(cwd: string): Promise<void>;
  uncommittedDiff(cwd: string): Promise<string>;
  hasChanges(cwd: string): Promise<boolean>;
  commitAll(cwd: string, message: string): Promise<string>;
  discardChanges(cwd: string): Promise<void>;
  headSha(cwd: string): Promise<string>;
}

export const git: GitOps = {
  ensureRepo,
  uncommittedDiff,
  hasChanges,
  commitAll,
  discardChanges,
  headSha,
};
