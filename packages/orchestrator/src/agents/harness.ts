import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Per-AGENT harness loader. A harness is that teammate's personal system-prompt
// extension — specialty, priorities, do/don'ts — living as an editable markdown
// file so tuning an agent never means touching code:
//
//   packages/orchestrator/agents-config/<agentId>.md   (e.g. taekyung.md)
//
// Missing file = no harness (the shared role prompt still applies). Loaded once
// at composition time (runner.ts), not per call — edit + orchestrator restart.
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../agents-config");

export function loadHarness(agentId: string): string | undefined {
  try {
    const text = readFileSync(join(CONFIG_DIR, `${agentId}.md`), "utf8").trim();
    return text || undefined;
  } catch {
    return undefined; // 하네스 파일 없음 — 공용 역할 프롬프트만 사용
  }
}

// Every harness at once (agentId → markdown), for the dashboard's 팀 소개 —
// the modal shows each teammate's REAL working rules, straight from the same
// files the pipeline injects. README.md is dir documentation, not a person.
export function loadAllHarnesses(): Record<string, string> {
  let files: string[];
  try {
    files = readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const f of files) {
    const text = loadHarness(basename(f, ".md"));
    if (text) out[basename(f, ".md")] = text;
  }
  return out;
}

// 하네스 삽입 헤더는 여기 한 곳에서만 만든다 — 시스템 프롬프트(문자열)와
// 리뷰어 렌즈(줄 배열) 두 형태 모두 같은 머리말을 쓴다.
function harnessHeader(name: string): string {
  return `=== ${name}의 개인 하네스 (전문 분야·작업 규칙 — 반드시 따르세요) ===`;
}

// Append a harness onto a base system prompt.
export function withHarness(base: string, harness: string | undefined, name: string): string {
  if (!harness) return base;
  return `${base}\n\n${harnessHeader(name)}\n${harness}`;
}

// Append a harness onto a reviewer lens (line-array form).
export function lensWithHarness(lens: string[], harness: string | undefined, name: string): string[] {
  if (!harness) return lens;
  return [...lens, "", harnessHeader(name), harness];
}
