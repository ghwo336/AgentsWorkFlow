# agent-loop 프로젝트 구조

> 저장소의 물리적 구조와 각 모듈의 책임을 정리한 문서입니다.
> 동작 원리·작업 규칙은 [AGENTS.md](../AGENTS.md), 코드 품질 기준은
> [docs/CODE-QUALITY.md](CODE-QUALITY.md)를 함께 보세요.

## 한눈에 보기

자연어 요구사항 → **기획(호재) → 승인 → 개발(전문 개발자) → 검증(4인 팬아웃) → 커밋**
을 자동으로 도는 멀티 에이전트 개발 루프. npm workspaces 모노레포 3패키지 구성.

```
브라우저 ──▶ dashboard (Next.js :3737, Docker)
                │  /api/* 프록시 · SSE 패스스루
                ▼
             orchestrator (Fastify :4000, launchd)
                │  파이프라인 실행 · SQLite 단독 소유
                ▼
             agent-workspaces/<project>/   ← 에이전트들의 작업 폴더 (run별 git 저장소)
```

## 루트

```
agent-loop/
├── package.json                  # 워크스페이스 루트 (db:push/db:generate, dev 스크립트)
├── tsconfig.base.json            # 공통 tsconfig
├── prisma/schema.prisma          # SQLite 스키마 (실제 DB는 prisma/prisma/dev.db)
├── Dockerfile.dashboard          # 대시보드 이미지 (orchestrator는 launchd + tsx)
├── docker-compose.dashboard.yml  # 대시보드 컨테이너 (:3737)
├── AGENTS.md                     # 에이전트/신규 참여자용 동작 가이드
├── docs/                         # 이 문서, CODE-QUALITY.md, deploy-dashboard.md
├── smoke.mjs                     # 간단 스모크 스크립트
└── packages/
    ├── shared/                   # 공용 어휘 (타입·로스터·가격표·DB 클라이언트)
    ├── orchestrator/             # 파이프라인 + HTTP/SSE 서버 (DB 소유자)
    └── dashboard/                # Next.js 웹 UI
```

## packages/shared — 공용 어휘

두 패키지가 같은 개념을 쓰면 **여기에 단일 정의**한다.

| 파일 | 책임 |
|---|---|
| `src/types.ts` | `RunStatus` · `Phase` · `StepKind` · `BusEvent`(SSE) · `ChatTurn` · `UsageRecord` · `InterventionDecision` 등 상태 어휘 |
| `src/roster.ts` | **팀 로스터의 단일 출처.** 좌석(`SEATS`, role×person — `"build:taekyung"`), `rosterOf`(선택→팀), `runModeOf`(팀→실행 모드), `validateAgents`(불가 조합 거절), `applyableTeam`(호재 추천 정제 — 최소 검증자 강제), `describeTeam`, `REVIEWER_AGENT_ID` |
| `src/pricing.ts` | 모델별 토큰 단가표 + `costUsd()` (기록 시 오케스트레이터, 표시 시 대시보드가 공유) |
| `src/db.ts` | 단일 `prisma` 클라이언트 (핫리로드/장수 프로세스 재사용) |

### 팀 로스터 (좌석)

| 역할 | 좌석 | 담당 | 엔진 |
|---|---|---|---|
| 기획 | plan:hojae | 호재 — 계획·팀 배치·에스컬레이션 | Opus |
| 개발 | build:taekyung | 태경 — 프론트엔드 | Sonnet |
| 개발 | build:minjae | 민재 — 백엔드 | Sonnet |
| 개발 | build:juhee | 주희 — iOS | Sonnet |
| 개발 | build:seongmin | 성민 — Android | Sonnet |
| 개발 | build:yeonhan | 연한 — 크로스플랫폼(RN) | Sonnet |
| 검증 | verify:juho | 주호 — 코드 품질(SOLID/DRY) | codex |
| 검증 | verify:donghwan | 동환 — 보안 감사 | codex |
| 검증 | verify:yujun | 유준 — 통합/런타임 배선 | Claude |
| 검증 | verify:seongho | 성호 — 빌드/타입체크 실행 | system(무료·결정적) |

## packages/orchestrator — 파이프라인 + API 서버

`src/` 의존 방향은 항상 추상화를 향한다(DIP). 구체 구현을 아는 곳은 `runner.ts` 하나.

### HTTP/조립 계층

