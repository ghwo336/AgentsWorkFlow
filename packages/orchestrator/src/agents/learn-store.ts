import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 팀 학습 저장소 — "쓸수록 똑똑해지는" 루프의 영속 계층. 하네스와 같은
// 철학(사람이 읽고 고칠 수 있는 md 파일)으로, agents-config/learned/ 아래:
//
//   learned/projects/<project>.md   프로젝트 귀속 운영 사실 — 회고가 자동 저장
//   learned/agents/<agentId>.md     에이전트 귀속 행동/방법 교훈 — 제안함에서
//                                   사용자가 승인한 것만 편입 (자동 저장 금지)
//   learned/proposals.json          제안함 — 승인 대기 중인 교훈 큐
//
// 두 갈래인 이유: 프로젝트 사실(빌드 명령, 저장소 관례)은 검증 실패라는 객관적
// 신호가 있어 자동 축적해도 안전하지만, 행동 교훈은 표본 몇 개로 과잉일반화될
// 수 있어 사람의 승인 게이트를 거친다 — 계획 승인 게이트의 학습판.
//
// 모든 교훈은 조건부다: "언제 적용되는가" 없는 무조건 규칙이 프로젝트를 넘나들며
// 충돌을 일으키는 것을 형식 수준에서 막는다 (Lesson.condition 필수).

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEARNED_DIR = resolve(__dirname, "../../agents-config/learned");
const PROJECTS_DIR = join(LEARNED_DIR, "projects");
const AGENTS_DIR = join(LEARNED_DIR, "agents");
const PROPOSALS_PATH = join(LEARNED_DIR, "proposals.json");

// 프롬프트 주입 상한 — 학습 파일이 자라도 컨텍스트를 잠식하지 않도록 최신
// 교훈부터 이 개수만 싣는다 (파일 자체는 전체 이력을 보존).
const MAX_INJECT_LESSONS = 30;

export interface Lesson {
  condition: string; // 언제 적용되는가 — 없는 교훈은 저장을 거부한다
  lesson: string;
  evidence: string; // 무엇에서 배웠나 (실패 사유/사건 요약)
}

export interface Proposal extends Lesson {
  id: string;
  agentId: string; // 교훈이 귀속될 팀원 (승인 시 learned/agents/<id>.md로)
  project: string;
  runId: string;
  ts: string; // ISO
  status: "pending" | "approved" | "rejected";
}

// ── 파일 이름 안전화 ─────────────────────────────────────────────────────────
// 프로젝트 이름은 사용자 입력(유니코드 허용), agentId는 LLM 출력이 흘러들 수
// 있다 — 둘 다 경로 구분자/선행 점을 제거해 learned/ 밖으로 못 나가게 한다.
function safeName(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\x00-\x1f<>:"|?*]/g, "").replace(/^\.+/, "").replace(/\s+/g, "-").trim();
}

function lessonLine(l: Lesson, meta: { runId?: string }): string {
  const date = new Date().toISOString().slice(0, 10);
  const src = meta.runId ? ` · run ${meta.runId.slice(0, 8)}` : "";
  return `- **[${l.condition.trim()}]** ${l.lesson.trim()} _(근거: ${l.evidence.trim()} · ${date}${src})_`;
}

function validLesson(l: Partial<Lesson> | undefined): l is Lesson {
  return !!l && !!l.condition?.trim() && !!l.lesson?.trim() && !!l.evidence?.trim();
}

