# agents-config — 에이전트별 하네스

`<agentId>.md` 파일 하나가 그 에이전트의 **개인 하네스**입니다 — 전문 분야, 우선순위,
작업 규칙, 하지 말아야 할 것. 공용 역할 프롬프트(기획/개발/검증 규칙서) 뒤에
그대로 append되어 시스템 프롬프트가 됩니다.

- 개발자(태경/민재/주희/성민/연한): `ClaudeBuilder`의 BUILD_SYSTEM 뒤에 붙음
- 기획(호재): PLAN/INTERVENE 프롬프트 뒤에 붙음
- 검증자(주호/동환): 각 codex 렌즈 뒤에 붙음 · 유준: 통합 렌즈 뒤에 붙음
- 성호(빌드 검사): 모델이 없어 하네스 미적용 (파일 없음이 정상)
- 리서처 예림(웹): `ClaudeResearcher`의 RESEARCH_SYSTEM 뒤에 붙음
- 리서처 상현(X): `GrokResearcher`(Grok Build CLI, X 구독 OAuth)의 GROK_RULES 뒤에 붙음
  — 리서치 run은 두 리서처가 동시에(팬아웃) 조사한다

파일이 없으면 공용 프롬프트만 사용합니다. **수정 후 orchestrator 재시작 필요**
(`launchctl kickstart -k gui/$(id -u)/dev.pelicanlab.agent-orchestrator`).

에이전트 id ↔ 이름은 `packages/shared/src/roster.ts`의 SEATS 참고.

## learned/ — 팀 학습 노트 (쓸수록 똑똑해지는 루프)

하네스가 사람이 쓰는 규칙이라면, `learned/`는 팀이 일하면서 스스로 쌓는 기억입니다
(`src/agents/learn-store.ts`). 하네스와 달리 **run 시작마다 새로 읽으므로 재시작이
필요 없습니다.**

- `learned/projects/<프로젝트>.md` — 프로젝트 운영 사실. run이 committed로 끝나면
  회고(호재, REFLECT_MODEL)가 그 run의 검증 실패 이력에서 교훈을 뽑아 **자동으로**
  쌓고, 이 프로젝트의 모든 계획/빌드 프롬프트에 주입됩니다. 틀린 항목은 그냥
  지우세요 — 다음 run부터 반영됩니다.
- `learned/agents/<agentId>.md` — 팀원 개인 교훈. **자동 저장되지 않습니다** —
  회고/리서처가 후보를 `proposals.json`(제안함)에 올리고, 대시보드 팀 소개 탭에서
  사용자가 승인한 것만 여기 편입됩니다 (계획 승인 게이트의 학습판).
- 모든 교훈은 `[조건]` 접두가 강제됩니다 — "언제 적용되는가" 없는 무조건 규칙이
  프로젝트를 넘나들며 충돌하는 것을 막기 위해서입니다.
- 프롬프트에는 파일당 최신 30개 불릿만 주입됩니다 (파일은 전체 이력 보존).
