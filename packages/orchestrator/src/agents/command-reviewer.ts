import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Reviewer, VerifyRequest, VerifyResult } from "./types.js";

const pexec = promisify(exec);

// A test-runner reviewer: runs a shell command in the working copy and passes
// iff it exits 0. It's homomorphic to a code reviewer (inspects the built
// change, returns pass/fail) so it joins the same fan-out as codex — appearing
// as its own parallel node in the graph. No model, no cost.
export class CommandReviewer implements Reviewer {
  readonly kind = "test" as const;
  readonly engine = "system";
  readonly model = "-";
  constructor(
    readonly name: string,
    private readonly command: string
  ) {}

  async review(req: VerifyRequest): Promise<VerifyResult> {
    try {
      const { stdout, stderr } = await pexec(this.command, {
        cwd: req.cwd,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      });
      const tail = lastLines(stdout || stderr, 20);
      return {
        passed: true,
        reason: `테스트 통과 — \`${this.command}\` (exit 0).${tail ? `\n${tail}` : ""}`,
        raw: stdout,
      };
    } catch (err: any) {
      const out = String(err?.stdout ?? "");
      const errOut = String(err?.stderr ?? err?.message ?? err);
      return {
        passed: false,
        reason: `테스트 실패 — \`${this.command}\`:\n${lastLines(errOut || out, 30)}`,
        raw: `${out}\n${errOut}`,
      };
    }
  }
}

function lastLines(s: string, n: number): string {
  const lines = s.trimEnd().split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}
