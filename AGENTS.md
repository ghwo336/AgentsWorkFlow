# agent-loop — 에이전트용 프로젝트 가이드

> 이 문서는 코드베이스를 처음 접하는 사람/에이전트가 **구조와 동작 원리, 작업 규칙**을
> 빠르게 파악하도록 작성되었습니다. 코드를 바꾸기 전에 먼저 읽으세요.
>
> ⚠️ **코드를 추가/수정하려면 [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md)(코드 품질
> 행동양식)도 반드시 읽으세요.** 아키텍처 원칙(SOLID)·디자인 패턴·작업 절차·금지
> 사항이 정리되어 있습니다.
>
> 📁 파일 단위의 전체 구조 지도는 [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md) 참고.

## 1. 한 줄 요약

자연어 요구사항(brief)을 받아 **계획(Plan) → 승인(Approval) → 빌드(Build) →
검증(Verify) → 커밋(Commit)** 으로 이어지는 자동 개발 루프. 각 단계를 서로 다른 모델이
담당하고, 사람은 계획 단계에서 한 번만 승인하면 됩니다.

```
brief ──▶ ① Plan (Claude Opus) ──▶ ★ 사람 승인 ──▶ ② Build (Claude Sonnet)
                                                         │
                              ┌──────────────────────────┘
                              ▼
                        ③ Verify (codex) ──FAIL──▶ 피드백을 다시 ②로 (최대 N회)
                              │PASS
                              ▼
                        ④ Commit (git)
```

- **Plan/Build**: Anthropic Claude Agent SDK 사용 (API 과금).
- **Verify**: `codex` CLI를 read-only 샌드박스에서 strict 리뷰어로 실행. 사용자의 ChatGPT
  구독으로 동작하므로 실제 API 청구는 없음 — 비용은 동일 비교를 위한 **API 환산 추정치**.
- **참여 에이전트 선택** (`Run.agents`, 어휘는 `shared/src/roster.ts`, 선택 단위는 **좌석(role×person)** — 키는 `"build:taekyung"` 형태, 현재는 1인 1좌석): run마다 팀을 고를 수
  있고 조합이 파이프라인 모드를 정한다 —
  - 기획(호재) 포함 + 개발: 위 그림 그대로 (계획 → 승인 → 구현/검증)
  - 기획 제외 + 개발: 승인 없이 brief를 단일 단계로 바로 구현 (`pipeline.directBuild`)
  - **검증만**: 프로젝트 현재 상태를 선택된 검증자들이 감사 (`pipeline.verifyOnly`; diff 없이
    작업 디렉터리를 직접 읽는 감사 모드 프롬프트)
  - 기획만: 계획서 작성 후 종료 (`pipeline.planOnly`)
  - 기획+검증(개발 없음) 조합은 불가(`validateAgents`가 400). 검증자 미선택 시 리뷰 생략 후
    바로 커밋, 호재 미참여 시 에스컬레이션 라운드 없이 바로 needs_input.
  - **자동 배치** (`Run.autoTeam`, `agents` 필드 생략 = 기본): 호재가 계획하며 \`\`\`team
    블록으로 팀을 추천 → `applyableTeam`으로 정제해 `Run.agents`에 적용(개발자 0명이면
    전원 유지). revise 시 수정된 계획에 맞춰 재배치. UI 기본 모드가 "호재가 배치".
- **에이전트별 하네스** (`packages/orchestrator/agents-config/<agentId>.md`): 각 팀원의
  전문 분야·작업 규칙이 담긴 개인 시스템 프롬프트 확장. 개발자는 사람마다 `ClaudeBuilder`
  인스턴스가 따로 조립되어(runner.ts `buildersById`) 자기 하네스로 빌드한다 —
  태경=프론트엔드, 민재=백엔드, 주희=iOS, 성민=Android, 연한=크로스플랫폼(RN).
  플래너(hojae.md)와 리뷰어(juho/donghwan → 렌즈에 append, yujun)도 같은 파일 규약.
  파일 수정 후 orchestrator 재시작 필요. **프로젝트 성격에 맞는 개발자를 선택**하는 것이
  전제 — 시도(attempt) 재배정은 선택된 개발자들 사이에서만 순환한다.

## 2. 모노레포 구조 (npm workspaces)

```
agent-loop/
├── package.json              # 워크스페이스 루트. dev 스크립트(orchestrator+dashboard 동시 실행)
├── tsconfig.base.json        # 공통 tsconfig (각 패키지가 extends)
├── prisma/schema.prisma      # SQLite 스키마 (Project/Run/Usage/Event/Verdict)
├── smoke.mjs                 # 간단 스모크 테스트 스크립트
├── workspaces/               # 각 run의 작업 디렉터리(런타임 생성, gitignore)
└── packages/
    ├── shared/               # @agent-loop/shared — DB 클라이언트 + 타입 + 가격표
    ├── orchestrator/         # @agent-loop/orchestrator — 파이프라인 + Fastify HTTP/SSE 서버
    └── dashboard/            # @agent-loop/dashboard — Next.js(App Router) 웹 UI
