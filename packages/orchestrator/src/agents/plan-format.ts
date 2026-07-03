import { devAgentIdOf, seatsOf } from "@agent-loop/shared/roster";

// The planner's machine-readable output format — fenced ```steps / ```team
// blocks. This module owns BOTH sides of the contract: the prompt text that
// defines the format AND the parser that reads it back, so a format change is
// one-file work and prompt/parser can never drift apart. The pipeline only ever
// sees the parsed structure (PlanResult), never the fence syntax.

// ── Prompt side ──────────────────────────────────────────────────────────────

// The base step-list spec (string items). Appended to the planner's system
// prompt; assignSystem() upgrades items to {"desc","dev"} objects when the run
// has developers to assign.
export const STEPS_SYSTEM = `
At the VERY END of your message, append a machine-readable step list: a fenced
\`\`\`steps block containing a JSON array. Each entry is ONE self-contained
implementation step that a builder agent can execute and a reviewer can verify
on its own. Split the work into meaningful units (NOT one file per step) — aim
for 3–8 ordered steps, each building on the previous.
SIZE RULE: one step = one reviewable diff. If a step would touch many routes/
modules at once (e.g. "구현 all API endpoints"), split it — oversized steps make
review feedback loop endlessly. Also write each step's ACCEPTANCE clearly enough
in the description that a reviewer can judge pass/fail without guessing extras.
Write each step description in Korean (code/paths/identifiers stay as-is).
Example:

\`\`\`steps
["Prisma 스키마에 X 모델 추가 후 마이그레이션", "API 라우트 /api/x 구현", "대시보드 UI 연결"]
\`\`\``;

// Step-assignment addendum: when the run has specialist developers, each plan
// step must name its assignee so the RIGHT specialist implements it (attempt
// 순번 배정은 스택 무관 배정이 된다). The catalog is the run's devs.
export function assignSystem(devs: Array<{ key: string; name: string; specialty?: string }>): string {
  const list = devs
    .map((d) => `  - ${d.key} — ${d.name}${d.specialty ? ` (${d.specialty})` : ""}`)
    .join("\n");
  return `
STEP ASSIGNMENT: each element of the \`\`\`steps array must be an OBJECT
{"desc": "<단계 설명 (한국어)>", "dev": "<seat key>"} — "dev"는 그 단계를 구현할
개발자이며 아래 목록에서만 고른다. 각 단계는 스택이 맞는 전문가에게 배정하라
(예: 화면/UI 단계 → 프론트엔드, API/DB 단계 → 백엔드). 한 단계가 두 스택에
걸치면 더 비중이 큰 쪽에 배정하고 단계를 나눌 수 있으면 나눠라.

참여 개발자:
${list}

Example:
\`\`\`steps
[{"desc": "Prisma 스키마에 X 모델 추가", "dev": "build:minjae"},
 {"desc": "대시보드 UI 연결", "dev": "build:taekyung"}]
\`\`\``;
}

// Auto-team runs: the planner also STAFFS the team. Appended only when the run
// was started without an explicit selection (suggestTeam). The seat catalog is
// generated from the shared roster so a new hire never requires touching this.
export function teamSystem(): string {
  const devs = seatsOf("build")
    .map((s) => `  - ${s.key} — ${s.name} (${s.specialty})`)
    .join("\n");
  const verifiers = seatsOf("verify")
    .map((s) => `  - ${s.key} — ${s.name} (${s.reviewerNames?.[0] ?? "검증"})`)
    .join("\n");
  return `
ALSO: the user did not pick a team — YOU staff it. After the \`\`\`steps block,
append a \`\`\`team block: a JSON array of seat keys, the SMALLEST sensible team
for THIS request. Available seats:

개발자 (스택에 맞는 사람만, 최소 1명 — 무관한 스택의 개발자를 넣으면 재시도가
그 사람에게 배정되어 품질이 떨어진다):
${devs}

검증자 (기본으로 verify:juho(품질)와 verify:seongho(빌드 실행)를 포함하고,
인증·입력 처리·네트워크 등 보안이 중요한 작업엔 verify:donghwan을,
UI↔API 배선이 핵심인 작업엔 verify:yujun을 추가):
${verifiers}

plan:hojae(당신)는 자동 포함되므로 넣지 않아도 된다. 계획 본문에 팀 배치 이유를
한 줄로 언급하라. Example:

\`\`\`team
["build:taekyung", "build:minjae", "verify:juho", "verify:yujun", "verify:seongho"]
\`\`\``;
}

// ── Parse side ───────────────────────────────────────────────────────────────

export interface PlanOutput {
  cleanText: string; // plan text with the machine blocks stripped (for approval UI)
  steps: string[];
  devs: (string | null)[]; // per-step assignee person id (null = 미배정)
  team: string[] | null; // recommended seat keys (auto-team runs), or null
}

// Pull the ```team block (JSON array of seat keys) out of the text. Missing or
// malformed → null team; sanitizing happens in applyableTeam at the call site.
function extractTeam(text: string): { team: string[] | null; rest: string } {
  const fence = /```team\s*([\s\S]*?)```/i;
  const m = text.match(fence);
  if (!m) return { team: null, rest: text };
  const rest = text.replace(fence, "").trim();
  try {
    const arr = JSON.parse(m[1].trim());
    if (Array.isArray(arr) && arr.length > 0) {
      return { team: arr.map((k) => String(k)), rest };
    }
  } catch {
    /* malformed block — recommendation ignored */
  }
  return { team: null, rest };
}

// Pull the ```steps block: items are plain strings (legacy) or {"desc","dev"}
// objects. Falls back to a single step (the whole plan) when no valid block is
// present, which degrades gracefully to a one-shot build.
function extractSteps(text: string): { steps: string[]; devs: (string | null)[]; rest: string } {
  const fence = /```steps\s*([\s\S]*?)```/i;
  const m = text.match(fence);
  if (m) {
    try {
      const arr = JSON.parse(m[1].trim());
      if (Array.isArray(arr)) {
        const items = arr
          .map((s) => {
            if (s && typeof s === "object" && "desc" in s) {
              const desc = String((s as { desc: unknown }).desc ?? "").trim();
              const devRef = String((s as { dev?: unknown }).dev ?? "");
              return { desc, dev: devRef ? devAgentIdOf(devRef) : null };
            }
            return { desc: String(s).trim(), dev: null };
          })
          .filter((it) => it.desc);
        if (items.length > 0) {
          return {
            steps: items.map((it) => it.desc),
            devs: items.map((it) => it.dev),
            rest: text.replace(fence, "").trim(),
          };
        }
      }
    } catch {
      /* malformed block — fall back to a single step */
    }
  }
  return { steps: [text.trim()], devs: [null], rest: text };
}

export function parsePlanOutput(text: string): PlanOutput {
  const { team, rest: withoutTeam } = extractTeam(text);
  const { steps, devs, rest: cleanText } = extractSteps(withoutTeam);
  return { cleanText, steps, devs, team };
}
