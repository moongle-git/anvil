# Step 0: scout-types

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` — 특히 **ADR-013**(출처는 판단이 아니라 사실이다), **ADR-017**(교차 산출물 검증은 스키마 팩토리다)
- `/docs/PRD.md`
- `src/types/index.ts` — 배럴 export
- `src/types/run.ts` — `PIPELINE_STEPS`, `RunStateSchema`
- `src/types/marketContext.ts` — `CitationSchema`, `MarketContextDraftSchema`(draft/최종 분리 패턴의 선례)
- `src/types/solution.ts` — **`solutionSchemaFor(criticism)`**. 이번 step의 스키마 팩토리가 따라야 할 선례다
- `src/types/interview.ts` — 사람이 제출하는 아티팩트 스키마의 선례
- `src/lib/db.ts` — `ARTIFACT_KINDS`
- `src/lib/runStore.ts` — `STEP_ARTIFACT_KINDS`

## 배경

이 phase는 "사용자가 아이디어를 입력한다"는 전제를 깬다. `trend-scout` step이 **현재 자본이 이동하는 방향**을 근거로 사업 주제 후보를 3~5개 제시하고, 사용자가 하나를 고르면 그것이 `runs.idea`로 확정되어 기존 파이프라인이 그대로 돈다.

이 step은 그 phase의 **모든 zod 스키마**를 만든다. 에이전트도 저장소도 건드리지 않는다.

### 핵심 설계: 환각 방어는 프롬프트가 아니라 스키마다

`trend-scout`은 "돈이 어디로 흐르는가"를 판단한다. 여기가 파이프라인에서 환각 위험이 가장 높다 — 모델이 훈련 데이터의 과거 트렌드를 현재로 착각해 뱉고, 그럴듯한 숫자와 URL을 지어낸다.

그래서 **코드가 검사할 수 있는 것은 전부 스키마 제약으로 만든다.** 검증 실패는 ADR-004의 자가 교정 재시도를 그대로 타므로(에러 메시지가 곧 재시도 피드백이다), 제약을 어긴 산출물은 다음 step으로 넘어가지 못한다.

**단, 코드가 보장할 수 있는 것과 없는 것을 혼동하지 마라:**
- 보장 가능 — 모든 주장이 **실제로 검색된 문서를 가리키는가**
- 보장 불가 — 그 문서가 **정말 그 말을 하는가**

후자를 스키마로 잡으려 들지 마라. ADR-013이 "주입할 사실이 없는 판단은 코드가 소유하지 않는다"고 정한 경계다.

## 작업

### 1. `src/types/opportunity.ts` 신규 생성

#### 신호 분류

```ts
export const SIGNAL_TYPES = ["funding", "incumbent", "regulation", "costCurve"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
```

- `funding` — 섹터별 투자 라운드·M&A
- `incumbent` — 기존 기업의 capex 가이던스·실적발표 전략 언급
- `regulation` — **시행일이 확정된 규제**
- `costCurve` — 단가가 임계선을 넘은 시점

```ts
export const HORIZONS = ["short", "mid", "long"] as const;  // 단기 | 중기 | 장기
```

#### 수치 귀속

```ts
export const FigureSchema = z.object({
  value: z.string().min(1),        // 산문에 등장한 수치 표기 그대로 (예: "$4.2B", "23%")
  citationRef: z.string().min(1),  // "C3"
});
```

#### 자본 신호

```ts
export const CapitalSignalSchema = z.object({
  signalType: z.enum(SIGNAL_TYPES),
  statement: z.string().min(1),      // 이 신호가 말하는 사실 1~2문장
  observedAt: z.string(),            // ISO date. 이 사실이 보도·공시된 시점
  effectiveAt: z.string().optional(),// 규제 시행일 등. 미래여도 된다
  citationRef: z.string().min(1),
  figures: z.array(FigureSchema).default([]),
  quote: z.string().optional(),      // 출처에서 그대로 딴 문장 (step 2가 대조 가능 여부를 판단한다)
});
```

#### 후보 (draft / 최종 분리 — `MarketContextDraft` 선례)

LLM은 `citationRef`로만 지목하고, 실체는 코드가 채운다(ADR-013).

```ts
export const OpportunityDraftSchema = z.object({
  id: z.string().min(1),             // "O1" 등. 사용자 선택이 이 값을 지목한다
  title: z.string().min(1),
  whatItIs: z.string().min(1),       // 무엇을 만드는 서비스인가 1~2문장
  signals: z.array(CapitalSignalSchema).min(2),
  counterSignal: CapitalSignalSchema, // 이 주제에 불리한 증거. 필수다
  whyNow: z.string().min(1),         // 왜 지금인가 (타이밍)
  whoPays: z.string().min(1),        // 누가 돈을 내나
  horizon: z.enum(HORIZONS),
});
```

최종형 `OpportunitySchema`는 `citationRef` 대신 해소된 `CitationSchema` 객체를 갖는다. `MarketContextDraftSchema` → `MarketContextSchema`의 분리 방식을 그대로 따르되, 구조는 네가 정하라 — 요구사항은 **최종형에 `citationRef` 문자열이 남지 않는 것**뿐이다. ref는 dossier 내부 좌표이지 산출물이 아니다.

```ts
export const OpportunitiesSchema = z.object({
  candidates: z.array(OpportunitySchema).max(5),   // min 없음 — 빈 배열이 합법이다
  scope: z.string(),                                // 사용자가 준 범위 힌트 (없으면 "전 범위 탐색")
  searchedAt: z.string(),                           // ISO datetime
});
```

**`candidates: []`가 합법인 것은 실수가 아니라 장치다.** 빈손으로 돌아올 길이 없는 시스템에서 모델은 반드시 무언가를 내놓게 되고, 그때 나오는 것이 환각이다. 침묵할 수 있어야 지어내지 않는다. `min(1)`을 붙이지 마라.

#### 사용자 선택 아티팩트

```ts
export const OpportunitySelectionSchema = z.object({
  candidateId: z.string().min(1),
});
```

#### 검색어 행렬 · dossier (step 2·3이 쓴다)

```ts
export const ScoutQueriesSchema = z.object({
  funding: z.array(z.string()).min(1),
  incumbent: z.array(z.string()).min(1),
  regulation: z.array(z.string()).min(1),
  costCurve: z.array(z.string()).min(1),
});

export const ScoutDossierSchema = z.object({
  findings: z.array(z.object({
    signalType: z.enum(SIGNAL_TYPES),
    statement: z.string().min(1),
    observedAt: z.string().optional(),
  })).default([]),
});
```

`ScoutDossier`는 grounded 검색 단계의 산출물이다 — **후보가 아니라 사실 목록**이다. 여기서 후보를 만들게 하지 마라(step 2·3이 왜 갈렸는지의 이유다).

### 2. 스키마 팩토리 `opportunitiesSchemaFor` — 이 step의 본체

`solutionSchemaFor(criticism)`(`src/types/solution.ts`)를 읽고 같은 형태로 만들어라.

```ts
export interface ScoutConstraints {
  /** 코드가 grounding 응답에서 추출한 인용의 ID 집합 ("C1", "C2", …) */
  citationIds: readonly string[];
  /** 검증 기준 시각 */
  now: Date;
  /** observedAt의 하한 */
  windowStart: Date;
}

export function opportunitiesSchemaFor(
  constraints: ScoutConstraints,
): ZodType<OpportunitiesDraft>;
```

반환 타입이 `ZodType<...>`여야 ADR-004의 자가 교정 루프를 그대로 탄다. 검증을 에이전트 바깥으로 빼지 마라 — `generateStructured`가 반환한 **뒤**라 재시도가 붙지 않는다(ADR-017이 명시한 이유다).

강제할 제약 네 가지:

**(1) 인용 화이트리스트** — 모든 `citationRef`(`signals[].citationRef`, `counterSignal.citationRef`, `figures[].citationRef`)가 `constraints.citationIds` 안에 있어야 한다. 밖이면 실패. 에러 메시지에 **어떤 ref가 유효 목록 밖인지와 유효 목록 전체**를 적어라 — 재시도 프롬프트가 그 문장만 보고 고쳐야 한다.

**(2) 삼각측량** — 후보 하나의 `signals[]`는
- 서로 다른 `signalType`이 **2종 이상**이고
- 서로 다른 `citationRef`가 **2개 이상**이어야 한다.

두 조건을 **모두** 걸어라. `signalType`만 검사하면 같은 기사를 두 타입으로 라벨링해 우회한다. `counterSignal`은 이 계산에 넣지 않는다.

**(3) 날짜** — 모든 `CapitalSignal`에 대해 `observedAt`이 파싱 가능한 날짜이고 `windowStart <= observedAt <= now`. `effectiveAt`은 미래여도 통과시켜라(시행 예정 규제가 가장 가치 있는 신호다). 이 제약의 목적은 형식 검사가 아니라 **검색 없이는 채울 수 없는 필드를 만드는 것**이다 — 모델의 사전지식에는 날짜가 붙어 있지 않다.

**(4) 수치 귀속** — `statement` 산문에 금액·퍼센트 표기가 있으면 그 표기가 `figures[]`의 `value` 중 하나에 대응해야 한다.
- 정규식은 **좁게** 잡아라: 통화기호(`$` `₩` `€` `¥`), 통화 단위(`억` `조` `million` `billion` 등), 퍼센트(`%`)가 붙은 수치만.
- `"3가지"`, `"2배"`, `"1~2문장"`, 연도(`"2026년"`)에 걸리면 **안 된다**. 오탐은 무한 재시도를 만든다.
- 테스트는 양방향을 모두 덮어라 — 잡아야 할 것(`"$4.2B가 유입됐다"`에 `figures`가 없으면 실패)과 잡으면 안 되는 것(`"3가지 축에서 2배로 늘었다"`는 통과).

### 3. `src/types/run.ts` 수정

- `PIPELINE_STEPS` **맨 앞**에 `"trend-scout"` 추가. 이 배열 순서가 `steps.ordinal`이 되므로 순서가 곧 파이프라인 순서다.
- `RunStateSchema`에 `scout: z.boolean().optional().default(false)` 추가.
  - **`runs` 테이블에 `scout` 컬럼을 만들지 마라.** `src/lib/db.ts`의 DDL은 전부 `CREATE TABLE IF NOT EXISTS`라 **기존 DB에 컬럼이 추가되지 않는다.** `usage` 추가가 무사했던 것은 통째로 새 테이블이었기 때문이다. ADR-014가 마이그레이션 러너를 금지했으므로 러너를 만드는 것도 답이 아니다.
  - `scout`은 `steps`에 `trend-scout` 행이 있는지로 **파생**한다. 파생 로직 자체는 step 1이 배선한다.

### 4. 배럴 export

`src/types/index.ts`에 `export * from "./opportunity.js";` 추가.

### 5. 빌드를 깨지 않기 위한 최소 수정 (여기까지만)

`PIPELINE_STEPS`에 항목이 늘면 아래 두 곳이 컴파일 에러가 난다. **키만 채워라. CRUD 메서드는 step 1의 일이다.**

- `src/lib/db.ts`의 `ARTIFACT_KINDS` — `"opportunities"`, `"selection"` 추가
- `src/lib/runStore.ts`의 `STEP_ARTIFACT_KINDS` — `"trend-scout": "opportunities"` 추가

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint
```

`src/types/opportunity.test.ts`를 **먼저** 작성하고 통과시켜라(TDD — CLAUDE.md). 최소한 아래를 덮어라:

- 화이트리스트 밖 `citationRef` → 실패, 에러 메시지에 해당 ref가 등장
- `signalType`이 1종뿐 → 실패
- `signalType`은 2종이지만 `citationRef`가 동일 1개 → **실패** (라벨 우회 차단)
- `observedAt`이 미래 / `windowStart` 이전 → 실패
- `effectiveAt`이 미래 → **통과**
- 귀속 없는 금액·퍼센트가 `statement`에 있음 → 실패
- `"3가지 축에서 2배"`, `"2026년"` → 통과 (오탐 없음)
- `candidates: []` → **통과**

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

- **`runs` 테이블에 `scout` 컬럼을 추가하지 마라.** 이유: DDL이 `CREATE TABLE IF NOT EXISTS`뿐이라 기존 DB에 반영되지 않고, 마이그레이션 러너는 ADR-014가 금지한다.
- **`candidates`에 `min(1)`을 붙이지 마라.** 이유: 빈 결과가 불법이면 모델은 반드시 무언가를 내놓게 되고 그것이 환각이다.
- **후보에 점수·순위·랭킹 필드를 넣지 마라.** 이유: ADR-010이 판정자를 분리한 근거와 같다. 파이프라인 완주 전에 결론이 나오면 `verdict`가 할 일이 없어진다.
- **"이 해결책/주제가 유효한가"를 스키마로 판정하려 들지 마라.** 이유: 주입할 사실이 없다(ADR-013). 코드는 귀속·참조 무결성·구조만 소유한다.
- **`src/agents/`·`src/lib/runStore.ts`의 CRUD·`src/pipeline/`을 건드리지 마라.** 이유: 이 step의 scope는 타입 레이어다. 위 5번의 두 줄만 예외다.
- 기존 테스트를 깨뜨리지 마라.
