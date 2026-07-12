# Step 2: run-store-sqlite

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-014**(저장소 SQLite 전환: UPDATE-only `saveRun`, `updated_at`, 정규화 금지), **ADR-015**(삭제는 CASCADE, 재실행은 포크), **ADR-011**(스키마 변경 시 구 run은 `null`로 페일소프트)
- `/docs/ARCHITECTURE.md` — DB 스키마, "상태 관리" 절
- `/docs/PRD.md` — "run 상태 파생 규칙"
- `/CLAUDE.md` — CRITICAL 규칙 (TDD)
- **`src/lib/db.ts`** — 이전 step이 만든 `openDb`, `getDefaultDbPath`, `ArtifactKind`
- **`src/lib/runStore.ts`** — 이 step이 재작성할 대상. 현재 파일 기반 구현 전체를 정독하라.
- **`src/lib/runStore.test.ts`** — 현재 52개 케이스. 이 step에서 전면 갱신한다.
- `src/types/run.ts` — `RunStateSchema`, `StepStateSchema`, `PIPELINE_STEPS`
- `src/types/interview.ts`, `src/types/research.ts` — `InterviewQuestions/Answers`, `ResearchEvidence`
- `src/pipeline/orchestrator.ts` — `RunStore`의 최대 호출자. **이 step에서는 수정하지 않는다**(step 3의 일). 어떤 순서로 무엇을 호출하는지 파악하라.

## 배경

`RunStore`가 `runs/{run-id}/` 디렉토리에 JSON·MD 파일을 쓰는 구조를 SQLite로 바꾼다. 호출부(orchestrator·cli·web)는 step 3·5에서 손대므로, **이 step은 `RunStore`와 그 테스트만 바꾼다.** 다른 파일이 컴파일 에러를 내는 것은 정상이며, step 3·5에서 해소된다.

> **이 step 종료 시 `npm run build`가 실패할 수 있다.** `saveReport`의 반환 타입이 바뀌고 생성자 인자의 의미가 바뀌므로 orchestrator·cli·web이 깨진다. **그 깨짐은 허용된다.** 대신 아래 AC의 "부분 AC"를 반드시 통과시켜라 — `RunStore` 자신의 테스트는 전부 통과해야 한다.

## 작업

`src/lib/runStore.ts`를 SQLite 백엔드로 재작성한다.

### public API

**시그니처를 유지할 것** (호출부가 3곳에 흩어져 있고, step 3·5의 변경 폭을 줄이는 것이 목적이다):

```ts
createRun(idea: string, opts?: { interview?: boolean }): RunState
loadRun(runId: string): RunState                        // 없으면 throw (기존 동작 유지)
saveRun(state: RunState): void
saveStepOutput(runId: string, step: PipelineStepName, data: unknown): void
loadStepOutput<T>(runId: string, step: PipelineStepName, schema: z.ZodType<T>): T | null
saveInterviewQuestions(runId, questions): void
loadInterviewQuestions(runId): InterviewQuestions | null
saveInterviewAnswers(runId, answers): void
loadInterviewAnswers(runId): InterviewAnswers | null
saveResearchEvidence(runId, evidence): void
loadResearchEvidence(runId): ResearchEvidence | null
listRuns(nowMs?: number): RunSummary[]
```

**변경·신규**:

```ts
constructor(dbPath: string)                    // baseDir → dbPath. ":memory:" 허용
close(): void                                  // 커넥션 정리 (web이 요청마다 열고 닫는다)

saveReport(runId: string, markdown: string): void        // ★ 파일 경로 반환을 없앤다 — 더 이상 파일이 없다
loadReport(runId: string): string | null                 // ★ 신규. 다운로드 API가 DB에서 읽는다

deleteRun(runId: string): boolean                        // ★ 신규. 지웠으면 true, 없으면 false
createRerun(sourceRunId: string): RunState               // ★ 신규. 아래 규칙대로 포크
loadRunRecord(runId: string): { state: RunState; updatedAtMs: number } | null   // ★ 신규
```

