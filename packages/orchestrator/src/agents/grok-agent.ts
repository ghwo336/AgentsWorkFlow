import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learnedBlock, splitResearchLessons } from "./claude-agent.js";
import type { PhaseReporter } from "../reporter.js";
import type { Researcher, ResearchRequest, ResearchResult } from "./types.js";

// Grok 리서처(상현) — xAI Grok Build CLI를 헤드리스로 spawn한다. 인증은 사용자의
// X Premium+/SuperGrok 구독 OAuth(~/.grok/auth.json, grok login) — API 과금 없음.
// 존재 이유는 search_x: X(트위터) 내부는 로그인월이라 Claude의 웹 검색으로는 못
// 보는데, Grok은 실시간 X 포스트를 직접 검색한다. 그래서 상현의 전문은 X다.
//
// CLI 계약 (스모크 테스트로 확인, grok 0.2.x):
// - `--output-format json -p <prompt>` → stdout에 {"text": 최종 답, ...} 단일 JSON.
// - 프롬프트는 --prompt-file로 넘긴다 — 후속 질문 스레드가 길어지면 argv 한계
//   (codex에서 E2BIG로 한 번 당했다)에 걸릴 수 있어서.
// - `--always-approve` 없이는 헤드리스에서 툴(search_x 등)이 승인 대기로 죽는다.
// - `--effort/--reasoning-effort`는 기본 모델이 거부한다 — 지정하지 않는다.
// - 프롬프트에 툴 이름(search_x)을 직접 쓰면 MCP 네임스페이스를 헤매므로
//   "X에서 검색해"처럼 자연어로 시킨다.

const GROK_RULES = `You are an X (Twitter) RESEARCH agent (리서처) in an agent team.
Your specialty is X: real-time posts, community sentiment, announcements from
project/dev accounts. Investigate the question by SEARCHING X first (and the web
to cross-check); never answer from memory alone. You never modify code or files.

Method:
- Search X from multiple angles (keywords, accounts, tickers/hashtags); note WHO
  said it — verify the account is official/first-party before trusting claims.
- Distinguish announced facts from community rumor/speculation, explicitly.
- Cross-check claims that drive the conclusion against the web (official docs,
  reputable media) — X moves fast and is often wrong.
- 못 찾은 것은 못 찾았다고 쓴다. 수치를 지어내지 않는다.

Report (markdown, in Korean): 1) **요약** 3~5문장 → 2) 본문(소제목, 근거 인용 —
핸들 @xxx 표기) → 3) **출처** (포스트/URL 목록). Write ALL prose in Korean;
keep handles, tickers, technical terms, URLs as-is.

Self-improvement (optional): if this investigation taught you a durable lesson
about HOW to research X (source-quality or method — never world knowledge),
append after the report:
\`\`\`lessons
[{"condition": "언제 적용되는가", "lesson": "...", "evidence": "이번 조사의 어떤 경험에서"}]
\`\`\``;

function runGrok(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxBuffer: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        settle(() => {
          child.kill("SIGKILL");
          reject(Object.assign(new Error("grok timed out"), { stdout, stderr }));
        }),
      opts.timeoutMs
    );
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > opts.maxBuffer)
        settle(() => {
          child.kill("SIGKILL");
          reject(Object.assign(new Error("grok output exceeded maxBuffer"), { stdout, stderr }));
        });
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => settle(() => reject(err)));
    child.on("close", (code) =>
      settle(() =>
        code === 0
          ? resolve({ stdout, stderr })
          : reject(Object.assign(new Error(`grok exited with code ${code}`), { stdout, stderr }))
      )
    );
  });
}

// stdout의 {"text": ...} JSON에서 최종 답을 꺼낸다. CLI가 계약을 어기면(비-JSON
// 출력) 원문을 그대로 쓴다 — 보고서를 잃는 것보다 낫다.
export function parseGrokJson(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed?.text === "string" && parsed.text.trim()) return parsed.text.trim();
  } catch {
    /* not json — fall through */
  }
  return stdout.trim();
}

export class GrokResearcher implements Researcher {
  constructor(
    private readonly bin: string, // grok 바이너리 절대 경로 (launchd PATH에 없다)
    private readonly harness?: string
  ) {}

  async research(req: ResearchRequest, reporter: PhaseReporter): Promise<ResearchResult> {
    const historyBlock = req.history?.length
      ? [
          `# 지금까지의 리서치 대화 (맥락 — 이미 답한 내용은 반복하지 말 것)`,
          ...req.history
            .slice(-8)
            .map((t) => `${t.role === "user" ? "[질문]" : "[이전 보고서]"}\n${t.text.slice(0, 4000)}`),
        ].join("\n\n")
      : "";
    const prompt = [
      learnedBlock(req.learned),
      historyBlock,
      req.history?.length ? `# 후속 질문` : `# 리서치 질문`,
      req.question,
      ``,
      `X(트위터)를 중심으로 조사해서 위 질문에 답하는 보고서를 작성하세요.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const rules = this.harness ? `${GROK_RULES}\n\n=== 상현의 개인 하네스 ===\n${this.harness}` : GROK_RULES;

    const tmp = await mkdtemp(join(tmpdir(), "agentloop-grok-"));
    const promptPath = join(tmp, "prompt.md");
    try {
      await writeFile(promptPath, prompt, "utf8");
      await reporter.log("research", "🔧 Grok(search_x)으로 X 실시간 검색 중…", { model: "grok" });
      const { stdout } = await runGrok(
        this.bin,
        [
          "--always-approve",
          "--output-format",
          "json",
          "--rules",
          rules,
          "--prompt-file",
          promptPath,
        ],
        { cwd: req.cwd, timeoutMs: 15 * 60_000, maxBuffer: 10 * 1024 * 1024 }
      );
      const text = parseGrokJson(stdout);
      if (!text) return { text: "", isError: true, lessons: [] };
      const { report, lessons } = splitResearchLessons(text);
      return { text: report, isError: false, lessons };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await reporter.log("research", `Grok 실행 실패: ${msg.slice(0, 300)}`, {
        level: "error",
        model: "grok",
      });
      return { text: "", isError: true, lessons: [] };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
