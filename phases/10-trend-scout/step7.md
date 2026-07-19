# Step 7: scout-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — **"웹 UI 데이터 흐름"**
- `/docs/ADR.md` — **ADR-007**(createRun 선생성 + CLI detached spawn), **ADR-006**(Next.js App Router + workspaces)
- `/docs/PRD.md` — "run 상태 파생 규칙"
- `web/AGENTS.md` — **이 Next.js는 훈련 데이터의 Next.js가 아니다.** 코드를 쓰기 전에 `node_modules/next/dist/docs/`의 해당 가이드를 읽어라
- `web/src/app/api/runs/route.ts` — `POST`의 createRun + spawn 패턴
- `web/src/app/api/runs/[id]/answers/route.ts` — **이 step이 복제할 선례다** (waiting 상태 검사 → 아티팩트 저장 → resume spawn)
- `web/src/app/api/runs/[id]/route.ts` — run 상세 응답 형태
- `web/src/lib/server/runs.ts` — `withRunStore`, `getRunDetail`, 상태 파생
- `web/src/lib/server/spawnConsult.ts`
- `web/src/test/server/api-routes.test.ts`, `web/src/test/server/runs.test.ts`
- `src/types/opportunity.ts`, `src/lib/runStore.ts` — step 0·1 산출물

## 이전 step에서 만들어진 것

- step 0: `OpportunitySelectionSchema`, `OpportunitiesSchema` 등
- step 1: `createRun(idea, { scout })`, `saveOpportunitySelection`/`loadOpportunitySelection`, `loadOpportunities`. 스카우트 run의 초기 `idea`는 범위 힌트(비면 `"전 범위 탐색"`)
- step 4: orchestrator가 후보 생성 후 `trend-scout`을 `waiting`으로 두고 종료. 선택이 저장된 뒤 resume되면 주제를 확정하고 진행

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### 1. `POST /api/runs` — 스카우트 모드 수용

현재는 `{ idea: string }`만 받는다. 스카우트 모드를 추가한다.

```
{ mode: "scout", scope?: string }   → createRun(scope || "전 범위 탐색", { scout: true })
{ idea: string }                    → 현행 그대로 (interview: true)
```

- `mode`가 없으면 **기존 동작**이다. 기존 클라이언트 요청이 그대로 동작해야 한다.
- 스카우트 모드에서 `scope`는 **선택**이다. 없거나 빈 문자열이면 전 범위 탐색이며 400이 아니다. 이것이 이 기능의 기본 사용법이다.
- 두 모드 모두 `createRun` → `spawnConsult(runId)` → `201 { runId }`. ADR-007의 순서(runId 선확보 후 spawn)를 지켜라.
- `mode`가 `"scout"`도 아니고 `idea`도 없으면 400.

### 2. `POST /api/runs/[id]/selection` 신규

`answers/route.ts`를 **거의 그대로** 복제한다. 형태가 동일하다 — 사람의 아티팩트를 받아 저장하고 resume spawn한다.

```
body: { candidateId: string }   // OpportunitySelectionSchema로 검증
```

응답 규약(`answers` 라우트와 동일하게):
- 본문이 JSON이 아님 → 400
- 스키마 불일치 → 400
- run 없음 → 404
- **`status !== "waiting"` → 409**
- 성공 → `saveOpportunitySelection` → `spawnConsult(id)` → `202 { runId }`

추가 검증 하나:
- **`candidateId`가 저장된 `opportunities.candidates`에 없으면 400.** 없는 후보를 저장하면 orchestrator가 error로 죽는데(step 4), 그 실패는 CLI 프로세스 안에서 일어나 `spawnConsult`가 `stdio: "ignore"`라 **사용자에게 아무 메시지도 도달하지 않는다.** API가 동기적으로 거절해야 한다.

### 3. `GET /api/runs/[id]` — 후보 목록 노출

`waiting` 상태의 스카우트 run에서 UI가 후보를 렌더할 수 있어야 한다. 상세 응답에 `opportunities`를 실어라.