`deriveRunStatus(state, updatedAtMs, nowMs?)` — 시그니처는 그대로지만 **두 번째 인자의 의미가 `state.json`의 파일 mtime → `runs.updated_at`의 epoch ms**로 바뀐다. 판정 순서(`completed` → `error` → `waiting` → `running`/`stalled`)와 `STALLED_THRESHOLD_MS = 15분`은 **한 글자도 바꾸지 마라**. 인자 이름과 주석만 갱신하라.

`loadRunRecord`는 web의 `getRunDetail`이 쓴다. 지금은 web이 `fs.statSync(state.json).mtimeMs`로 mtime을 얻어 `deriveRunStatus`에 넘기는데, DB에서는 `state`와 `updated_at`을 한 번에 읽어야 한다. `loadRun`이 throw하는 반면 `loadRunRecord`는 없으면 `null`이다(web은 404를 내야 하므로).

### 핵심 규칙 — 반드시 지킬 것

**1. `saveRun`은 UPDATE-only다** (ADR-014). INSERT는 `createRun`/`createRerun`만 한다.

`saveRun`이 존재하지 않는 `run_id`에 대해 호출되면 `RunNotFoundError`(named export)를 throw한다. `UPDATE runs SET ... WHERE run_id = ?`의 `changes`가 0이면 그 경우다.

이유: 사용자가 run을 삭제했는데 detached CLI 프로세스가 아직 살아 있을 수 있다. `saveRun`이 upsert면 그 프로세스가 삭제된 run을 **되살린다**. UPDATE-only면 좀비의 쓰기가 깨끗하게 실패하고 프로세스가 죽는다. **삭제의 안전성이 애플리케이션의 조심성이 아니라 저장 계층의 불변식으로 보장된다.**

`steps` 행은 `saveRun` 안에서 갱신한다(`RunState.steps[]` 전체를 매번 upsert). `artifacts`·`steps`는 FK가 `ON`이므로 삭제된 run에 대한 쓰기가 자동으로 실패한다.

**2. 모든 쓰기가 `runs.updated_at`을 갱신한다.** `saveRun`·`saveStepOutput`·`saveInterviewQuestions/Answers`·`saveResearchEvidence`·`saveReport` 전부. 이 값이 `stalled` 판정의 유일한 근거다. 빠뜨리면 실행 중인 run이 15분 뒤 "중단됨"으로 오탐된다.

**3. 읽기는 페일소프트다** (ADR-011). `loadStepOutput`·`loadInterviewQuestions/Answers`·`loadResearchEvidence`·`loadReport`는 행이 없거나, JSON 파싱에 실패하거나, zod 검증에 실패하면 **throw하지 않고 `null`을 반환한다**. 지금 동작 그대로다. 구 run 하나가 목록·상세 전체를 죽이지 않는다.

**4. 산출물은 JSON 문자열로 통째로 저장한다** (ADR-014). `artifacts.content = JSON.stringify(data)`. 컬럼으로 쪼개지 마라.

**5. 한 번의 `saveRun`은 한 트랜잭션이다.** `runs` UPDATE와 `steps` upsert가 부분적으로만 반영되면 상태가 찢어진다. `db.exec("BEGIN")`/`COMMIT`/`ROLLBACK`으로 감싸라. `createRun`·`createRerun`·`deleteRun`도 마찬가지다.

### step ↔ artifact kind 매핑

현재 `STEP_OUTPUT_FILES: Record<PipelineStepName, string>`가 step 이름을 파일명으로 매핑한다. 이것을 `ArtifactKind`로의 매핑으로 바꿔라:

| `PipelineStepName` | `ArtifactKind` |
|---|---|
| `interviewer` | `questions` |
| `context-hunter` | `context` |
| `thesis` | `thesis` |
| `cold-critic` | `criticism` |
| `solution-designer` | `solution` |
| `verdict` | `verdict` |

`answers`·`research`·`report`는 step 산출물이 아니므로 **이 맵에 넣지 마라** (기존 코드의 주석이 그 이유를 설명한다 — `PipelineStepName`과의 1:1 대응이 깨진다).

파일 시대의 잔재(`STEP_OUTPUT_FILES`의 파일명, `STATE_FILE`, `REPORT_FILE`, `ANSWERS_FILE`, `RESEARCH_FILE`, `atomicWriteFileSync`)는 전부 제거하라. 단 `STEP_OUTPUT_FILES`라는 이름을 다른 파일이 import하고 있는지 먼저 grep하라.