function readIfExists(path: string): string | undefined {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

// 주입용 로드: 파일의 교훈 불릿 중 최신 MAX_INJECT_LESSONS개만.
function loadForInject(path: string): string | undefined {
  const text = readIfExists(path);
  if (!text) return undefined;
  const bullets = text.split("\n").filter((ln) => ln.startsWith("- "));
  if (bullets.length === 0) return undefined;
  return bullets.slice(-MAX_INJECT_LESSONS).join("\n");
}

function appendLessons(path: string, header: string, lessons: Lesson[], meta: { runId?: string }): number {
  const valid = lessons.filter(validLesson);
  if (valid.length === 0) return 0;
  mkdirSync(dirname(path), { recursive: true });
  const existing = readIfExists(path) ?? "";
  // 완전 중복(같은 교훈 문장)은 다시 쌓지 않는다 — 회고가 매 run 도는 만큼
  // 같은 발견이 반복되면 파일만 비대해진다.
  const fresh = valid.filter((l) => !existing.includes(l.lesson.trim()));
  if (fresh.length === 0) return 0;
  const lines = fresh.map((l) => lessonLine(l, meta)).join("\n");
  if (!existing) writeFileSync(path, `${header}\n\n${lines}\n`, "utf8");
  else appendFileSync(path, `${lines}\n`, "utf8");
  return fresh.length;
}

// ── 프로젝트 학습 노트 (자동) ────────────────────────────────────────────────

export function loadProjectLessons(project: string): string | undefined {
  const name = safeName(project);
  return name ? loadForInject(join(PROJECTS_DIR, `${name}.md`)) : undefined;
}

// 회고가 뽑은 프로젝트 사실을 저장. 반환값 = 실제로 새로 저장된 개수.
export function appendProjectLessons(project: string, lessons: Lesson[], meta: { runId?: string } = {}): number {
  const name = safeName(project);
  if (!name) return 0;
  return appendLessons(
    join(PROJECTS_DIR, `${name}.md`),
    `# ${project} — 팀 학습 노트\n\n프로젝트 run이 끝날 때마다 회고가 자동으로 쌓는 운영 사실입니다. 틀린 항목은 그냥 지우세요 — 다음 run부터 반영됩니다.`,
    lessons,
    meta
  );
}

// ── 에이전트 교훈 (승인 게이트 경유) ─────────────────────────────────────────

export function loadAgentLessons(agentId: string): string | undefined {
  const name = safeName(agentId);
  return name ? loadForInject(join(AGENTS_DIR, `${name}.md`)) : undefined;
}

// ── 제안함 ───────────────────────────────────────────────────────────────────

function readProposals(): Proposal[] {
  try {
    const arr = JSON.parse(readFileSync(PROPOSALS_PATH, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeProposals(items: Proposal[]): void {
  mkdirSync(LEARNED_DIR, { recursive: true });
  writeFileSync(PROPOSALS_PATH, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

export function listPendingProposals(): Proposal[] {
  return readProposals().filter((p) => p.status === "pending");
}

// 회고/리서처가 낸 교훈 후보를 제안함에 쌓는다. 승인 전에는 어떤 프롬프트에도
// 주입되지 않는다. 반환값 = 실제로 추가된 개수(불량/중복 제외).
export function addProposals(
  items: Array<Partial<Lesson> & { agentId?: string }>,
  meta: { project: string; runId: string }
): number {
  const all = readProposals();
  let added = 0;
  for (const item of items) {
    const agentId = safeName(item.agentId ?? "");
    if (!agentId || !validLesson(item)) continue;
    // 같은 에이전트에 같은 교훈이 이미 대기/승인돼 있으면 중복 제안하지 않는다.
    const dup = all.some(
      (p) => p.agentId === agentId && p.lesson === item.lesson!.trim() && p.status !== "rejected"
    );
    if (dup) continue;
    all.push({
      id: randomUUID(),
      agentId,
      condition: item.condition!.trim(),
      lesson: item.lesson!.trim(),
      evidence: item.evidence!.trim(),
      project: meta.project,
      runId: meta.runId,
      ts: new Date().toISOString(),
      status: "pending",
    });
    added++;
  }
  if (added > 0) writeProposals(all);
  return added;
}

// 사용자 결정: approve → 해당 에이전트의 learned 파일에 편입, reject → 기록만.
// 반환 false = 그 id의 대기 중 제안이 없음 (HTTP 층에서 404).
export function resolveProposal(id: string, action: "approve" | "reject"): boolean {
  const all = readProposals();
  const target = all.find((p) => p.id === id && p.status === "pending");
  if (!target) return false;
  if (action === "approve") {
    appendLessons(
      join(AGENTS_DIR, `${safeName(target.agentId)}.md`),
      `# ${target.agentId} — 승인된 교훈\n\n제안함에서 사용자가 승인한 교훈만 이 파일에 들어오고, 이 팀원의 모든 작업 프롬프트에 주입됩니다.`,
      [target],
      { runId: target.runId }
    );
  }
  target.status = action === "approve" ? "approved" : "rejected";
  writeProposals(all);
  return true;
}

// ── 대시보드용 전체 조회 ─────────────────────────────────────────────────────

function readDir(dir: string): Record<string, string> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const f of files) {
    const text = readIfExists(join(dir, f));
    if (text) out[basename(f, ".md")] = text;
  }
  return out;
}

// { projects: 프로젝트명 → md 원문, agents: agentId → md 원문 } — 팀 소개 탭이
// 하네스와 같은 방식으로 "배운 것"을 원문 그대로 보여준다.
export function loadAllLearned(): { projects: Record<string, string>; agents: Record<string, string> } {
  return { projects: readDir(PROJECTS_DIR), agents: readDir(AGENTS_DIR) };
}

// 시작 시 디렉터리 골격을 보장 (없어도 각 함수가 견디지만, 사용자가 파일을
// 직접 두기 쉽도록 미리 만들어 둔다).
export function ensureLearnedDirs(): void {
  if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true });
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true });
}
