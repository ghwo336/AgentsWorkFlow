# 코드 품질 행동양식 (에이전트/기여자 공통)

> 이 문서는 **이 코드베이스를 처음 보는 에이전트(사람 포함)가 코드를 추가·수정할 때
> 지켜야 할 원칙과 절차**입니다. 구조/동작 설명은 [AGENTS.md](../AGENTS.md)를 먼저 읽으세요.
> 여기서는 "어떻게 짜야 하는가"만 다룹니다.

## 0. 요약 (이것만은 꼭)

1. **파이프라인 로직은 건드리지 않고 확장한다** — 새 엔진/리뷰어는 인터페이스 구현 + `runner.ts` 주입.
2. **타입·상수·로직은 한 곳에만 정의한다** — 두 패키지가 같은 어휘를 쓰면 `@agent-loop/shared`로 올린다.
3. **순수 로직과 React/IO를 섞지 않는다** — 파생·계산 로직은 훅/컴포넌트 밖의 순수 모듈로.
4. **주석은 "왜"를 적는다** — 코드가 말해주는 "무엇"을 반복하지 않는다.
5. **변경 후 반드시 타입체크** — orchestrator: `npx tsc -p tsconfig.json --noEmit`, dashboard: `npx tsc --noEmit`.

## 1. 아키텍처 원칙 (SOLID이 이 저장소에서 뜻하는 것)

### SRP — 파일/모듈은 한 가지 이유로만 바뀐다
- 오케스트레이터: `pipeline.ts`(정책) / `agents/*`(엔진 어댑터) / `run-store.ts`(영속화) /
  `reporter.ts`(보고) / `events.ts`(persist+SSE) / `runner.ts`(조립)가 서로의 일을 하지 않는다.
- 대시보드: `useWorkspace.ts`(상태·액션 컨테이너) ↔ `_components/*`(프레젠테이션) ↔
  `_plan-steps.ts`(순수 파생 로직) ↔ `lib/api.ts`(HTTP 창구)로 분리되어 있다.
- **징후**: 한 파일이 300줄을 훌쩍 넘고 서로 무관한 export가 늘어난다면 분리 시점이다.
  (예: 과거 `_components.tsx` 1,000줄 → 기능별 `_components/` 폴더로 분리)

### OCP — 확장은 추가로, 수정 없이
- 새 리뷰어/엔진/테스트러너 추가 = `agents/types.ts`의 `Planner`/`Builder`/`Reviewer` 구현
  후 **`runner.ts`(컴포지션 루트)에 한 줄 주입**. `pipeline.ts`는 수정 금지.
- 대시보드 시각화 추가 = `Step[]` 데이터를 읽는 새 뷰를 추가한다. Step 스키마를 뷰 사정에
  맞춰 바꾸지 않는다.

### DIP — 정책은 추상화에만 의존한다
- `RunPipeline`은 `Planner`/`Builder`/`Reviewer`/`GitOps`/`RunStore`/`RunReporter`
  **인터페이스만** 안다. 구체 클래스(`ClaudePlanner`, `CodexVerifier`, prisma…)는
  `runner.ts`만 안다. 파이프라인 안에서 `prisma`나 SDK를 직접 import하면 안 된다.

### ISP — 필요한 표면만 넘긴다
- 에이전트에게는 `RunReporter` 전체가 아니라 `PhaseReporter`(log/usage)나 `StepHandle`만
  넘긴다. 새 의존성을 추가할 때도 "이 코드가 실제로 부르는 메서드"만 담은 좁은 타입을 정의한다.

### DRY — 같은 지식은 한 곳에
- 두 패키지가 공유하는 어휘(상태, 단계, 결정 유니언 등)는 `packages/shared/src/types.ts`에
  단일 정의한다. (예: `InterventionDecision`은 orchestrator와 dashboard가 함께 쓴다.)
- 같은 코드가 **세 번째로** 복붙되려는 순간이 추출 시점이다. 대시보드→오케스트레이터 HTTP
  전달은 전부 `lib/orch.ts`의 `orchProxy()`를 쓴다(라우트마다 fetch를 손으로 쓰지 말 것).
  버튼 그룹의 busy 상태는 `lib/useBusyAction.ts`를 쓴다.

## 2. 이 저장소의 디자인 패턴 (새 코드도 이 틀을 따를 것)

