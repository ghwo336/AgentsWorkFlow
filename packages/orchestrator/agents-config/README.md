# agents-config — 에이전트별 하네스

`<agentId>.md` 파일 하나가 그 에이전트의 **개인 하네스**입니다 — 전문 분야, 우선순위,
작업 규칙, 하지 말아야 할 것. 공용 역할 프롬프트(기획/개발/검증 규칙서) 뒤에
그대로 append되어 시스템 프롬프트가 됩니다.

- 개발자(태경/민재/주희/성민/연한): `ClaudeBuilder`의 BUILD_SYSTEM 뒤에 붙음
- 기획(호재): PLAN/INTERVENE 프롬프트 뒤에 붙음
- 검증자(주호/동환): 각 codex 렌즈 뒤에 붙음 · 유준: 통합 렌즈 뒤에 붙음
- 성호(빌드 검사): 모델이 없어 하네스 미적용 (파일 없음이 정상)

파일이 없으면 공용 프롬프트만 사용합니다. **수정 후 orchestrator 재시작 필요**
(`launchctl kickstart -k gui/$(id -u)/dev.pelicanlab.agent-orchestrator`).

에이전트 id ↔ 이름은 `packages/shared/src/roster.ts`의 SEATS 참고.
