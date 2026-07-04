import { runClaude } from "./claude-sdk.js";
import { withHarness } from "./harness.js";
import { learnedBlock, researchHistoryBlock, splitResearchLessons } from "./research-shared.js";
import { workspaceGuard } from "./workspace-guard.js";
import type { PhaseReporter } from "../reporter.js";
import type { Researcher, ResearchRequest, ResearchResult } from "./types.js";

const RESEARCH_SYSTEM = `You are the WEB RESEARCH agent (리서처) in an agent team.
Your job is INVESTIGATION, not coding: answer the user's research question by
searching the web (WebSearch) and reading sources (WebFetch), then write a
report. You never modify code or files.

Division of labor: a teammate (상현, Grok) covers X/Twitter with live X search —
X is behind a login wall you cannot see into, so do NOT try to browse X posts.
Your ground is everything else: official docs, Google, Reddit, papers, tech
media, project blogs.

Method:
  - Break the question into the claims/subtopics that must be answered.
  - Search multiple angles; don't stop at the first result. Prefer primary
    sources (official docs, papers, announcements) over blog hearsay.
  - Cross-check important claims across at least two independent sources; note
    disagreements instead of papering over them.
  - Distinguish facts (with source) from your own inference/opinion.

CRITICAL: The ENTIRE report MUST be in your final response message, inline, as
markdown. Do NOT save it to a file. The report is what the user reads.

Report shape (markdown, in Korean):
  1) **요약** — 3~5문장 핵심 답.
  2) 본문 — 소제목으로 구조화, 근거와 함께.
  3) **출처** — 참조한 URL 목록 (제목 + 링크).

Self-improvement (optional): if this investigation taught you a durable lesson
about HOW to research — a source-quality finding ("X류 질문은 공식 문서가 뉴스보다
정확했다") or a method finding ("스니펫만 믿지 말고 원문을 읽어야 했다") — append
it AFTER the report as a fenced block. METHOD lessons only, never world knowledge
(facts go stale; method does not). No lesson learned = omit the block entirely.
\`\`\`lessons
[{"condition": "언제 적용되는가", "lesson": "...", "evidence": "이번 조사의 어떤 경험에서"}]
\`\`\`

IMPORTANT: Write all prose in Korean (한국어). Keep technical terms, code
identifiers, product names, and URLs in their original form.`;

// Claude research agent (예림): web-search driven investigation that ends in
// an inline Korean report. Read-only — the run has no diff, no commit; the
// report itself is the deliverable. Personal harness: agents-config/yerim.md.
// (X 전담 동료는 GrokResearcher(상현) — grok-agent.ts.)
export class ClaudeResearcher implements Researcher {
  constructor(
    private readonly model: string,
    private readonly harness?: string
  ) {}

  async research(req: ResearchRequest, reporter: PhaseReporter): Promise<ResearchResult> {
    const prompt = [
      learnedBlock(req.learned),
      researchHistoryBlock(req.history),
      req.history?.length ? `# 후속 질문` : `# 리서치 질문`,
      req.question,
      ``,
      req.history?.length
        ? `위 대화에 이어지는 후속 질문입니다. 필요한 부분만 새로 조사해서 후속 질문에 답하는 보고서를 작성하세요 — 이전 보고서 내용은 참조만 하고 다시 쓰지 마세요. 보고서 전문을 마지막 응답 메시지에 그대로 담으세요.`
        : `웹을 조사해서 위 질문에 대한 보고서를 작성하세요. 보고서 전문을 마지막 응답 메시지에 그대로 담으세요.`,
    ]
      .filter(Boolean)
      .join("\n");
    const result = await runClaude(reporter, "research", this.model, prompt, {
      cwd: req.cwd,
      // 읽기 전용: 파일 수정 없이 조사만 한다. 웹 도구는 plan 모드에서도 동작.
      permissionMode: "plan",
      systemPrompt: withHarness(RESEARCH_SYSTEM, this.harness, "예림"),
      canUseTool: workspaceGuard(req.cwd),
      disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Task"],
    });
    // Parse the fenced lessons HERE — the block format is this adapter's contract
    // with its prompt (plan-format.ts와 같은 원칙); callers get structure only.
    const { report, lessons } = splitResearchLessons(result.text);
    return { text: report, isError: result.isError, lessons };
  }
}
