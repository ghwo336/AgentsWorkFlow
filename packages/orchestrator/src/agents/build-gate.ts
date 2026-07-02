import { exec } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Reviewer, VerifyRequest, VerifyResult } from "./types.js";

const pexec = promisify(exec);

// The QA gate the LLM reviewers can't be: it actually RUNS the workspace's own
// build/typecheck instead of reading the diff. Static review kept missing
// runtime breakage (and burned rounds on compile errors a machine catches for
// free), so this reviewer joins the fan-out as a deterministic, zero-cost
// verdict. It auto-detects what the workspace supports:
//   1. package.json with a `build` script → `npm run build`
//   2. else tsconfig.json + a local typescript install → `npx tsc --noEmit`
//   3. else nothing to run → PASS (a vanilla HTML/JS project has no build)
export class BuildGateReviewer implements Reviewer {
  readonly name = "빌드";
  readonly kind = "test" as const;
  readonly engine = "system";
  readonly model = "-";

  async review(req: VerifyRequest): Promise<VerifyResult> {
    const cmd = await detectCommand(req.cwd);
    if (!cmd) {
      return {
        passed: true,
        reason: "빌드 스크립트/타입 설정이 없는 프로젝트라 빌드 검사를 생략합니다 (통과).",
        raw: "",
      };
    }
    try {
      const { stdout, stderr } = await pexec(cmd, {
        cwd: req.cwd,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      });
      const tail = lastLines(stdout || stderr, 15);
      return {
        passed: true,
        reason: `빌드 통과 — \`${cmd}\` (exit 0).${tail ? `\n${tail}` : ""}`,
        raw: stdout,
      };
    } catch (err: any) {
      const out = String(err?.stdout ?? "");
      const errOut = String(err?.stderr ?? err?.message ?? err);
      return {
        passed: false,
        reason: `빌드 실패 — \`${cmd}\`:\n${lastLines(errOut || out, 30)}`,
        raw: `${out}\n${errOut}`,
      };
    }
  }
}

async function detectCommand(cwd: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    if (pkg?.scripts?.build) return "npm run build";
  } catch {
    /* no package.json — fall through */
  }
  const hasTsconfig = await access(join(cwd, "tsconfig.json")).then(() => true, () => false);
  const hasLocalTsc = await access(join(cwd, "node_modules", "typescript")).then(() => true, () => false);
  if (hasTsconfig && hasLocalTsc) return "npx tsc --noEmit";
  return null;
}

function lastLines(s: string, n: number): string {
  const lines = s.trimEnd().split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}