### `createRerun(sourceRunId)` 규칙 (ADR-015)

원본을 덮어쓰지 않고 **새 run으로 포크**한다.

1. 원본이 없으면 `RunNotFoundError`.
2. 새 `run_id` 생성 — 기존 `slugify` + timestamp + random suffix 규칙 **그대로**.
3. `runs` INSERT: `idea`·`interview`를 원본에서 복사, `rerun_of = sourceRunId`, `created_at`/`updated_at` = now, `completed_at` = NULL.
4. `steps` seed: 원본과 **같은 step 이름 집합**(`interview`가 false면 `interviewer`가 없다)을 `pending`으로.
   - **예외**: 원본에 `questions` 아티팩트가 실제로 존재할 때만 `interviewer`를 `completed`(+`completed_at` = now)로 seed한다. 없으면 `pending`이다(인터뷰 도중 실패한 run을 포크하는 경우 — 질문이 없는데 완료로 표시하면 orchestrator가 답변 없이 진행한다).
5. `artifacts`: 원본의 **`questions`와 `answers`만** 복사한다. `research`·`context`·`thesis`·`criticism`·`solution`·`verdict`·`report`는 **복사하지 않는다** — 자료조사부터 새로 도는 것이 이 기능의 존재 이유다.
6. 새 `RunState`를 반환한다.

**이 seed 조합이면 orchestrator는 코드 변경 없이 의도대로 동작한다**: `src/pipeline/orchestrator.ts`의 인터뷰 분기에서 `loadInterviewAnswers`가 답변을 찾아 `answers !== null` 경로를 타고, `interviewer`를 완료로 둔 채 `formatClarifications`로 답변을 프롬프트에 주입한 뒤, `pending`인 `context-hunter`부터 새로 수집한다. 인터뷰 질문을 **다시 묻지 않는다**. 이 동작을 반드시 테스트로 못박아라(step 3에서 orchestrator와 함께 검증한다).

### `listRuns`

`created_at DESC` 정렬은 **SQL이 한다**(`ORDER BY created_at DESC`). 상태는 `deriveRunStatus(state, updatedAtMs, nowMs)`로 **코드가 파생한다**.

**판정 규칙을 SQL로 복제하지 마라.** `completed_at IS NOT NULL`, `EXISTS(SELECT 1 FROM steps WHERE status='error')` 같은 WHERE 절로 상태를 계산하고 싶은 유혹이 있겠지만, 그러면 판정 규칙이 `deriveRunStatus`와 SQL 두 곳에 존재하게 되고 **반드시 갈라진다**. `deriveRunStatus`가 상태의 유일한 권위다.

손상된 행(zod 검증 실패)은 목록에서 `continue`로 건너뛴다 — 기존 `listRuns`와 같은 태도다.

`RunSummary`에 `rerunOf?: string`을 추가하라(step 7의 UI가 쓴다).

### 테스트 (`src/lib/runStore.test.ts`) — TDD, 먼저 쓴다

기존 52개 케이스의 **의도를 전부 이식**하라. 파일시스템 전제(`fs.mkdtempSync` + `baseDir`)는 tmp 디렉토리의 DB 파일 또는 `:memory:`로 바꾼다. 최소한 추가로 검증할 것:

- **`saveRun`이 UPDATE-only다**: `createRun` 없이 임의의 `RunState`로 `saveRun`을 부르면 `RunNotFoundError`. 그리고 **`deleteRun` 후 `saveRun`을 부르면 throw한다**(좀비 프로세스 시나리오 — 이 테스트가 ADR-015의 안전성 근거다).
- **`deleteRun`이 CASCADE한다**: 삭제 후 `loadRun`이 throw하고, `loadStepOutput`·`loadReport`가 `null`이며, `steps`·`artifacts` 테이블에 그 `run_id`의 행이 남지 않는다.
- **`deleteRun`이 없는 run에 대해 `false`를 반환한다**(throw하지 않는다).
- **원본을 지워도 재실행 run은 살아남는다**: `createRerun` 후 원본 `deleteRun` → 새 run의 `loadRun`이 성공하고 `rerunOf`가 `undefined`/`null`이다(`ON DELETE SET NULL`).
- **`createRerun`이 questions·answers만 복사한다**: 새 run에서 `loadInterviewQuestions`/`loadInterviewAnswers`는 원본과 같은 값을 주고, `loadStepOutput(context-hunter)`·`loadResearchEvidence`·`loadReport`는 **`null`**이다.
- **`createRerun`이 `interviewer`를 completed로 seed한다** — 단 원본에 questions가 있을 때만. 없으면 `pending`.
- **모든 쓰기가 `updated_at`을 민다**: `saveStepOutput` 후 `loadRunRecord().updatedAtMs`가 증가한다.
- **`deriveRunStatus`의 5개 분기**가 전부 유지된다(기존 테스트 이식).
- **손상 데이터 페일소프트**: `artifacts.content`에 깨진 JSON을 직접 INSERT해도 `loadStepOutput`이 `null`을 반환하고 throw하지 않는다.

