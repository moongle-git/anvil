# Step 1: scout-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "DB 스키마", "상태 관리"
- `/docs/ADR.md` — **ADR-014**(저장소는 바이트를, zod는 의미를), **ADR-015**(삭제는 CASCADE, 재실행은 포크)
- `src/lib/db.ts` — DDL, `ARTIFACT_KINDS`, `SCHEMA_VERSION`
- `src/lib/runStore.ts` — 전체. 특히 `createRun`, `createRerun`, `saveRun`, `saveStepOutput`/`loadStepOutput`, `saveInterviewAnswers`/`loadInterviewAnswers`, `STEP_ARTIFACT_KINDS`
- `src/lib/runStore.test.ts`
- `src/types/run.ts` — `PIPELINE_STEPS`, `RunStateSchema` (step 0에서 `trend-scout`·`scout`이 추가됐다)
- `src/types/opportunity.ts` — step 0에서 생성됨

## 이전 step에서 만들어진 것

step 0이 `src/types/opportunity.ts`를 만들고, `PIPELINE_STEPS` 맨 앞에 `"trend-scout"`을, `RunStateSchema`에 `scout` 불린을 추가했다. `ARTIFACT_KINDS`에 `"opportunities"`·`"selection"`이, `STEP_ARTIFACT_KINDS`에 `"trend-scout": "opportunities"`가 **키만** 들어가 있다. 이 step이 그 위에 저장소 동작을 얹는다.

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### 1. `scout`은 컬럼이 아니라 파생값이다

`runs` 테이블에 컬럼을 **추가하지 않는다**. DDL이 전부 `CREATE TABLE IF NOT EXISTS`라 기존 DB에는 컬럼이 생기지 않고, ADR-014가 마이그레이션 러너를 금지한다.

대신 run을 읽을 때 `steps`에 `trend-scout` 행이 있는지로 `state.scout`을 채워라. `createRun`이 step을 조건부로 seed하므로(아래 2번) 이 파생은 항상 정확하다.

`interview`는 컬럼으로 남는다 — 이미 있고, 구 `state.json` 하위호환 때문에 존재한다. **일관성을 이유로 `interview`를 파생으로 바꾸지 마라.** 인터뷰가 켜졌는데 질문이 없어 `interviewer`가 건너뛰어지는 경우가 있어 두 값이 같지 않다.

### 2. `createRun`에 scout 모드

```ts
createRun(idea: string, opts?: { interview?: boolean; scout?: boolean }): RunState
```

step seeding 규칙 — 현재 `interviewer`를 거르는 `PIPELINE_STEPS.filter(...)` 자리를 확장한다:

| 모드 | `trend-scout` | `interviewer` |
|---|---|---|
| 직접 입력 (`scout: false`, `interview: true`) | seed 안 함 | seed |
| 직접 입력 CLI (`scout: false`, `interview: false`) | seed 안 함 | seed 안 함 |
| 스카우트 (`scout: true`) | **seed** | **seed 안 함** |

**스카우트 모드에서 `interviewer`를 seed하지 않는 것은 의도된 것이다.** 스카우트 후보는 이미 타깃·페인포인트·수익원이 구조화된 산출물이라 인터뷰가 메울 공백이 없고, 범위 힌트를 이미 받았으므로 질문이 중복된다. 무엇보다 한 run에서 사용자를 두 번(`후보 선택` → `질문 답변`) 멈춰 세우는 것은 "알아서 찾아줘"라는 요청과 정면으로 충돌한다.

### 3. 스카우트 모드의 `runs.idea`

`RunStateSchema.idea`는 `min(1)`이라 빈 문자열이 될 수 없고, 선택 전까지는 확정된 주제가 없다.

- 스카우트 run 생성 시 `idea`에는 **사용자가 준 범위 힌트**를 넣는다.
- 힌트가 비어 있으면 리터럴 `"전 범위 탐색"`을 넣는다. 상수로 export하라 (`SCOUT_FULL_SCOPE_IDEA` 등).

sentinel 값을 쓰지 않는 이유: run 목록에 그대로 표시되는 값이라, 의미 없는 자리표시자보다 "무엇을 탐색 중인지"가 보이는 편이 정확하다.

**부작용 하나를 문서화하라(코드 주석):** `newRunId(idea, now)`가 slug를 생성 시점의 `idea`로 만들므로, 스카우트 run의 `run_id` slug에는 확정 주제가 아니라 초기 힌트가 남는다. `run_id`는 다른 곳에서 불투명 식별자로만 쓰이므로 **동작 문제는 없다.** 선택 시점에 `run_id`를 바꾸려 들지 마라 — PK이고 `steps`·`artifacts`·`usage`가 FK로 물고 있다.

