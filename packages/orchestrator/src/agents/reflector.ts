import { queryFinalText, type FinalTextUsage } from "./claude-query.js";
import type { Lesson } from "./learn-store.js";

// 회고 에이전트 — run이 끝난 뒤 그 run의 실패/재시도 이력에서 "다음 run에도
// 유효한 교훈"을 뽑는다. 검증 팬아웃의 거절 사유와 호재의 진단은 이미 훈련
// 신호인데 run이 끝나면 버려지고 있었다 — 그걸 여기서 회수한다.
//
// 출력은 두 갈래로 나뉜다 (learn-store의 저장 정책과 짝):
//   projectFacts — 프로젝트 귀속 운영 사실 → 자동 저장
//   proposals    — 에이전트 귀속 행동 교훈 → 제안함 (사용자 승인 대기)

export interface ReflectRequest {
  project: string;
  brief: string;
  plan: string;
  cwd: string;
  // 이 run에 참여한 개발자 id들 — proposals.agentId는 이 안에서만 유효하다.
  builderIds: string[];
  steps: Array<{
    description: string;
    failures: string[]; // 이 단계에서 거절된 시도들의 검증자 사유 (성공 전 이력 포함)
  }>;
}

export interface ReflectOutcome {
  projectFacts: Lesson[];
  proposals: Array<Lesson & { agentId: string }>;
}

export interface Reflector {
  reflect(req: ReflectRequest): Promise<{ outcome: ReflectOutcome; raw: string; usage?: FinalTextUsage }>;
}

const REFLECT_SYSTEM = `You are the RETROSPECTIVE agent in an automated dev loop.
A run just finished. From its failure/retry history, extract ONLY lessons that
will still be true in future runs. You are the team's memory — bad memory is
worse than none, so be strict:

- Every lesson MUST have a condition ("when does this apply"). A lesson you
  cannot scope to a condition must be dropped, not saved unconditionally.
- projectFacts: operational facts about THIS project/repo (build commands,
  conventions, environment gotchas) that a failure in this run proves. These
  are auto-saved, so include only what the evidence clearly supports.
- proposals: recurring behavioral lessons for a SPECIFIC developer (agentId
  must be one of the given ids). These go to a human approval queue — still,
  propose only patterns backed by repeated evidence, not one-off slips.
- One-off mistakes, lessons already obvious from the codebase, and anything
  that merely restates the reviewer feedback verbatim: drop them.
- EMPTY ARRAYS ARE A GOOD ANSWER. A clean run usually teaches nothing durable.

Write condition/lesson/evidence values in Korean (한국어); keep commands, paths
and identifiers as-is. Respond with ONLY a fenced json block, no prose:

\`\`\`json
{"projectFacts": [{"condition": "...", "lesson": "...", "evidence": "..."}],
 "proposals": [{"agentId": "...", "condition": "...", "lesson": "...", "evidence": "..."}]}
\`\`\``;

// LLM 출력에서 json 펜스(또는 맨몸 JSON)를 찾아 관대하게 파싱 — 회고는 부가
// 기능이라 실패해도 예외 대신 빈 결과를 돌려주고 run에는 영향을 주지 않는다.
export function parseReflectOutput(text: string, validAgentIds: string[]): ReflectOutcome {
  const empty: ReflectOutcome = { projectFacts: [], proposals: [] };
  const fenced = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let parsed: any;
  try {
    parsed = JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return empty;
  }
  const asLesson = (v: any): Lesson | null =>
    v && typeof v.condition === "string" && typeof v.lesson === "string" && typeof v.evidence === "string"
      ? { condition: v.condition, lesson: v.lesson, evidence: v.evidence }
      : null;
  const facts = (Array.isArray(parsed?.projectFacts) ? parsed.projectFacts : [])
    .map(asLesson)
    .filter((l: Lesson | null): l is Lesson => !!l);
  const proposals = (Array.isArray(parsed?.proposals) ? parsed.proposals : [])
    .flatMap((v: any) => {
      const l = asLesson(v);
      return l && typeof v.agentId === "string" && validAgentIds.includes(v.agentId)
        ? [{ ...l, agentId: v.agentId }]
        : [];
    });
  return { projectFacts: facts.slice(0, 3), proposals: proposals.slice(0, 2) };
}

export class ClaudeReflector implements Reflector {
  constructor(private readonly model: string) {}

  async reflect(req: ReflectRequest): Promise<{ outcome: ReflectOutcome; raw: string; usage?: FinalTextUsage }> {
    const history = req.steps
      .map((s, i) => {
        const fails = s.failures.length
          ? s.failures.map((f, n) => `  - 거절 ${n + 1}: ${f.slice(0, 1500)}`).join("\n")
          : "  - (한 번에 통과)";
        return `## 단계 ${i + 1}: ${s.description}\n${fails}`;
      })
      .join("\n\n");
    const prompt = [
      `# 프로젝트: ${req.project}`,
      `# 요청\n${req.brief}`,
      `# 승인된 계획\n${req.plan.slice(0, 4000)}`,
      `# 단계별 검증 이력 (거절 사유 = 학습 신호)\n${history}`,
      `# proposals.agentId로 쓸 수 있는 개발자 id\n${req.builderIds.join(", ") || "(없음)"}`,
      `위 이력에서 다음 run에도 유효한 교훈만 추출하세요. 확신이 없으면 빈 배열이 정답입니다.`,
    ].join("\n\n");
    const { text, usage } = await queryFinalText(prompt, {
      model: this.model,
      cwd: req.cwd,
      permissionMode: "plan", // 읽기 전용 — 회고는 파일을 만지지 않는다
      systemPrompt: { type: "preset", preset: "claude_code", append: REFLECT_SYSTEM },
      disallowedTools: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Task", "Bash"],
    });
    return { outcome: parseReflectOutput(text, req.builderIds), raw: text, usage };
  }
}
