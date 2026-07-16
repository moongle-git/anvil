# Step 1: remedy-schema

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-017**(이전 step이 방금 썼다. 이 step은 그 헌법의 구현이다), ADR-010, ADR-011, ADR-013
- `/docs/ARCHITECTURE.md`, `/CLAUDE.md`
- `src/types/dialectic.ts` — `DIALECTIC_AXES`, `SEVERITY_SCORE_BANDS`, `isWithinBand`, `coversAllAxes`, `hasUniqueIds`. **이 파일이 이번 step이 따를 선례다** — 순수 파생 헬퍼와 라벨 상수가 `types/`에 사는 방식.
- `src/types/criticism.ts` — 특히 `15~19행`의 `rebuts` 주석("존재 여부는 검증하지 않는다 — CriticismSchema는 Thesis를 모른다")
- `src/types/solution.ts`, `src/types/verdict.ts`, `src/types/thesis.ts`, `src/types/index.ts`
- `src/services/gemini.ts` — `generateStructured`의 `schema` 파라미터 타입이 `ZodType<T>`라는 것과, `generateValidated`의 재시도 루프가 `z.prettifyError(result.error)`를 프롬프트에 되먹인다는 것을 눈으로 확인하라. **이 step의 설계가 그 사실에 의존한다.**
- 테스트 선례: `src/types/*.test.ts` (있는 것 아무거나)

## 배경

**요구사항: 비판이 `severity: "fatal"`로 판정한 항목은 재설계가 전부 해결책을 내야 한다.** 지금은 프롬프트에 부탁만 있고(`solutionDesigner.ts:38-41`) 검증이 없어서, 실측 5개 run 중 3개가 비판 ID를 언급조차 하지 않았다.

이 step은 **교차 산출물 검증을 스키마 팩토리로 만든다.** 코드가 소유하는 것은 **침묵**(재설계가 어떤 fatal에 대해 아무 말도 하지 않음)과 **참조 무결성**뿐이다. "이 해결책이 유효한가"는 판단이며 판정 에이전트에 남는다 (ADR-017).

### 왜 팩토리인가

`generateStructured`는 이미 `schema: ZodType<T>`를 받는다. **상류 산출물을 클로저로 잡은 팩토리도 여전히 `ZodType<T>`다.** 따라서:
- 새 레이어 0개, `GeminiService` 변경 0줄
- ADR-004의 자가 교정 재시도 루프를 **그대로 탄다** — `z.prettifyError`가 `ctx.addIssue` 커스텀 메시지에 대해 기존 밴드 위반 피드백과 형태가 같다
- orchestrator에 validator를 두면 `generateStructured`가 **반환한 뒤** 돌기 때문에 재시도가 안 붙는다

의존 방향의 원칙 (ADR-017):

> **하류 산출물의 스키마는 상류를 알 수 있다. 상류는 하류를 모른다.** 의존은 파이프라인이 흐르는 방향으로만 흐른다.

`solution.ts`가 `criticism.ts`를 import하는 것은 이 원칙에 부합한다(파이프라인이 criticism → solution 순). 순환은 생기지 않는다. `criticism.ts:15-19`의 "CriticismSchema는 Thesis를 모른다"는 규칙은 **정적 스키마에 대한 진술**이므로 그대로 유효하다.

## 작업

### 1. `src/types/solution.ts`

