import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { agentEnv } from "./gate-env.js";
import { learnedBlock, researchHistoryBlock, splitResearchLessons } from "./research-shared.js";
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
    // Third-party binary running model-controlled work — never hand it our
    // secrets (ORCH_TOKEN 등). agentEnv keeps everything else (HOME의 auth 포함).
    const child = spawn(bin, args, { cwd: opts.cwd, env: agentEnv(), stdio: ["ignore", "pipe", "pipe"] });
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

// stdout의 {"text": ..., "sessionId": ...} JSON에서 최종 답과 세션 id를 꺼낸다.
// CLI가 계약을 어기면(비-JSON 출력) 원문을 답으로 쓴다 — 보고서를 잃는 것보다
// 낫다. sessionId는 토큰 사용량 추정(세션 파일)에만 쓰이므로 없어도 동작한다.
export function parseGrokJson(stdout: string): { text: string; sessionId: string | null } {
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed?.text === "string" && parsed.text.trim()) {
      return {
        text: parsed.text.trim(),
        sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : null,
      };
    }
  } catch {
    /* not json — fall through */
  }
  return { text: stdout.trim(), sessionId: null };
}

// Grok CLI는 토큰 사용량을 출력하지 않는다 — 대신 세션 파일
// (~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/signals.json)의
// contextTokensUsed(대화 종료 시점의 컨텍스트 토큰 총량, X 검색 결과 포함)를
// 읽어 총량으로 삼고, 출력분은 보고서 문자수로 추정해 입력/출력을 가른다.
// 세션 파일이 없거나 포맷이 바뀌면 문자수 추정으로 폴백 — usage가 아예
// 비는 것보다 근사치가 낫다 (기록 시 추정치임을 모델명 주석으로 문서화).
export async function estimateGrokUsage(args: {
  cwd: string;
  sessionId: string | null;
  promptChars: number; // rules + prompt (영문 위주 → ~4자/토큰)
  outputChars: number; // 보고서 (한국어 위주 → ~3자/토큰)
}): Promise<{ inputTokens: number; outputTokens: number }> {
  const outputTokens = Math.ceil(args.outputChars / 3);
  const promptTokens = Math.ceil(args.promptChars / 4);
  if (args.sessionId) {
    try {
      const signalsPath = join(
        homedir(),
        ".grok",
        "sessions",
        encodeURIComponent(args.cwd),
        args.sessionId,
        "signals.json"
      );
      const signals = JSON.parse(await readFile(signalsPath, "utf8"));
      const total = Number(signals?.contextTokensUsed);
      if (Number.isFinite(total) && total > 0) {
        return { inputTokens: Math.max(total - outputTokens, promptTokens), outputTokens };
      }
    } catch {
      /* 세션 파일 없음/포맷 변경 — 문자수 폴백 */
    }
  }
  return { inputTokens: promptTokens, outputTokens };
}

export class GrokResearcher implements Researcher {
  constructor(
    private readonly bin: string, // grok 바이너리 절대 경로 (launchd PATH에 없다)
    private readonly harness?: string
  ) {}

  async research(req: ResearchRequest, reporter: PhaseReporter): Promise<ResearchResult> {
    const prompt = [
      learnedBlock(req.learned),
      researchHistoryBlock(req.history),
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
      const { text, sessionId } = parseGrokJson(stdout);
      if (!text) return { text: "", isError: true, lessons: [] };
      // 사용량 기록 — 추정치라도 남긴다 (안 남기면 usage 뷰에서 grok이 투명인간).
      // step 핸들 아래에서 호출되므로 agent(상현) 귀속은 reporter가 스탬프한다.
      const usage = await estimateGrokUsage({
        cwd: req.cwd,
        sessionId,
        promptChars: rules.length + prompt.length,
        outputChars: text.length,
      });
      await reporter.usage({
        engine: "grok",
        model: "grok-4",
        phase: "research",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheRead: 0,
        cacheWrite: 0,
      });
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
