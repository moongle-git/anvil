# Step 2: usage-store

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-016**(결정 1: usage는 `artifacts`가 아니라 별도 테이블)과 **ADR-014**(스키마·PRAGMA·`schema_version`에 마이그레이션 러너를 두지 않는다는 결정)
- `/docs/ARCHITECTURE.md` — DB 스키마 블록
- `src/lib/db.ts` — 기존 DDL·PRAGMA·`openDb`. **이 파일에 테이블 하나를 더한다.**
- `src/lib/db.test.ts` — 기존 스키마 테스트 방식(PRAGMA 실측, FK 위반, CASCADE)을 그대로 따를 것
- `src/lib/runStore.ts` — `RunStore`의 기존 메서드 모양(트랜잭션, UPDATE-only `saveRun`, 페일소프트 읽기)
- `src/lib/runStore.test.ts` — tmp DB 파일 + 별도 raw 커넥션으로 검증하는 패턴
- `src/lib/cost.ts` (step 1 산출물) — `CallUsage` 타입과 `estimateCostUsd`

## 배경

이 step은 **저장 계층만** 만든다. `GeminiService`와의 배선은 step 3이다.

`usage`는 에이전트 산출물이 아니라 **관측 데이터**다(ADR-016 결정 1). 그래서 `artifacts`에 넣지 않는다 — `artifacts`의 PK는 `(run_id, kind)`인데 **재시도 때문에 한 step에 usage 행이 여러 개** 생기므로 PK 제약과 정면으로 충돌한다.

## 작업

### 1. `src/lib/db.ts` — `usage` 테이블 추가

```sql
CREATE TABLE IF NOT EXISTS usage (
  run_id         TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  label          TEXT NOT NULL,              -- 에이전트 이름 (thesis, cold-critic, …)
  model          TEXT NOT NULL,
  grounded       INTEGER NOT NULL,           -- 0|1. 토큰과 별개로 요청당 정액 과금된다
  attempt        INTEGER NOT NULL,           -- 1부터. 재시도한 시도도 과금되므로 행이 여러 개다
  prompt_tokens  INTEGER NOT NULL,
  cached_tokens  INTEGER NOT NULL,           -- prompt_tokens에 이미 포함된 값이다 (중복 아님)
  output_tokens  INTEGER NOT NULL,
  thoughts_tokens INTEGER NOT NULL,          -- thinking. 출력 요금으로 과금된다 (ADR-016)
  total_tokens   INTEGER NOT NULL,
  cost_usd       REAL NOT NULL,              -- 추정치다. 청구서가 아니다
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_run_id ON usage(run_id);
```

**PK를 만들지 마라.** 같은 `(run_id, label)`에 재시도 행이 여러 개 생기는 것이 정상이다. `(run_id, label, attempt)`도 PK로 쓰지 마라 — resume·rerun에서 같은 label이 다시 실행되면 attempt가 1부터 다시 시작해 충돌한다.

`schema_version`을 **2로 올려라.** 단 **마이그레이션 러너를 만들지 마라** — ARCHITECTURE가 "기록만 하고 러너는 두지 않는다"고 못박았고, DDL이 전부 `IF NOT EXISTS`라 기존 `data/anvil.db`에 테이블만 추가된다. 기존 행에 대한 변환이 없으므로 러너가 할 일이 없다. `schema_version`에 이미 행이 있으면 UPDATE로 2를 쓰고, 없으면 INSERT하라(멱등).

`usage`는 `runs`를 FK로 참조하므로 **run 삭제 시 CASCADE로 함께 사라진다**(ADR-015). 이것이 의도다.

### 2. `src/lib/runStore.ts` — 저장·조회

```ts
/** 한 run의 usage 집계. 없으면 전부 0 / 빈 배열 */
export interface RunUsageSummary {
  runId: string;
  totalCostUsd: number;
  totalTokens: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  /** thinking이 출력 요금에서 차지하는 비중 (0~1). 출력이 0이면 0 */
  thoughtsRatio: number;
  groundedCalls: number;
  totalCalls: number;
  /** 재시도로 낭비된 호출 수 (= totalCalls - 성공한 label 수). 재시도가 비싼지 한눈에 본다 */
  retryCalls: number;
  /** label별 집계. 비싼 순 내림차순 */
  byLabel: LabelUsage[];
}

export interface LabelUsage {
  label: string;
  calls: number;
  costUsd: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
}

class RunStore {
  /** usage 한 행을 append한다. cost_usd는 estimateCostUsd로 계산해 넣는다 */
  saveUsage(runId: string, usage: CallUsage): void;

  /** run의 usage를 집계한다. 행이 없으면 0으로 채운 요약을 돌려준다(null이 아니다) */
  loadRunUsage(runId: string): RunUsageSummary;
}
```

**반드시 지킬 것:**