## Acceptance Criteria

이 step은 호출부를 고치지 않으므로 전체 빌드가 깨진다. **부분 AC를 쓴다**:

```bash
npx vitest run src/lib/runStore.test.ts src/lib/db.test.ts   # 반드시 전부 통과
npx tsc --noEmit src/lib/runStore.ts 2>&1 | grep -v "orchestrator\|cli/index\|web/" || true
npm run lint                                                  # 통과
```

`npm run build`·`npm test` 전체는 **step 3에서 초록으로 되돌린다**. 이 step의 index.json `summary`에 "orchestrator·cli·web이 아직 구 시그니처를 참조해 빌드가 깨진 상태이며 step 3에서 해소된다"고 명시하라.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `npm run build`가 실패한다면, **실패 원인이 오직 `src/pipeline/orchestrator.ts`·`src/cli/index.ts`·`web/`의 구 시그니처 참조인지** 확인하라. 그 외의 에러가 하나라도 있으면 이 step의 버그다.
3. 아키텍처 체크리스트:
   - `saveRun`이 INSERT를 하지 않는가? (`grep -n "INSERT" src/lib/runStore.ts`로 확인 — INSERT는 `createRun`·`createRerun`·아티팩트 upsert에만 있어야 한다)
   - 상태 판정 규칙이 SQL WHERE 절에 복제되지 않았는가?
   - `artifacts.content`가 JSON 문자열 통째로 저장되는가? (컬럼 분해 없음)
   - CLAUDE.md CRITICAL: 외부 API 호출 없음, zod 검증 유지.
4. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."` (다음 step이 쓸 정보: 바뀐 시그니처 목록, `RunNotFoundError`, 빌드가 깨진 상태라는 것)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`saveRun`을 upsert(`INSERT OR REPLACE`, `ON CONFLICT DO UPDATE`)로 만들지 마라.** 이유: 삭제된 run을 좀비 CLI 프로세스가 되살린다. UPDATE-only가 ADR-015 삭제 안전성의 유일한 구조적 근거다.
- **`src/pipeline/orchestrator.ts`, `src/cli/index.ts`, `web/`을 수정하지 마라.** 이유: step 3·5의 scope다. 저장소와 호출부를 같은 step에서 바꾸면 회귀 원인을 분리할 수 없다.
- **`deriveRunStatus`의 판정 순서나 15분 임계값을 바꾸지 마라.** 이유: `STALLED_THRESHOLD_MS`는 가장 긴 step(context-hunter 최악 6분)과 암묵적으로 결합돼 있다. 인자의 출처만 mtime → `updated_at`으로 바뀐다.
- **에이전트 산출물을 컬럼으로 정규화하지 마라.** 이유: ADR-014. 에이전트 스키마는 자주 바뀐다(ADR-011, ADR-013). DB는 바이트를, zod는 의미를 소유한다.
- **읽기 함수를 throw로 바꾸지 마라.** 이유: ADR-011 — 구 run 하나가 목록 전체를 죽이면 안 된다. `loadRun`만 예외적으로 throw한다(기존 동작).
- **`createRerun`이 `context`/`research`/`report` 아티팩트를 복사하게 하지 마라.** 이유: 재실행의 존재 이유가 "다시 자료조사"다. 복사하면 resume과 같아진다.
- 기존 테스트의 **의도**를 버리지 마라. 파일시스템 전제만 바꾸고 검증 대상은 그대로 이식하라.
