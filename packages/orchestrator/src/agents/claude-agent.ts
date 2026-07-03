import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { withHarness } from "./harness.js";
import { assignSystem, parsePlanOutput, STEPS_SYSTEM, teamSystem } from "./plan-format.js";
import { workspaceGuard } from "./workspace-guard.js";
import type { PhaseReporter } from "../reporter.js";
import type {
  AgentResult,
  BuildRequest,
  Builder,
  InterveneRequest,
  PlanRequest,
  Planner,
  PlanResult,
} from "./types.js";

type ClaudePhase = "plan" | "build";

// A boundary reminder injected into the prompt (belt-and-braces with the
// workspace-guard, which enforces this): the workspace IS the project root; if
// empty, scaffold here — don't go find another repo to modify.
function workspaceRule(cwd: string): string {
  return [
    `# 작업 디렉터리 (엄수)`,
    `당신의 작업 폴더는 \`${cwd}\` 입니다.`,
    `- 모든 파일 생성/수정/명령은 반드시 이 폴더 안에서만 하세요.`,
    `- 상위 폴더로 나가거나 다른 프로젝트/저장소를 절대 건드리지 마세요.`,
    `- 임시 파일이 필요하면 /tmp가 아니라 이 폴더 안의 \`.tmp/\`를 만들어 쓰세요 (밖은 차단됩니다).`,
    `- 이 폴더가 비어 있으면 정상입니다 — 요청받은 것을 여기서 처음부터 새로 만드세요(scaffold).`,
    `- 바깥에 기존 저장소가 보여도 그것을 수정 대상으로 삼지 마세요.`,
  ].join("\n");
}

// Stream a Claude Agent SDK query, forwarding text + tool activity to the run
// timeline (via the reporter), and return the final assistant text.
async function runClaude(
  reporter: PhaseReporter,
  phase: ClaudePhase,
  model: string,
  prompt: string,
  opts: {
    cwd?: string;
    permissionMode: "plan" | "bypassPermissions" | "default" | "acceptEdits";
    systemPrompt?: string;
    disallowedTools?: string[];
    canUseTool?: CanUseTool;
  }
): Promise<AgentResult> {
  const label = phase === "plan" ? "opus" : "sonnet";
  let finalText = "";
  let isError = false;

  const response = query({
    prompt,
    options: {
      model,
      cwd: opts.cwd,
      permissionMode: opts.permissionMode,
      // Required by the SDK to actually bypass prompts in the build phase.
      ...(opts.permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(opts.canUseTool ? { canUseTool: opts.canUseTool } : {}),
      ...(opts.disallowedTools ? { disallowedTools: opts.disallowedTools } : {}),
      ...(opts.systemPrompt
        ? { systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt } }
        : {}),
    },
  });

  for await (const msg of response as AsyncIterable<any>) {
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text" && block.text.trim()) {
          finalText = block.text;
          await reporter.log(phase, block.text.trim(), { model: label });
        } else if (block.type === "tool_use") {
          const summary = summarizeTool(block.name, block.input);
          await reporter.log(phase, `🔧 ${summary}`, { model: label });
        }
      }
    } else if (msg.type === "result") {
      if (msg.subtype !== "success") {
        isError = true;
        await reporter.log(phase, `Claude 실행이 비정상 종료됨: ${msg.subtype}`, {
          level: "error",
          model: label,
        });
      }
      if (typeof msg.result === "string" && msg.result.trim()) {
        finalText = msg.result;
      }
      await recordClaudeUsage(reporter, phase, model, msg);
    }
  }

  return { text: finalText.trim(), isError };
}