| 패턴 | 위치 | 새 코드에 적용하는 법 |
|---|---|---|
| 컴포지션 루트 (DI) | `orchestrator/src/runner.ts` | 구체 구현의 조립·교체는 여기서만 |
| 전략 (Strategy) | `agents/types.ts`의 Planner/Builder/Reviewer | 엔진 교체 = 새 전략 구현 |
| 상태 머신 | `pipeline.ts` (plan→approve→build→verify→commit) | 새 상태는 `RunStatus`에 추가하고 전이를 파이프라인 메서드로 |
| 파사드 | `reporter.ts` `DbRunReporter`/`StepHandle` | runId/stepId 바인딩은 파사드가 숨긴다 — 호출부에 id를 끌고 다니지 말 것 |
| 옵저버 (pub/sub) | `bus.ts` + SSE `/events` | 새 실시간 신호는 `BusEvent`에 **옵셔널 필드**로 추가(하위호환) |
| 저장소 (Repository) | `run-store.ts`, `events.ts` | prisma 호출은 이 경계 안에만 |
| 컨테이너/프레젠테이션 | `useWorkspace.ts` ↔ `_components/*` | 컴포넌트에서 fetch 금지 — 액션은 훅에서 받아온다 |
| 순수 도메인 모듈 | `_plan-steps.ts`, `lib/cast.ts` | 파생·매핑 로직은 React 없는 파일로 분리 (서버/클라이언트 겸용 + 테스트 가능) |

## 3. 작업 절차 (행동양식)

**코드를 바꾸기 전에**
1. `AGENTS.md`로 구조를 파악하고, 바꾸려는 책임이 이미 어느 모듈에 있는지 찾는다.
2. 같은 일을 하는 헬퍼/타입이 이미 있는지 검색한다(`orchProxy`, `useBusyAction`,
   `stepOutcome`, shared 타입 등). **새로 만들기 전에 재사용.**

**코드를 쓸 때**
3. 새 파일은 위 표의 어느 계층인지 정하고 그 계층의 규칙을 따른다.
   애매하면: IO가 없으면 순수 모듈, IO가 있으면 경계 모듈(스토어/API 창구)로.
4. 타입 단언(`as`)·`any` 남발 금지. 외부 데이터(JSON.parse, SDK 스트림)는 경계에서
   한 번 검증/정규화하고 안쪽은 좁은 타입으로 다룬다. HTTP 입력 검증은 zod 스키마로.
5. 실패를 삼키지 않는다: catch는 (a) 사용자에게 보이는 메시지로 바꾸거나 (b) 파이프라인을
   `failed`/`needs_input`으로 전이시키거나 (c) 의도적 무시라면 주석으로 이유를 남긴다.
6. UI 문구·에이전트 프롬프트 산문은 한국어, 코드/식별자/경로/명령은 원문 유지.
7. 주석은 "왜 이렇게 했는지"(제약, 함정, 배경)만. 변경 이력·자기 설명("~를 수정함")은
   커밋 메시지에 쓰고 코드에 남기지 않는다.

**코드를 바꾼 뒤**
8. 각 패키지 타입체크: 루트에서
   `npm -w @agent-loop/orchestrator exec tsc -- -p tsconfig.json --noEmit` /
   `npm -w @agent-loop/dashboard exec tsc -- --noEmit`.
9. 문서 동기화: 구조(파일 추가/이동/책임 변경)를 바꿨으면 `AGENTS.md`의 해당 표/트리를
   같은 커밋에서 갱신한다. 원칙 자체가 바뀌면 이 문서를 갱신한다.
10. 커밋 메시지: `feat:` / `fix:` / `docs:` / `refactor:` / `chore:` + 한국어 요약
    (기존 로그 스타일을 따른다).

## 4. 자주 하는 실수 (하지 말 것)

- `pipeline.ts`에 특정 엔진/DB 지식 추가 ❌ → 인터페이스 뒤로 숨기고 runner에서 주입.
- 대시보드 컴포넌트 안에서 직접 `fetch` ❌ → `lib/api.ts`에 메서드 추가.
- 프록시 라우트에서 fetch를 손으로 작성 ❌ → `orchProxy()` 사용 (SSE 스트림만 예외).
- 오케스트레이터/대시보드에 같은 유니언 타입을 각각 선언 ❌ → shared로 승격.
- 순수 계산(그룹핑·파싱·매핑)을 컴포넌트/훅 안에 인라인 ❌ → 순수 모듈로 추출.
- `lib/agents.tsx`·`lib/cast.ts`에 `"use client"` 추가 ❌ → 서버 컴포넌트에서 함수 호출이
  깨진다(파일 상단 NOTE 참조).
- Step/BusEvent에 **필수** 필드 추가 ❌ → 기존 행/구독자가 깨진다. 옵셔널로 추가.