- `saveUsage`는 **append-only**다. UPSERT하지 마라 — 재시도 행을 덮어쓰면 그 비용이 사라진다.
- `saveUsage`도 **`runs.updated_at`을 갱신한다** (ARCHITECTURE "모든 쓰기는 `runs.updated_at`을 갱신한다"). 다만 **`saveRun`처럼 UPDATE-only 에러를 던지지는 마라** — 삭제된 run에 대한 usage 쓰기는 **조용히 무시**하라. 이유: 계측 실패가 파이프라인을 죽이면 안 된다(ADR-016). FK CASCADE로 이미 지워진 run에 usage를 쓰려는 좀비는 그냥 아무 일도 일으키지 않으면 된다.
- `loadRunUsage`는 **`null`을 반환하지 않는다.** usage 행이 없는 구 run은 0으로 채운 요약을 받는다 — 호출자가 `null` 분기를 만들 필요가 없다.
- 집계는 **SQL로** 하라(`SUM`·`GROUP BY`). 행을 전부 읽어 JS에서 더하지 마라.
- `retryCalls`: `totalCalls - (DISTINCT label 수)`. 정확히는 "label당 첫 시도를 제외한 나머지"다. 재시도가 없으면 0이다.

### 3. 테스트 — TDD, 먼저 쓴다

`src/lib/db.test.ts`에 추가:
- `usage` 테이블과 `idx_usage_run_id` 인덱스가 생성된다.
- **FK가 살아 있다**: 존재하지 않는 `run_id`로 usage INSERT → 실패.
- **CASCADE**: run을 지우면 그 run의 usage 행이 함께 사라진다.
- `schema_version`이 2다. 기존 v1 DB를 다시 열어도 에러 없이 2로 올라가고 **기존 데이터가 보존된다**(멱등 — 이 테스트가 없으면 실제 `data/anvil.db`가 날아갈 수 있다).

`src/lib/runStore.test.ts`에 추가:
- `saveUsage` → `loadRunUsage` 왕복. `cost_usd`가 `estimateCostUsd`와 일치한다.
- **★ 같은 label로 3번 저장하면 행이 3개 남고 `calls: 3`, 비용이 3배다** (append-only — 재시도가 장부에서 사라지지 않는다).
- usage 행이 없는 run → 0으로 채운 요약(`null` 아님).
- `thoughtsRatio` 계산이 맞다. 출력 0이면 0(0으로 나누지 않는다).
- `byLabel`이 비용 내림차순이다.
- `saveUsage`가 `runs.updated_at`을 민다.
- **삭제된 run에 `saveUsage`를 호출해도 throw하지 않는다** (조용히 무시).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **실제 DB가 안전한지 확인하라 — 백업을 뜬 사본으로 검증하고, 사용자의 `data/anvil.db`를 직접 건드리지 마라.**
   ```bash
   cp data/anvil.db /tmp/anvil-check.db
   # 코드로 openDb('/tmp/anvil-check.db') 를 한 번 호출한 뒤:
   sqlite3 /tmp/anvil-check.db "SELECT COUNT(*) FROM runs; SELECT version FROM schema_version;"
   # → run 수가 그대로 보존되고, version이 2여야 한다
   sqlite3 /tmp/anvil-check.db ".schema usage"
   rm /tmp/anvil-check.db
   ```
   기존 run이 하나라도 사라지면 **즉시 error로 중단하라.**
3. `git diff --stat`으로 `src/services/`·`src/agents/`·`src/pipeline/`·`web/`이 변경되지 않았음을 확인한다.
4. 아키텍처 체크리스트:
   - ADR-016·ARCHITECTURE에 적힌 DDL과 **글자 그대로 일치**하는가?
   - 마이그레이션 러너를 만들지 않았는가?
   - `usage`에 PK를 걸지 않았는가?
5. `phases/7-cost-control/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 **`saveUsage`·`loadRunUsage` 시그니처와 `RunUsageSummary` 필드**를 적어라 (step 3의 CLI 요약 출력이 그대로 쓴다)

## 금지사항

- **`usage`에 PRIMARY KEY를 걸지 마라.** 이유: 재시도 때문에 같은 `(run_id, label)`에 행이 여러 개 생기는 것이 **정상이다.** PK를 걸면 재시도 비용이 UPSERT로 덮여 사라지거나 INSERT가 실패한다.
- **`saveUsage`를 UPSERT로 만들지 마라.** append-only다. 이유: 위와 같다.
- **마이그레이션 러너를 만들지 마라.** 이유: ARCHITECTURE가 명시적으로 금지했고, `IF NOT EXISTS` 증분 추가라 변환할 기존 데이터가 없다.
- **`artifacts` 테이블에 `kind='usage'`를 추가하지 마라.** 이유: ADR-016 결정 1 — `artifacts`는 에이전트 산출물이고 PK가 `(run_id, kind)`다. 재시도 행 여러 개가 들어갈 자리가 없다.
- **`saveUsage`가 삭제된 run에서 throw하게 만들지 마라.** 이유: 계측 실패가 파이프라인을 죽이면 안 된다. `saveRun`의 UPDATE-only 에러 규칙(ADR-014/015)은 **상태**를 지키기 위한 것이고, usage는 관측치다 — 좀비의 usage 쓰기는 잃어도 그만이다.
- **`src/services/gemini.ts`를 수정하지 마라.** 이유: step 1에서 이미 끝났고, 배선은 step 3이다.
- 기존 테스트를 깨뜨리지 마라.