```ts
export const REMEDY_STRATEGIES = ["defend", "bypass"] as const;
export const RemedyStrategySchema = z.enum(REMEDY_STRATEGIES);
export type RemedyStrategy = z.infer<typeof RemedyStrategySchema>;

/** 한국어 라벨 단일 소스 — 리포트·웹이 함께 쓴다 */
export const REMEDY_STRATEGY_LABELS: Record<RemedyStrategy, string> = {
  defend: "방어",  // 결함이 지적한 취약점을 구조적으로 제거한다
  bypass: "우회",  // 결함이 성립하는 전장을 떠나, 같은 자산으로 다른 가치를 판다
};

export const RemedySchema = z.object({
  /** 해결 대상 CriticismPoint.id. 존재 여부는 solutionSchemaFor(criticism)가 검증한다 */
  respondsTo: z.string().min(1),
  strategy: RemedyStrategySchema,
  /** 이 결함을 어떻게 푸는가 — 구체적인 해결책 */
  remedy: z.string().min(1),
});
export type Remedy = z.infer<typeof RemedySchema>;

export const SolutionSchema = z.object({
  minimalInput: z.string().min(1),
  agenticWorkflow: z.string().min(1),
  dataFlywheel: z.string().min(1),
  monetization: z.string().min(1),
  revisedConcept: z.string().min(1),
  synthesis: z.string().min(1),                 // ← .optional() 제거
  remedies: z.array(RemedySchema).default([]),  // 정적 스키마는 관대 — 팩토리가 강제한다
});

/**
 * criticism을 아는 solution 스키마. 하류가 상류를 안다 (ADR-017).
 * 여기서만 fatal 전건 커버리지를 강제한다 — 정적 SolutionSchema는 관대해야 웹 읽기 경로가 산다.
 */
export function solutionSchemaFor(criticism: Criticism): ZodType<Solution>
```

`solutionSchemaFor`의 superRefine 3가지:
1. 모든 `respondsTo` ∈ `criticism.points[].id` (참조 무결성)
2. `respondsTo` 중복 없음
3. **`severity === "fatal"`인 모든 point가 `remedies`에 등장** ← 침묵 금지

**점수 규칙을 넣지 마라.** 재설계는 채점하지 않는다 (ADR-010).

### 2. `src/types/verdict.ts`

```ts
export const REMEDY_VERDICTS = ["solid", "restated", "dismissed"] as const;
export const RemedyVerdictSchema = z.enum(REMEDY_VERDICTS);
export type RemedyVerdict = z.infer<typeof RemedyVerdictSchema>;

export const REMEDY_VERDICT_LABELS: Record<RemedyVerdict, string> = {
  solid: "유효한 해결책",
  restated: "재주장",     // 비판이 이미 반박한 것을 수식어만 붙여 다시 제시
  dismissed: "비판 기각",  // 풀지 않고 비판이 과장이라며 넘김
};

export const RemedyAuditSchema = z.object({
  criticismId: z.string().min(1),
  assessment: RemedyVerdictSchema,
  note: z.string().min(1),
});
export type RemedyAudit = z.infer<typeof RemedyAuditSchema>;

export const ResidualRiskSchema = z.object({
  keyword: z.string().min(1),
  severity: CriticismSeveritySchema,
  note: z.string().min(1),
  /** 어느 비판에서 유래했는가. 피벗이 새로 만든 리스크면 생략한다 */
  criticismId: z.string().min(1).optional(),
});

export const VerdictSchema = z.object({
  ...기존 필드,
  remedyAudits: z.array(RemedyAuditSchema).default([]),
})
  .refine(기존 밴드 일치 규칙);   // 유지. floor 없음.

export function verdictSchemaFor(criticism: Criticism): ZodType<Verdict>
```

`verdictSchemaFor`의 superRefine: `remedyAudits[].criticismId`에 대해 위 1·2·3을 동일 적용. **점수 규칙 없음.**

### 3. `src/types/ledger.ts` (신규)

프롬프트·리포트·웹이 공유할 **순수 파생**. `dialectic.ts`의 선례를 따른다.

```ts
export interface LedgerEntry {
  point: CriticismPoint;                                  // 비판 원문
  remedy?: { strategy: RemedyStrategy; remedy: string };  // undefined = 재설계의 침묵
  audit?: { assessment: RemedyVerdict; note: string };    // undefined = 판정 이전
}

/** fatal 우선 정렬. unknown id는 조용히 드롭한다 (throw 금지) */
export function buildLedger(
  criticism: Criticism,
  solution?: Solution,
  verdict?: Verdict,
): LedgerEntry[];
```