```

### packages/shared (`src/`)
- `db.ts` — 핫리로드/장수 프로세스에서 재사용되는 단일 `prisma` 클라이언트.
- `types.ts` — `RunStatus`, `Phase`, `BusEvent`, `CodexVerdict`, `UsageRecord`,
  `InterventionDecision` 등 공용 어휘. **두 패키지가 같은 타입을 쓰면 여기에 단일 정의.**
- `pricing.ts` — 모델별 토큰 단가표 + `costUsd()` 계산. 오케스트레이터(기록 시)와 대시보드(표시)가 공유.

## 3. 오케스트레이터 아키텍처 (핵심)

`packages/orchestrator/src/`는 **SOLID 원칙으로 책임이 분리**되어 있습니다. 의존 방향은
항상 추상화를 향합니다(DIP).

| 파일 | 책임 |
|---|---|
| `index.ts` | Fastify 서버. HTTP 라우트(`POST /runs`, `POST /runs/:id/approve`, `GET /events` SSE)와 검증(zod)만 담당 |
| `runner.ts` | **컴포지션 루트**. 구체 구현(ClaudePlanner/Builder, `reviewers[]`(CodexVerifier + 선택적 CommandReviewer), Git 등)을 한 곳에서 조립하고 `startRun`/`resolveApproval`만 export. **엔진/리뷰어 교체 = 여기 한 줄 수정** |
| `pipeline/` | 실행 모드별 모듈: `full.ts`(계획→승인→단계 루프+에스컬레이션) · `direct-build.ts` · `plan-only.ts` · `verify-only.ts`(감사). 공유 협력자는 `shared.ts`(리뷰 팬아웃/계획 스텝), 팀 스태핑 정책은 `team-staffing.ts`, `index.ts`는 `RunPipeline` 파사드(deps 바인딩+위임만). 각 국면을 **Step(작업 span)** 으로 방출 |
| `agents/types.ts` | `Planner` · `Builder` · `Reviewer` 인터페이스(ISP). 요청/결과 타입 (`PlanResult` = 어댑터가 파싱까지 마친 계획) |
| `agents/claude-agent.ts` | `ClaudePlanner`, `ClaudeBuilder` — Claude Agent SDK 스트리밍 어댑터. `PhaseReporter`(log+usage)만 의존 |
| `agents/review-policy.ts` | **모든 LLM 리뷰어가 공유하는 판정 규칙서 + 렌즈들** — 중대 결함 일괄 보고, 범위 게이트, 이전 거절 이력(수렴 규칙)이 공용이고, `QUALITY_LENS`(공학 원칙)/`SECURITY_LENS`(보안)로 리뷰어별 관점을 분리. 리뷰 기준 변경은 여기 한 곳 |
| `agents/codex-agent.ts` | `CodexVerifier` — `codex exec` 호출 + 토큰/판정 파싱. **렌즈별로 여러 번 인스턴스화**: `품질`(주호 — 정확성+SOLID/DRY/계층) · `보안`(동환 — 보안 전담 감사) |
| `agents/claude-reviewer.ts` | `ClaudeReviewer`(`통합`) — Claude 2차 리뷰. 런타임·통합(배선이 실제로 동작하나) 관점 (유준) |
| `agents/build-gate.ts` | `BuildGateReviewer`(`빌드`) — 워크스페이스의 빌드/타입체크를 **실제 실행**하는 결정적 QA 게이트. build 스크립트→`npm run build`, tsconfig→`tsc --noEmit`, 둘 다 없으면 통과 (성호) |
| `agents/command-reviewer.ts` | `CommandReviewer` — 셸 명령(TEST_CMD) 실행, exit 0 = PASS. 테스트 러너를 리뷰 팬아웃에 합류시키는 `Reviewer` |
| `approval-gate.ts` | `ApprovalGate` — 사람 승인을 기다리는 async 게이트(runId→resolver) |
| `reporter.ts` | `PhaseReporter`(log/usage) ⊂ `RunReporter`/`StepHandle`. `DbRunReporter` — runId 바인딩 파사드. `startStep()`→step에 바인딩된 `StepHandle`(log/usage/verdict/finish) |
| `run-store.ts` | `RunStore` — run/project 영속화(Prisma) 경계. **Run 테이블 쓰기는 이 모듈에만** (`updateRunStatus`를 events.setStatus가 위임 호출) |
| `workspace-path.ts` | 워크스페이스 경로 정책 (명시 경로 → 이름 워크스페이스 → 프로젝트 기본 폴더) |
| `agents/claude-query.ts` | 비스트리밍 SDK 호출 공용 헬퍼 (chat/리뷰어가 사용; 스트리밍은 claude-agent만) |
| `git.ts` | git 함수들 + `GitOps` 인터페이스 + `git` 구현 객체 |
| `events.ts` | 저수준 영속화+SSE 브로드캐스트(`logEvent`/`setStatus`/`recordUsage`/`recordVerdict`/`createStep`/`updateStep`) |
| `bus.ts` | 인프로세스 pub/sub(EventEmitter). SSE 라우트가 구독, reporter가 발행 |
| `config.ts` | 환경변수/기본값. codex 모델은 env→`~/.codex/config.toml`→기본값 순으로 해석 |

> **핵심 패턴**: `RunPipeline`은 `Planner`/`Builder`/`Verifier`/`GitOps`/`RunStore`/
> `ApprovalGate`/`RunReporter` 추상화에만 의존합니다. 새 엔진을 붙이려면 인터페이스를
> 구현하고 `runner.ts`에서 주입만 바꾸면 됩니다(파이프라인 수정 불필요 = OCP).

## 4. 대시보드 아키텍처

`packages/dashboard/app/` — Next.js App Router. 데이터 패칭/상태/렌더링이 계층 분리됨.

```
app/
├── layout.tsx                # 공통 레이아웃 + nav + viewport(반응형)
├── globals.css               # 전역 스타일 + 모바일 미디어쿼리(.cols/.side/.stats/.table-scroll)
├── page.tsx                  # 홈: 프로젝트 목록 + 새 프로젝트
├── lib/
│   ├── types.ts              # 클라이언트 뷰모델(ProjectSummary/Run/RunEvent/RunDetail) + shared 타입 재수출
│   ├── api.ts                # 백엔드 호출 단일 창구(fetch/에러메시지 일원화)
│   ├── orch.ts               # 오케스트레이터 base URL + orchJson()(서버 컴포넌트용) + orchProxy()(라우트 핸들러용)
│   ├── cast.ts               # 픽셀 캐릭터 도메인 데이터(CAST/역할 매핑/agentForStep·Event) — 순수, 서버/클라 겸용
│   ├── agents.tsx            # 픽셀 아트 SVG 컴포넌트(PixelAvatar/TeamRoster 등) + cast 재수출
│   ├── Markdown.tsx          # 공용 마크다운 렌더러
│   ├── useBusyAction.ts      # 액션 버튼 그룹 busy 상태 훅(승인/개입 패널 공용)
│   └── useOrchestratorEvents.ts  # SSE 구독 훅("load 이후 연결" 로직 캡슐화)
├── projects/[name]/
│   ├── page.tsx              # 워크스페이스: 조립만 담당
│   ├── useWorkspace.ts       # 컨테이너 훅(runs/detail/selected 상태 + start/decide 액션 + 라이브 갱신). detail에 steps 포함 → SSE마다 리로드되어 시각화 라이브 갱신
│   ├── _plan-steps.ts        # 순수 파생 로직: Step[] → 단계 그룹핑/행 상태/결과 배지 (React 없음)
│   ├── _components/          # 프레젠테이셔널 — 관심사별 1파일 (index.ts barrel)
│   │   ├── NewTaskForm / ProjectSettings / RepoPicker
│   │   ├── RunList(+RunDetailCard) / RunProgress / AgentWorkSummary
│   │   └── ApprovalPanel / InterventionPanel / LiveLog / StatusBadge
│   └── _viz.tsx              # RunViz — Step 배열 위 4개 뷰(리스트/칸반/노드그래프(SVG)/타임라인). 외부 viz 라이브러리 없음
├── history/page.tsx          # 전체 작업 내역(서버 컴포넌트, orchJson으로 조회)
├── usage/page.tsx            # 토큰/비용 집계(서버 컴포넌트, orchJson으로 조회)
├── runs/[id]/page.tsx        # run 상세(+ DiffView)
└── api/                      # Route Handlers
    ├── projects, runs        # 오케스트레이터 /data/*로 orchProxy (DB 소유자를 경유한 읽기)
    ├── repos                 # 서버의 git repo 스캔(레포 피커용)
    └── orchestrator/*        # 쓰기/실행 프록시 + SSE 패스스루
```

- **모든 DB 접근은 오케스트레이터(DB 소유 프로세스)를 경유**: 서버 컴포넌트는
  `lib/orch.ts`의 `orchJson()`, 라우트 핸들러는 `orchProxy()`를 사용한다. 컨테이너가
  SQLite 파일을 직접 읽지 않는 이유는 orchestrator의 `http-data.ts` 주석 참조.
- **쓰기/실행(run 시작·승인·개입, 이벤트 스트림)**: `app/api/orchestrator/*`가
  오케스트레이터 HTTP로 프록시. SSE(events)만 스트리밍 헤더 때문에 수동 패스스루.

## 5. 데이터 모델 (Prisma, SQLite)

- **Project** `{ name(PK), createdAt }` — 비용 그룹핑 단위. run이 새 이름을 쓰면 upsert로 자동 생성.
- **Run** `{ id, project, title, brief, status, agents?, plan?, targetDir?, commit?, error?, … }`
  - `status`: `planning | awaiting_approval | building | verifying | committed | rejected | failed | cancelled`
  - `agents`: 참여 로스터 id JSON 배열(null = 전원/레거시). 조합별 파이프라인 모드는 §1 참고.
- **Usage** `{ engine(claude|codex), model, phase, agent?, input/output/cacheRead/cacheWrite, costUsd, stepId? }` — 한 번의 모델 호출 사용량 + 환산 비용(기록 시점 계산). `agent`는 담당자 person id(hojae/juho/…) — StepHandle이 span 생성 시 받은 `agent`를 usage에 자동 스탬프. 대시보드 `/usage?view=agents`가 이걸로 에이전트별 집계(레거시 null 행은 phase로 팀 단위 폴백).
- **Event** `{ phase, level(info|warn|error), model?, message, stepId?, ts }` — append-only 타임라인.
- **Verdict** `{ attempt, passed, reason, diff?, raw?, stepId? }` — 리뷰어 검증 시도별 결과(거절 사유 포함).
- **Step** `{ kind(plan|build|verify|review|test|commit), label, engine?, model?, agent?, attempt, status(pending|running|passed|failed|skipped), summary?, parentId?, startedAt, endedAt?, orderIdx }` — `agent`는 span 소유자 로스터 id (대시보드 `agentForStep`이 최우선 사용; null 레거시 행은 기존 휴리스틱 폴백). ChatMsg도 동일하게 `agent` 컬럼 보유. — **에이전트 작업 span(1급 노드)**. Event(점 로그)와 달리 생명주기(시작/종료)와 부모관계를 가짐. 대시보드의 리스트/칸반/노드그래프(parentId=엣지)/타임라인(startedAt→endedAt=막대)이 **모두 이 한 데이터**로 렌더됨.

모두 `Run`에 `onDelete: Cascade`로 묶임. `stepId`는 로그/사용량/판정을 특정 Step에 귀속(옵셔널, 하위호환).

## 6. 실행 방법

```bash
npm install
npm run db:generate          # prisma client 생성
npm run db:push              # SQLite 스키마 반영
npm run dev                  # orchestrator(:4000) + dashboard(:3737) 동시 실행
```

개별 실행: `npm run orchestrator` / `npm run dashboard`.

### 주요 환경변수 (`.env` — gitignore됨)
| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | — | prisma SQLite 경로 |
| `ORCH_HOST` / `ORCH_PORT` | `127.0.0.1` / `4000` | 오케스트레이터 바인딩 |
| `ORCH_INTERNAL_URL` | `http://127.0.0.1:4000` | 대시보드→오케스트레이터 프록시 대상 |
| `WORKSPACES_DIR` | `./workspaces` | run 작업 디렉터리 루트 |
| `PLAN_MODEL` | `claude-opus-4-8` | 계획 모델 |
| `BUILD_MODEL` | `claude-sonnet-4-6` | 빌드 모델 |
| `CODEX_MODEL` | env→`~/.codex/config.toml`→`gpt-5.5` | codex 모델(가격 산정용) |
| `REVIEW_MODEL` | `claude-sonnet-4-6` | Claude 2차 리뷰어(유준) 모델 |
| `MAX_VERIFY_RETRIES` | `3` | 빌드→검증 재시도 상한 |
| `REVIEW_POLICY` | `all` | 리뷰 팬아웃 커밋 정책. `all`=전원 통과, `any`=하나만 통과해도 커밋 |
| `TEST_CMD` | — | 설정 시 테스트 러너(`CommandReviewer`)를 리뷰 팬아웃에 추가. 작업 디렉터리에서 실행, exit 0 = PASS |

> codex CLI(`codex login`)가 설치·로그인되어 있어야 codex 리뷰어가 동작합니다.
> 리뷰 팬아웃: 여러 `Reviewer`가 **같은 diff를 병렬로** 검토하며 각자 하나의 Step(그래프의 동시 노드)이 됩니다. 리뷰어 추가 = `runner.ts`의 `reviewers[]`에 한 줄(파이프라인 불변, OCP).

## 7. 작업 규칙 (꼭 지킬 것)

- **언어**: 에이전트 프롬프트(plan/build/verify)와 대시보드 UI 문구는 **한국어**가 기본.
  코드/식별자/파일경로/명령은 원문 유지.
- **타입체크**: 변경 후 각 패키지에서 `npx tsc --noEmit`로 확인(대시보드는 루트, 오케스트레이터는
  `-p tsconfig.json`).
- **반응형**: 모바일 레이아웃은 `globals.css`의 `@media (max-width: 720px)` 규칙과
  헬퍼 클래스(`.cols`/`.side`/`.stats`/`.table-scroll`)로 처리. 인라인 2단 레이아웃을 추가하면
  모바일에서 세로 스택되도록 클래스를 붙일 것.
- **새 엔진/도구 추가**: `agents/types.ts` 인터페이스를 구현하고 `runner.ts`에서 주입.
  파이프라인 로직은 건드리지 말 것.
- **코드 품질**: [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md)의 원칙(단일 책임,
  추상화 의존, 중복 금지)과 작업 절차를 따를 것. 구조를 바꾸면 이 문서도 같은 커밋에서 갱신.

### 커밋 메시지 양식
- `feat:` 기능/수정사항
- `fix:` 오류 수정
- `docs:` 문서 수정
- `refactor:` 동작 변화 없는 구조 개선
- `chore:` 빌드/설정 등 잡무
