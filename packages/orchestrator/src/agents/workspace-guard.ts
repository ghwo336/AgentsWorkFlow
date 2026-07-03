import { isAbsolute, relative, resolve } from "node:path";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// ── Workspace confinement ────────────────────────────────────────────────────
// Agents run with a cwd of their assigned workspace, but the tools (Bash/Write)
// can reach anywhere on disk. Without a guard, an agent handed an EMPTY
// workspace will happily wander up to a real repo it finds and edit THAT
// instead. This module keeps every file write / command inside the workspace.
//
// The Bash screen is a PATTERN check on the command string, not an OS sandbox —
// a determined command can still slip through (subshells, encodings). It closes
// the common escape routes: parent-dir traversal, home refs, and absolute paths
// outside the workspace. True containment would need a real sandbox. Pure
// helpers (isInside/bashEscape) are exported for unit tests — this is a
// security boundary, so regressions must be caught by tests, not incident.

export function isInside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// ".." as a PATH (cd .., ../x, a/../..) — but not git ranges (A..B) or "1..5",
// which have a non-delimiter char before the dots.
const PARENT_TRAVERSAL = /(^|[\s'"`=(:;|&<>])\.\.($|[/\s'"`);|&<>])|\/\.\.($|[/\s'"`);|&<>])/;
// Home refs: ~/x, bare "cd ~", $HOME/${HOME} — but not git's HEAD~1 (preceded
// by a word char).
const HOME_REF = /(^|[\s'"`=(:;|&<>])~($|[/\s'"`);|&<>])|\$\{?HOME\b/;
// Absolute-path tokens (skipping URL "//host" forms). Checked against the
// workspace + a small allowlist of EXECUTABLE/system prefixes. Deliberately NO
// writable locations (/tmp 등) — a shared temp dir is a side-channel for moving
// data out of (or scripts into) the workspace; temp files belong in ./.tmp.
const ABS_TOKEN = /(?:^|[\s'"`=(:;|&<>])(\/(?!\/)[A-Za-z0-9._\-/]+)/g;
const ALLOWED_ABS_PREFIXES = ["/usr", "/bin", "/sbin", "/opt/homebrew", "/dev/null", "/System"];

// Returns a short Korean reason when the command escapes the workspace, else null.
export function bashEscape(root: string, cmd: string): string | null {
  if (PARENT_TRAVERSAL.test(cmd)) return "상위 디렉터리 참조(..)";
  if (HOME_REF.test(cmd)) return "홈 디렉터리 참조(~/$HOME)";
  for (const m of cmd.matchAll(ABS_TOKEN)) {
    const p = m[1];
    if (isInside(root, resolve(p))) continue;
    if (ALLOWED_ABS_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))) continue;
    return `작업 폴더 밖 절대 경로(${p})`;
  }
  return null;
}

// A canUseTool handler that denies any file operation or command reaching
// outside `targetDir`. Paths inside are auto-approved (no human in the loop).
export function workspaceGuard(targetDir: string): CanUseTool {
  const root = resolve(targetDir);
  const deny = (message: string): PermissionResult => ({ behavior: "deny", message });
  return async (toolName, input) => {
    const pathArg =
      (input.file_path as string) ??
      (input.notebook_path as string) ??
      (input.path as string) ??
      "";
    if (typeof pathArg === "string" && pathArg) {
      const abs = isAbsolute(pathArg) ? pathArg : resolve(root, pathArg);
      if (!isInside(root, abs)) {
        return deny(
          `작업 디렉터리(${root}) 밖의 경로는 사용할 수 없습니다: ${pathArg}. 작업은 반드시 이 폴더 안에서만 하세요.`
        );
      }
    }
    if (toolName === "Bash" && typeof input.command === "string") {
      const escape = bashEscape(root, input.command as string);
      if (escape) {
        return deny(
          `${escape}가 포함된 명령은 허용되지 않습니다. 모든 작업은 작업 디렉터리(${root}) 안에서 상대 경로로만 하고, 임시 파일은 ./.tmp 폴더를 쓰세요.`
        );
      }
    }
    // MUST echo the (unchanged) input back as updatedInput. The SDK's permission
    // control-protocol validates the allow response and REJECTS a missing
    // updatedInput with "expected record, received undefined" — which surfaces to
    // the agent as "ZodError: Tool permission request failed" and blocks EVERY
    // Write/Edit/Bash, so nothing ever gets built.
    return { behavior: "allow", updatedInput: input };
  };
}