### 4. `src/types/index.ts`

새 export 배선.

## 불변식 — 어기면 이 phase가 무너진다

- **정적 `SolutionSchema`·`VerdictSchema`는 관대하게 유지한다** (`.default([])`). 엄격하게 만들면 최신 run 5개가 웹에서 조용히 빈 화면이 된다. **엄격함은 팩토리에만 산다.**
- **`solutionSchemaFor`에 점수·판정 규칙을 넣지 마라.** 재설계가 점수를 통제하면 ADR-010 위반이다.
- **floor(잔존 fatal → 40점 미만)를 넣지 마라.** ADR-017이 기각했다.
- **`buildLedger`는 unknown id를 드롭하되 throw하지 마라.** `report.ts`의 dangling `rebuts` 처리와 같은 태도다.
- **모든 superRefine 메시지는 문제의 id를 이름으로 지목해야 한다** — 예: `"c5에 대한 해결책이 없다. 비판이 fatal로 판정한 항목은 전부 remedies에 등장해야 한다"`. 이유: 이 메시지가 `z.prettifyError`로 재시도 프롬프트에 되먹여지는 **유일한 지렛대**다. "검증 실패" 같은 메시지는 모델이 고칠 수 없다.

## 필수 테스트 (TDD — 먼저 쓴다)

- fatal이 `remedies`에 없으면 팩토리가 **실패**한다
- major가 `remedies`에 없어도 팩토리가 **통과**한다 (major는 강제하지 않는다)
- dangling `respondsTo`(`"c99"`)는 실패한다
- `respondsTo` 중복은 실패한다
- 에러 메시지에 문제의 id가 들어 있다
- `z.toJSONSchema(solutionSchemaFor(c))`가 **throw하지 않는다** (refinement는 생략된다 — grounded가 아닌 structured 경로가 이걸 쓴다)
- **실제 최신 run fixture(원장 없음)가 정적 `SolutionSchema`·`VerdictSchema`를 통과한다** ← 하위호환의 안전벨트
- fatal 0건인 criticism이면 팩토리가 공허하게 통과한다 (강제할 것이 없다)
- `buildLedger`가 fatal을 앞에 정렬하고, unknown id에 throw하지 않는다

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`ledger.ts`가 `types/`에)
   - `types/`가 `services/`·`lib/db`를 import하지 않는가?
   - ADR-017에 적힌 스키마와 **글자 그대로 일치**하는가?
   - CLAUDE.md CRITICAL 규칙 위반이 없는가?
3. `phases/8-fatal-remedy/index.json`의 step 1을 업데이트한다. summary에 **확정된 필드명·enum 값·팩토리 시그니처**를 적어라 — step 2·3의 프롬프트가 이 이름을 글자 그대로 써야 한다.

## 금지사항

- **에이전트·orchestrator·리포트·웹을 건드리지 마라.** 이유: 이 step은 타입 레이어만이다. 배선은 step 2~4, 렌더는 step 5~6이다.
- **`SolutionSchema`·`VerdictSchema`를 정적으로 엄격하게 만들지 마라.** 이유: 최신 run 5개가 웹에서 빈 화면이 된다. 관대한 읽기 / 엄격한 쓰기는 설계다.
- **`rebuts`에 검증을 추가하지 마라.** 이유: dangling ref가 실측 0건이다. 측정된 문제가 없는데 검증을 붙이면 새 재시도 실패만 산다 (ADR-016).
- **`CriticismSchema`·`ThesisSchema`를 수정하지 마라.** 이유: 상류는 하류를 모른다. `severity`는 상류에서 동결되어야 판정이 세탁하지 못한다.
- **기존 테스트를 깨뜨리지 마라.**