// Pull token usage out of the SDK's final `result` message and persist it.
// Prefer per-model breakdown (`modelUsage`) so subagents on other models are
// attributed correctly; fall back to the aggregate `usage` keyed to the
// requested model.
async function recordClaudeUsage(
  reporter: PhaseReporter,
  phase: ClaudePhase,
  model: string,
  msg: any
): Promise<void> {
  const modelUsage = msg?.modelUsage;
  if (modelUsage && typeof modelUsage === "object") {
    for (const [m, u] of Object.entries<any>(modelUsage)) {
      await reporter.usage({
        engine: "claude",
        model: m,
        phase,
        inputTokens: num(u?.inputTokens),
        outputTokens: num(u?.outputTokens),
        cacheRead: num(u?.cacheReadInputTokens),
        cacheWrite: num(u?.cacheCreationInputTokens),
      });
    }
    return;
  }
  const u = msg?.usage;
  if (u && typeof u === "object") {
    await reporter.usage({
      engine: "claude",
      model,
      phase,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
    });
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function summarizeTool(name: string, input: any): string {
  switch (name) {
    case "Edit":
    case "Write":
      return `${name} ${input?.file_path ?? ""}`;
    case "Bash":
      return `Bash: ${(input?.command ?? "").slice(0, 120)}`;
    case "Read":
      return `Read ${input?.file_path ?? ""}`;
    default:
      return name;
  }
}

// General planning behavior only — the machine-readable output format (```steps
// / ```team blocks) lives in plan-format.ts next to its parser, so prompt and
// parser can't drift apart.
const PLAN_SYSTEM = `You are the PLANNING agent in an automated dev loop.
Produce a concrete, step-by-step implementation plan for the request.
Do NOT write code. Output the plan as clear markdown: goal, files to change,
steps, and risks. Be specific enough that a separate builder agent can execute
it without further questions.

CRITICAL: The ENTIRE plan MUST be in your final response message, inline. Do NOT
save the plan to a file, do NOT write it to ~/.claude/plans or anywhere else, and
do NOT just point to a file. The user reviews your message text directly to
approve — if the plan isn't in the message, they see nothing. You may READ the
repository to ground the plan, but never write files.

IMPORTANT: Write the plan prose in Korean (한국어). Keep code, identifiers,
file paths, and commands in their original form — only the explanations,
section headings, and descriptions should be Korean.`;

const BUILD_SYSTEM = `You are the BUILD agent in an automated dev loop.
Implement the requested work exactly. When a specific STEP is given, implement
ONLY that step — do not start other steps. Make all necessary file edits in the
working directory. Keep changes focused. Do not commit — a separate verifier
and the orchestrator handle verification and committing.

Code structure rules (apply to every language/framework):
  - One file/module has ONE reason to change. If data access, business logic,
    and presentation end up mixed in one file, split them.
  - No premature abstraction: do not create interfaces with a single
    implementation, wrapper layers called from one place, or "might need it
    later" option parameters. Split when responsibilities mix or real reuse
    appears — not preemptively.

IMPORTANT: Write all of your prose — progress notes and the final summary — in
Korean (한국어). Code, identifiers, and commands stay in their original form.
When done, write a concise Korean summary covering:
  1) 무엇을 했는지 — which files you changed and what each change does.
  2) 이전 검증에서 거절된 적이 있다면(피드백이 주어졌다면), 그 지적을 어떻게
     해결했는지 구체적으로. (피드백이 없었다면 이 항목은 생략.)`;

const INTERVENE_SYSTEM = `You are the LEAD engineer (호재) in an automated dev loop.
A single build step has FAILED code review repeatedly. The builders keep trying
but can't get it past the reviewer. Step in as the lead: figure out the REAL
root cause and hand the builder a concrete, decisive fix.

You are READ-ONLY: inspect the repo/diff to ground your diagnosis, but do NOT
edit files. Your output is GUIDANCE the builder will follow on the next attempt.

Think about WHY the previous attempts failed (look past the surface symptom):
  - Is the builder chasing the wrong fix, or fabricating package versions?
  - Is there a dependency/peer-dependency or version conflict to pin exactly?
  - Is the reviewer's objection legitimate, and if so what is the minimal correct fix?
  - Are the attempts oscillating between two wrong states?

Respond in KOREAN with a short, decisive action plan the builder can execute:
  1) 근본 원인 (한두 문장).
  2) 정확히 무엇을 어떻게 바꿔야 하는지 — 구체적 파일/패키지/버전/명령까지. 애매한
     표현 금지. 필요하면 정확한 버전 번호를 명시(존재하지 않는 버전 지어내지 말 것).
  3) 하지 말아야 할 것 (반복된 실패 패턴을 다시 밟지 않도록).
Keep code, identifiers, paths, versions, and commands in their original form.`;

// Claude planning agent (Opus): produces the approval-gated plan. An optional
// personal harness (agents-config/hojae.md) is appended to both prompts.
export class ClaudePlanner implements Planner {
  constructor(
    private readonly model: string,
    private readonly harness?: string
  ) {}

  // Lead-engineer escalation: diagnose a repeatedly-failing step (read-only) and
  // return concrete fix guidance for the builder's next round.
  intervene(req: InterveneRequest, reporter: PhaseReporter): Promise<AgentResult> {
    const failures = req.failures.length
      ? req.failures.map((f, i) => `## 실패 ${i + 1}\n${f}`).join("\n\n")
      : "(기록된 리뷰 사유 없음)";
    const prompt = [
      workspaceRule(req.cwd),
      `# 전체 승인 계획\n${req.approvedPlan}`,
      `# 막힌 단계 (${req.index}/${req.total})\n${req.stepDescription}`,
      `# 지금까지 ${req.attempts}번 시도했지만 모두 검증 실패 — 검증자(codex) 사유\n${failures}`,
      `# 현재(거절된) 변경 diff\n\`\`\`diff\n${(req.diff || "(no changes)").slice(0, 20000)}\n\`\`\``,
      `위 실패들을 근거로 근본 원인을 진단하고, 빌더가 다음 시도에서 바로 실행할 수 있는 구체적 해결책을 제시하세요.`,
    ].join("\n\n");
    return runClaude(reporter, "plan", this.model, prompt, {
      cwd: req.cwd,
      permissionMode: "plan",
      systemPrompt: withHarness(INTERVENE_SYSTEM, this.harness, "호재"),
      canUseTool: workspaceGuard(req.cwd),
      disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Task"],
    });
  }

  async plan(req: PlanRequest, reporter: PhaseReporter): Promise<PlanResult> {
    const body =
      req.previousPlan && req.feedback
        ? [
            `# Original request\n${req.brief}`,
            `# 직전에 당신이 제안한 계획\n${req.previousPlan}`,
            `# 사용자 피드백 — 아래 요청을 반영해 계획을 수정하세요\n${req.feedback}`,
            `수정된 전체 계획을 처음부터 다시 제시하세요 (끝에 \`\`\`steps 블록 포함).`,
          ].join("\n\n")
        : req.brief;
    const prompt = `${workspaceRule(req.cwd)}\n\n${body}`;
    let system = `${PLAN_SYSTEM}\n${STEPS_SYSTEM}`;
    if (req.assignableDevs?.length) system += `\n${assignSystem(req.assignableDevs)}`;
    if (req.suggestTeam) system += `\n${teamSystem()}`;
    const result = await runClaude(reporter, "plan", this.model, prompt, {
      cwd: req.cwd,
      permissionMode: "plan",
      systemPrompt: withHarness(system, this.harness, "호재"),
      canUseTool: workspaceGuard(req.cwd),
      // The plan must land inline (not in a file), and the planner must not spawn
      // a subagent that roams outside the workspace — so block writes + Task.
      disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Task"],
    });
    // Parse the fenced output HERE — the format is this adapter's contract with
    // its prompt; callers get structure (PlanResult), never fence syntax.
    const parsed = parsePlanOutput(result.text);
    return {
      text: parsed.cleanText,
      isError: result.isError,
      steps: parsed.steps,
      devs: parsed.devs,
      team: parsed.team,
    };
  }
}

// Claude build agent (Sonnet): implements the approved plan, auto-approved.
// Instantiated once PER DEVELOPER (runner.ts) with that person's harness
// (agents-config/<agentId>.md — 태경=프론트엔드, 민재=백엔드, 주희=iOS, …) so
// each teammate builds with their own specialty rules on top of BUILD_SYSTEM.
export class ClaudeBuilder implements Builder {
  constructor(
    private readonly model: string,
    private readonly harness?: string,
    private readonly name = "개발자"
  ) {}

  build(req: BuildRequest, reporter: PhaseReporter): Promise<AgentResult> {
    const s = req.step;
    const completedBlock =
      s && s.completed.length
        ? `# 이미 완료된 단계 (커밋됨 — 다시 구현하지 말 것)\n${s.completed
            .map((d, i) => `${i + 1}. ${d}`)
            .join("\n")}`
        : "";
    const currentBlock = s
      ? `# 지금 구현할 단계 (${s.index}/${s.total}) — 오직 이 단계만 구현\n${s.description}`
      : "";
    const closing = s
      ? `이번 단계(${s.index}/${s.total})만 구현하세요. 다른 단계는 건드리지 마세요.`
      : `Implement this now in the working directory.`;

    const prompt = [
      workspaceRule(req.cwd),
      `# Original request\n${req.brief}`,
      `# Approved plan (전체 맥락)\n${req.approvedPlan}`,
      completedBlock,
      currentBlock,
      req.feedback
        ? [
            `# 검증자/리드의 지적 — 반드시 이번에 모두 해결 (MUST fix ALL)`,
            req.feedback,
            ``,
            `위 지적을 하나도 빠짐없이 처리하세요. 각 지적에 대해 실제로 코드를 고치고,`,
            `요약에 "지적 N → 어떻게 고쳤는지"를 항목별로 적으세요. 지적과 무관한 다른`,
            `작업(예: 타입 오류만 손보기)으로 회피하지 말고, 지적된 근본 문제를 직접 고치세요.`,
            `그리고 마무리 전에 SAME-CLASS 스캔: 지적된 것과 같은 종류의 문제(예: 한 필드의`,
            `타입 검증 누락이 지적됐다면 다른 모든 입력 필드도)가 이 단계의 다른 코드에 남아`,
            `있지 않은지 스스로 훑어서 함께 고치세요. 리뷰어가 다음 라운드에 찾을 것을 먼저 없애야`,
            `재시도 루프가 끝납니다.`,
          ].join("\n")
        : "",
      closing,
    ]
      .filter(Boolean)
      .join("\n\n");

    return runClaude(reporter, "build", this.model, prompt, {
      cwd: req.cwd,
      // Auto-approve edits, but ONLY inside the workspace: the guard denies any
      // write/command that reaches outside req.cwd (replaces blanket bypass).
      permissionMode: "default",
      canUseTool: workspaceGuard(req.cwd),
      systemPrompt: withHarness(BUILD_SYSTEM, this.harness, this.name),
      // No roaming subagents — keep the builder in its own workspace.
      disallowedTools: ["Task"],
    });
  }
}