- **`waiting`일 때만 싣지 마라 — 완료된 run에서도 필요하다.** 리포트 뷰가 "이 주제가 어디서 왔는지"를 보여준다(step 8).
- 다만 이 엔드포인트는 **2초마다 폴링된다.** 진행 뷰가 필요로 하는 것 이상을 매번 실어 보내지 않도록 주의하라. `hasReport`가 본문 대신 유무만 묻는 것과 같은 이유다. 후보 목록은 수 KB 수준이라 그대로 실어도 되지만, **판단 근거를 코드 주석에 남겨라.**
- `opportunities`가 없는 run(비-스카우트, 구 run)에서는 필드를 생략하거나 `null`로 둔다. 응답 형태가 깨지면 안 된다.

### 4. 서버 레이어

DB 접근은 `web/src/lib/server/runs.ts`의 `withRunStore`를 경유하라.

- **API 요청마다 커넥션을 열고 닫는다.** 모듈 스코프 싱글턴으로 들고 있지 마라 — Next dev 서버의 HMR이 모듈을 재평가하면서 닫힌 핸들을 재활용한다(ARCHITECTURE.md에 명시된 규칙).
- 타입·스키마는 `src/types`(`@anvil/types`)에서 import하라. **웹에서 다시 정의하지 마라**(ADR-005·ADR-006).

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음 (tsc + next build)
npm test        # 테스트 통과 (루트 vitest + web vitest)
npm run lint
```

`web/src/test/server/api-routes.test.ts`에 테스트를 **먼저** 추가하라(TDD). 최소한 아래를 덮어라:

- `POST /api/runs { mode: "scout" }` (scope 없음) → 201, `trend-scout` step을 가진 run이 생성되고 spawn된다
- `POST /api/runs { mode: "scout", scope: "B2B SaaS" }` → run의 `idea`가 그 scope다
- `POST /api/runs { idea: "..." }` → **기존 동작 그대로** (회귀 없음)
- `POST /api/runs {}` → 400
- `POST /selection` — 유효한 `candidateId` → 202, 선택이 저장되고 spawn된다
- `POST /selection` — `waiting`이 아닌 run → 409
- `POST /selection` — 없는 run → 404
- `POST /selection` — **`opportunities`에 없는 `candidateId` → 400** (spawn되지 않는다)
- `POST /selection` — 본문이 스키마 불일치 → 400
- `GET /api/runs/[id]` — 스카우트 run → `opportunities`가 실려 온다
- `GET /api/runs/[id]` — 비-스카우트 run → 응답 형태가 깨지지 않는다

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - **웹이 외부 API(Gemini·YouTube·HN·네이버)를 직접 호출하지 않는가?** 웹은 DB 읽기·쓰기와 CLI spawn만 한다
   - 타입을 `src/types`에서 import하는가? 웹에 중복 정의하지 않았는가?
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **웹에서 Gemini·YouTube·Hacker News·네이버를 호출하지 마라.** 이유: CLAUDE.md CRITICAL. 외부 API는 CLI 프로세스의 `services/` 안에서만 일어난다.
- **`scope`가 없다고 400을 반환하지 마라.** 이유: 범위 없는 전 범위 탐색이 이 기능의 기본 사용법이다.
- **없는 `candidateId`를 API에서 통과시키지 마라.** 이유: `spawnConsult`가 `stdio: "ignore"`라 CLI 안에서 난 에러는 사용자에게 도달하지 못하고 run이 조용히 죽는다(ADR-018이 같은 함정을 기록했다).
- **`web/`에 타입·스키마를 다시 정의하지 마라.** 이유: `src/types`가 단일 소스다(ADR-005·ADR-006).
- **RunStore를 모듈 스코프 싱글턴으로 들고 있지 마라.** 이유: Next dev의 HMR이 닫힌 핸들을 재활용한다.
- **Next.js API를 기억에 의존해 쓰지 마라.** 이유: `web/AGENTS.md` — 이 버전은 훈련 데이터와 다르다. `node_modules/next/dist/docs/`를 읽어라.
- 기존 테스트를 깨뜨리지 마라.