| 파일 | 책임 |
|---|---|
| `index.ts` | Fastify 서버 — 라우트 + zod 검증 + 위임만. `POST /runs`(agents 좌석 키 엄격 검증), approve/resume/retry, `/chat`, `/runs/:id/intervene-chat`, `GET /events`(SSE), `/data/*` |
| `http-data.ts` | 대시보드용 읽기 데이터 API (`/data/runs`, `/data/usage`, `/data/projects` …) — 컨테이너가 SQLite를 직접 열지 않게 하는 프록시 지점 |
| `runner.ts` | **컴포지션 루트 + 유스케이스.** 리뷰어 팬아웃·개발자별 빌더(하네스 장착)·플래너를 조립하고 `startRun`(runModeOf로 모드 디스패치)/`resolveApproval`/`resolveInput`/`retryRun` export |
| `workspace-path.ts` | 워크스페이스 경로 정책 — 명시 경로 → 이름 워크스페이스 → 프로젝트 기본 폴더(기억) |
| `chat.ts` | 대화 서비스 — 사전 요구사항 정리(`clarify`), 막힌 run 상의(`interveneChatForRun` — 컨텍스트 조립 포함) |
| `config.ts` | 환경변수/기본값 (모델, 재시도 횟수, REVIEW_POLICY, TEST_CMD …) |
| `startup-sweep.ts` | 부팅 시 고아 정리 — 이전 프로세스의 running step/run을 실패 처리 |

### pipeline/ — 실행 모드별 상태머신

`Run.agents`(좌석 조합)가 정하는 **실행 모드마다 파일 하나**. `index.ts`는
deps 바인딩+위임만 하는 `RunPipeline` 파사드.

| 파일 | 모드/책임 |
|---|---|
| `full.ts` | 기본: 계획 → ★승인 → 단계별 구현/검증/커밋 루프 + 호재 에스컬레이션 사다리 + needs_input 재개 |
| `direct-build.ts` | 기획 생략: brief를 단일 단계로 바로 구현 |
| `plan-only.ts` | 기획만: 계획서 작성 후 종료 |
| `verify-only.ts` | 검증만: 프로젝트 **현재 상태 감사** (reviewPolicy 무시, 전원 통과 강제) |
| `team-staffing.ts` | 팀 스태핑 정책 — 호재 추천 정제·단계 배정 개발자 합류·무효 배정 정리 |
| `shared.ts` | 공유 협력자 — 리뷰 팬아웃(`runReviewFanout`), 계획 스텝(`planOnce`), 로스터 유틸 |
| `types.ts` | `PipelineDeps`(planner/builder(s)/reviewers/git/store/config) |

### agents/ — 엔진 어댑터