### 4. 주제 확정에는 새 메서드를 만들지 않는다

`saveRun`은 이미 `idea`를 UPDATE한다(`SET idea = ?, ...`). 주제 확정은 orchestrator가 `state.idea`를 갈아끼우고 `saveRun(state)`를 부르면 끝이다(step 4). `confirmIdea` 같은 메서드를 새로 만들지 마라 — API 표면만 늘고 `saveRun`과 두 개의 쓰기 경로가 생긴다.

### 5. 아티팩트 접근자

기존 선례를 그대로 따라라:

```ts
// trend-scout의 step 산출물 — questions와 같은 취급 (saveStepOutput 경유)
saveOpportunities(runId: string, opportunities: Opportunities): void
loadOpportunities(runId: string): Opportunities | null

// 사용자가 제출한 선택 — answers와 같은 취급 (step 산출물이 아닌 사람의 아티팩트)
saveOpportunitySelection(runId: string, selection: OpportunitySelection): void
loadOpportunitySelection(runId: string): OpportunitySelection | null
```

`load*`는 검증 실패 시 throw하지 말고 `null`을 반환한다 — 기존 `parseArtifact` 규약과 동일하다.

### 6. `createRerun`은 스카우트를 다시 돌리지 않는다

완료된 스카우트 run을 재실행하면 **주제는 이미 확정돼 있다.** 그러므로 포크된 run은 `trend-scout` step을 갖지 않는 평범한 run이어야 하고, 자료조사부터 돈다(ADR-015의 재실행 정의 그대로).

- 포크 시 `trend-scout`을 seed하지 마라.
- `opportunities`·`selection` 아티팩트를 복사하지 마라.
- 원본의 확정된 `idea`는 지금처럼 복사한다.

**주의:** `createRerun`은 현재 `PIPELINE_STEPS`를 순회해 step을 만든다. `trend-scout`이 배열에 추가됐으므로 **손대지 않으면 포크에 자동으로 딸려 들어간다.** 명시적으로 걸러라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint
```

`src/lib/runStore.test.ts`에 테스트를 **먼저** 추가하라(TDD). 최소한 아래를 덮어라:

- `createRun(idea, { scout: true })` → `steps`에 `trend-scout`이 있고 `interviewer`가 없다
- `createRun(idea, { interview: true })` → `interviewer`가 있고 `trend-scout`이 없다
- `createRun(idea)` → 둘 다 없다
- 로드한 `state.scout`이 `trend-scout` step 유무와 일치한다
- 범위 힌트가 빈 문자열이면 `idea`가 `"전 범위 탐색"`이다
- `opportunities`·`selection` 저장 → 로드 왕복이 값을 보존한다
- 손상된 `selection` JSON → `null` (throw 아님)
- 스카우트 run을 `createRerun` → 포크에 `trend-scout`이 **없고** `opportunities`·`selection` 아티팩트가 복사되지 않는다
- `state.idea`를 바꿔 `saveRun` → 다시 로드하면 바뀐 값이다

**기존 DB 호환 확인이 특히 중요하다:** `scout` 컬럼을 추가하지 않았으므로 이 phase 이전에 만들어진 DB 파일이 그대로 열리고 기존 run이 정상 로드되어야 한다. 기존 `runStore.test.ts`가 이미 이를 덮고 있는지 확인하고, 없으면 추가하라.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`runs` 테이블에 컬럼을 추가하지 마라. `SCHEMA_VERSION`을 올리지 마라. 마이그레이션 러너를 만들지 마라.** 이유: DDL이 `IF NOT EXISTS`뿐이라 기존 DB에 컬럼이 안 생기고, ADR-014가 러너를 명시적으로 금지한다.
- **`confirmIdea` 같은 주제 확정 전용 메서드를 만들지 마라.** 이유: `saveRun`이 이미 `idea`를 UPDATE한다. 쓰기 경로가 둘이 되면 `updated_at` 갱신 규약이 갈라진다.
- **`saveRun`을 UPDATE-only에서 UPSERT로 바꾸지 마라.** 이유: 삭제된 run에 좀비 프로세스가 쓰는 것을 막는 불변식이다(ADR-015).
- **`interview` 컬럼을 파생값으로 바꾸지 마라.** 이유: 인터뷰가 켜졌는데 질문이 0개여서 `interviewer`가 건너뛰어지는 경우가 있어 두 값이 일치하지 않는다.
- **`src/agents/`·`src/pipeline/`·`web/`을 건드리지 마라.** 이유: 이 step의 scope는 저장소 레이어다.
- 기존 테스트를 깨뜨리지 마라.