| 파일 | 책임 |
|---|---|
| `types.ts` | `Planner` · `Builder` · `Reviewer` 인터페이스(ISP) + `PlanResult`(파싱 완료된 계획) |
| `claude-agent.ts` | `ClaudePlanner`/`ClaudeBuilder` — SDK **스트리밍** 어댑터 (로그를 타임라인에 실시간 방출) |
| `claude-query.ts` | 비스트리밍 SDK 호출 공용 헬퍼 (`queryFinalText`) — chat/리뷰어가 사용 |
| `plan-format.ts` (+test) | 계획 출력 포맷의 **정의(프롬프트)와 파서를 한 모듈에** — \`\`\`steps(단계+담당 dev) / \`\`\`team(팀 추천) 블록 |
| `review-policy.ts` | 모든 LLM 리뷰어 공용 판정 규칙서 + 렌즈(`QUALITY_LENS`/`SECURITY_LENS`) |
| `codex-agent.ts` | `CodexVerifier` — codex exec 호출/판정·토큰 파싱. 렌즈별 인스턴스(주호·동환) |
| `claude-reviewer.ts` | `ClaudeReviewer`(통합, 유준) — 런타임 배선 관점 2차 리뷰 |
| `build-gate.ts` | `BuildGateReviewer`(성호) — 빌드/타입체크 **실제 실행** 게이트 |
| `command-reviewer.ts` | TEST_CMD 셸 명령 리뷰어 (exit 0 = PASS) |
| `harness.ts` | 에이전트별 하네스 로더 (`agents-config/<agentId>.md` → 시스템 프롬프트/렌즈 append) |
| `workspace-guard.ts` (+test) | **보안 경계** — 파일 도구 경로 + Bash 명령의 워크스페이스 탈출 차단(.. / ~ / 밖 절대경로, /tmp 불허) |

### 영속화·브로드캐스트 계층

| 파일 | 책임 |
|---|---|
| `run-store.ts` | `RunStore` — run/project 영속화 경계. **Run 테이블 쓰기는 이 모듈에만** (`updateRunStatus`를 events가 위임 호출). 재개 상태·막힌 컨텍스트 조회 |
| `events.ts` | 스트림 영속화 + SSE 브로드캐스트 (`logEvent`/`setStatus`/`recordUsage`/`recordVerdict`/`createStep`) |
| `reporter.ts` | `PhaseReporter` ⊂ `StepHandle`/`RunReporter` — runId/step 바인딩 파사드. **StepHandle이 span의 담당 에이전트를 usage에 자동 스탬프** |
| `bus.ts` | 인프로세스 pub/sub — SSE 라우트가 구독 |
| `git.ts` | `GitOps` — run별 격리 저장소(ensureRepo), 리뷰 diff(잠금파일 제외), 커밋 |

### agents-config/ — 에이전트별 하네스 (md, 코드 아님)

`<agentId>.md` = 그 팀원의 개인 시스템 프롬프트 확장 (전문 분야·우선순위·금지사항).
개발자 5명 + 호재 + 검증자 3명(성호는 모델 없음 → 없음). **수정 후 orchestrator 재시작 필요.**

## packages/dashboard — Next.js 웹 UI

DB를 직접 열지 않는다 — 모든 데이터는 orchestrator HTTP(`/data/*`) 경유.

```
app/
├── layout.tsx / globals.css      # 공통 레이아웃·스타일
├── page.tsx                      # 홈: 프로젝트 목록
├── lib/
│   ├── types.ts                  # 클라이언트 뷰모델 (Run에 agents/stepDevs 포함)
│   ├── api.ts                    # 백엔드 호출 단일 창구
│   ├── orch.ts                   # orchestrator base URL + orchJson/orchProxy
│   ├── cast.ts                   # 픽셀 캐릭터 데이터 + step/chat→에이전트 매핑 (스탬프 우선, 레거시 폴백) + roster 재수출
│   ├── agents.tsx                # 픽셀 아트 SVG (PixelAvatar/TeamRoster — 좌석 기반 사무실)
│   └── Markdown / useBusyAction / useOrchestratorEvents
├── projects/[name]/
│   ├── page.tsx                  # 워크스페이스 조립
│   ├── useWorkspace.ts           # 컨테이너 훅 (상태 + 액션 + SSE 라이브 갱신)
│   ├── _plan-steps.ts            # 순수 파생: Step[] → 단계 그룹/상태/담당
│   ├── _viz.tsx                  # 리스트/칸반/노드그래프/타임라인 4뷰
│   └── _components/
│       ├── NewTaskForm           # 요구사항 챗 + 시작 (팀 UI는 TeamPicker에 위임)
│       ├── TeamPicker            # 팀 구성 — 🤖 호재가 배치 / 🎯 좌석 직접 선택
│       ├── RunProgress           # 진행도 — 모드별 뷰 (기획/단계 로드맵/감사)
│       ├── RunList(+RunDetailCard) · AgentChat · AgentWorkSummary
│       └── ApprovalPanel · InterventionPanel · ResumePanel · FollowUpPanel · LiveLog …
├── usage/page.tsx                # 토큰/비용 — 📊 모델별 / 👥 에이전트별 탭
├── history/ · runs/[id]/         # 내역 · run 상세(+DiffView)
└── api/                          # 라우트 핸들러 (orchestrator 프록시 + repo 스캔 + SSE 패스스루)
```

## 데이터 모델 (Prisma / SQLite)

| 모델 | 핵심 필드 | 비고 |
|---|---|---|
| Project | name(PK), defaultTargetDir | 비용 그룹핑 단위 |
| Run | status, **agents**(좌석 키 JSON), **autoTeam**, plan, planSteps, **stepDevs**(단계별 담당), targetDir, commit, error | 한 작업의 전체 생명주기 |
| Step | kind, label, engine, model, **agent**(담당 person id), attempt, status, parentId, orderIdx | 작업 span — 리스트/칸반/그래프/타임라인이 전부 이 데이터 |
| Usage | engine, model, phase, **agent**, 토큰 4종, costUsd | 에이전트별 사용량 탭의 근거 |
| Event | phase, level, message, stepId | append-only 타임라인 |
| Verdict | attempt, passed, reason, diff | 리뷰 시도별 판정 |
| ChatMsg | role, kind, engine, **agent**, passed, text | 팀 채팅 |

모두 Run에 `onDelete: Cascade`. 마이그레이션 없이 `npm run db:push` 워크플로.

## 실행 모드 (Run.agents 조합 → runModeOf)

| 모드 | 조건 | 흐름 |
|---|---|---|
| full | 기획+개발 | 계획 → ★승인 → 단계별 구현/검증/커밋 (+호재 에스컬레이션) |
| direct | 개발만 | 승인 없이 바로 구현 |
| verifyOnly | 검증자만 | 프로젝트 현재 상태 감사 (전원 통과 필요) |
| planOnly | 호재만 | 계획서 작성 후 종료 |

`agents` 필드를 **생략**하면 자동 배치(autoTeam): 호재가 계획하며 팀을 추천하고
단계마다 담당 개발자를 배정한다(\`\`\`steps의 dev). 기획+검증(개발 없음)은 불가 조합.

## 배포 토폴로지 (요약)

- **orchestrator**: launchd `dev.pelicanlab.agent-orchestrator` (tsx, watch 아님 —
  코드 수정 후 `launchctl kickstart -k` 필요)
- **dashboard**: Docker 컨테이너 (`docker compose -f docker-compose.dashboard.yml up -d --build`)
- 외부 공개: Cloudflare Tunnel → `agent.pelicanlab.dev` (Basic Auth)
- 테스트: `npm -w @agent-loop/orchestrator test` (workspace-guard 27 + plan-format 6)

자세한 절차는 [docs/deploy-dashboard.md](deploy-dashboard.md) 참고.
