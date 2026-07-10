# Step 1: dialectic-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` — 특히 ADR-010(verdict step 분리), ADR-011(Criticism 평탄화)
- `/docs/PRD.md` — 5단계 서사와 컴포넌트 매핑 규격
- `/src/types/` 전체 (`index.ts`, `run.ts`, `marketContext.ts`, `thesis.ts`, `criticism.ts`, `solution.ts`, `interview.ts`)
- `/src/lib/runStore.ts` — `STEP_OUTPUT_FILES` 매핑
- `/src/services/gemini.ts` — 스키마가 어떻게 구조화 출력에 쓰이는지
- `/src/lib/report.ts`, `/src/agents/thesis.ts`, `/src/agents/coldCritic.ts`, `/src/agents/solutionDesigner.ts` — 스키마 소비처

## 배경

이 phase는 리포트를 5단계 서사(시장 맥락 → 正 → 反 → 合 → 최종 판정)로 재구조화한다.
이 step은 그 **타입 계층만** 만든다. 프롬프트 재작성(step 2), verdict 에이전트(step 3),
리포트 렌더러(step 4), 웹 UI(step 5~11)는 이후 step이 맡는다.

세 가지 구조적 결함을 스키마에서 해결한다:

1. `Thesis`와 `Criticism`은 필드가 서로 대응하지 않아 좌우 대립(Split View)이 불가능하다.
   → 두 타입이 **공통 축(`DialecticAxis`)**을 공유하는 `points[]`를 갖게 한다.
2. 리스크는 `severity` enum뿐이라 레이더 차트를 그릴 수 없다. → `riskScore`와 `riskKeyword`를 분리한다.
3. `MarketContext`는 원시 배열만 있고 정제된 인사이트 필드가 없어 Summary/Details 분리가 불가능하다.

## 검증된 사실 (그대로 신뢰해도 된다)

`src/services/gemini.ts`는 `z.toJSONSchema(schema)`를 Gemini의 `responseJsonSchema`로 넘기고,
응답을 `schema.safeParse()`로 검증한 뒤 실패하면 `z.prettifyError()` 메시지를 프롬프트에 피드백하며
최대 3회 재시도한다. zod 4에서 `.refine()`은 `ZodObject`를 그대로 반환하고, `z.toJSONSchema()`는
refine을 무시하지만 `safeParse()`는 강제한다. **따라서 `.refine()`으로 축 커버리지·점수 밴드를 강제해도
안전하며, 위반 시 재시도 루프가 자동으로 교정한다.** (이 동작은 실제로 실행해 확인했다.)

## 작업

### 1. `src/types/dialectic.ts` (신설)

正과 反이 공유하는 좌표계다. 라벨은 **어느 한쪽 입장도 담지 않는 중립어**여야 한다
(`페인포인트의 허구성`은 反의 언어이므로 축 이름이 될 수 없다).

```ts
export const DIALECTIC_AXES = ["painPoint", "bm", "copycat"] as const;
export const DialecticAxisSchema: z.ZodEnum<...>;
export type DialecticAxis = (typeof DIALECTIC_AXES)[number];

/** 축의 한국어 라벨 단일 소스. 正/反 양쪽 컬럼 헤더와 레이더 축 라벨이 함께 쓴다. */
export const DIALECTIC_AXIS_LABELS: Record<DialecticAxis, string>;
//   painPoint → "페인포인트", bm → "수익 모델", copycat → "해자와 카피캣"

/** severity와 riskScore의 대응 밴드. UI·테스트·프롬프트가 모두 이 상수를 참조한다. */
export const SEVERITY_SCORE_BANDS: Record<CriticismSeverity, { min: number; max: number }>;
//   minor → 0..33, major → 34..66, fatal → 67..100
```

`SEVERITY_SCORE_BANDS`를 `criticism.ts`가 아니라 여기 두는 이유: `verdict.ts`도 잔존 리스크에서
같은 밴드를 쓴다. 순환 import를 피하려면 `CriticismSeverity` enum 자체는 `criticism.ts`에 두고
`dialectic.ts`가 그것을 import하거나, severity enum을 `dialectic.ts`로 옮겨라. **둘 중 하나를 골라
순환 참조가 생기지 않게 하라.** 판단은 에이전트에게 맡긴다.

축 커버리지 검증에 쓸 재사용 가능한 헬퍼도 여기 둔다:

```ts
/** points가 세 축을 모두 최소 1개씩 덮는지 */
export function coversAllAxes(points: readonly { axis: DialecticAxis }[]): boolean;
/** id가 고유한지 */
export function hasUniqueIds(points: readonly { id: string }[]): boolean;
```

### 2. `src/types/thesis.ts` (재구조화)

기존 서사 필드는 **유지한다**(2단계 본문이 이 필드들로 렌더링된다). `points[]`를 추가한다.

```ts
export const ThesisPointSchema = z.object({
  id: z.string().min(1),          // "t1", "t2" … 프롬프트가 부여
  axis: DialecticAxisSchema,
  claim: z.string().min(1),        // 한 문장 낙관 주장 (Split View 좌측 카드 제목)
  rationale: z.string().min(1),    // MarketContext 실제 데이터를 인용한 근거
});

export const ThesisSchema = z.object({
  points: z.array(ThesisPointSchema).min(3),
  revenueModel: z.string().min(1),
  growthLevers: z.array(z.string().min(1)).min(1),
  marketTailwinds: z.array(z.string().min(1)).min(1),
  bestCaseScenario: z.string().min(1),
  winningThesis: z.string().min(1),
})
  .refine(coversAllAxes 적용, { message: "points는 painPoint·bm·copycat 세 축을 모두 포함해야 한다" })
  .refine(hasUniqueIds 적용, { message: "ThesisPoint.id는 고유해야 한다" });
```

### 3. `src/types/criticism.ts` (재구조화 — ADR-011)

`painPointReality` / `bmWeakness` / `copycatRisk` 세 배열을 **삭제**하고 평탄화한다.

```ts
export const CriticismSeveritySchema = z.enum(["fatal", "major", "minor"]);  // 값 유지

export const CriticismPointSchema = z.object({
  id: z.string().min(1),                        // "c1", "c2" …
  axis: DialecticAxisSchema,
  rebuts: z.string().min(1).optional(),         // 반박 대상 ThesisPoint.id
  claim: z.string().min(1),
  evidence: z.string().min(1),
  severity: CriticismSeveritySchema,
  riskScore: z.number().int().min(0).max(100),
  riskKeyword: z.string().min(1),               // 뱃지·레이더 라벨용 짧은 명사구
})
  .refine(riskScore가 severity의 SEVERITY_SCORE_BANDS 범위 안인지,
          { message: "riskScore가 severity 밴드를 벗어났다" });

export const CriticismSchema = z.object({
  points: z.array(CriticismPointSchema).min(3),
  /** 反 섹션의 소결론. 리포트의 최종 판정이 아니다 — 그건 verdict.json이 담당한다 (ADR-010). */
  verdict: z.string().min(1),
})
  .refine(coversAllAxes 적용, ...)
  .refine(hasUniqueIds 적용, ...);
```

`rebuts`는 optional이며 **zod로 교차 객체 참조를 검증하지 않는다.** 이유: `CriticismSchema`는
`Thesis`를 모른다. 끊어진 참조는 UI가 무시한다(step 7). Split View의 좌우 정렬은 `rebuts`가 아니라
`axis`가 담당한다 — `rebuts`는 "이 낙관을 정면 반박함" 칩을 붙이는 용도다.

### 4. `src/types/marketContext.ts` (필드 추가)

`CompetitorServiceSchema`와 `YoutubeVoiceSchema`는 그대로 둔다. `MarketContextSchema`에 아래
**정제된 인사이트 필드 4개**를 추가한다. 기존 원시 배열도 모두 유지한다(아코디언 Details에 들어간다).

```ts
export const MarketContextSchema = z.object({
  ideaTitle: z.string().min(1),

  // ── Summary: 본문에 노출되는 정제된 인사이트 ──
  briefing: z.string().min(1),                    // 3~5문장. 건조한 팩트 브리핑
  marketSizeIndicators: z.array(z.string().min(1)),  // 시장 규모·성장률 등 정량 지표. 빈 배열 허용
  competitorInsight: z.string().min(1),           // 경쟁 구도에서 읽어낸 한 단락 인사이트
  voicesInsight: z.string().min(1),               // 유저 목소리에서 읽어낸 한 단락 인사이트

  // ── Details: 아코디언에 접히는 원시 근거 ──
  trends: z.array(z.string().min(1)),
  competitors: z.array(CompetitorServiceSchema),
  youtubeVoices: z.array(YoutubeVoiceSchema),
  painPointEvidence: z.array(z.string().min(1)),
  sources: z.array(z.string().min(1)),
});
```

`marketSizeIndicators`에 `.min(1)`을 걸지 마라. 이유: 지표를 찾지 못하는 아이디어가 존재하고,
그때마다 파이프라인이 3회 재시도 후 실패한다. 빈 배열을 허용하고 UI가 빈 상태를 처리한다.
같은 이유로 `youtubeVoices`도 빈 배열을 허용한다(YouTube quota 초과 시 발생).

### 5. `src/types/verdict.ts` (신설 — ADR-010)

```ts
export const RECOMMENDATIONS = ["proceed", "pivot", "abandon"] as const;
export const RecommendationSchema: z.ZodEnum<...>;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** 한국어 라벨 단일 소스 (SEVERITY_LABELS 패턴을 따른다) */
export const RECOMMENDATION_LABELS: Record<Recommendation, string>;
//   proceed → "추진", pivot → "피벗", abandon → "철회"

/** survivalScore와 recommendation의 대응 밴드 */
export const RECOMMENDATION_SCORE_BANDS: Record<Recommendation, { min: number; max: number }>;
//   abandon → 0..39, pivot → 40..69, proceed → 70..100

export const ResidualRiskSchema = z.object({
  keyword: z.string().min(1),          // 짧은 명사구
  severity: CriticismSeveritySchema,
  note: z.string().min(1),
});

export const VerdictSchema = z.object({
  survivalScore: z.number().int().min(0).max(100),
  recommendation: RecommendationSchema,
  headline: z.string().min(1),         // 한 문장 결론
  rationale: z.string().min(1),        // 종합 결론 단락
  residualRisks: z.array(ResidualRiskSchema).min(1),  // 合의 피벗 이후에도 남는 리스크
  conditions: z.array(z.string().min(1)).min(1),      // 이 조건이 충족되면 생존한다
})
  .refine(survivalScore가 recommendation의 RECOMMENDATION_SCORE_BANDS 범위 안인지,
          { message: "survivalScore가 recommendation 밴드와 모순된다" });
```

`refine`의 존재 이유: "생존 점수 20점인데 recommendation은 proceed" 같은 자기모순 출력을 막는다.
위반하면 gemini.ts의 재시도 루프가 에러 메시지를 되먹여 교정한다.

### 6. `src/types/run.ts`

`PIPELINE_STEPS` 배열 끝에 `"verdict"`를 추가한다. 순서가 곧 실행 순서다:

```ts
["interviewer", "context-hunter", "thesis", "cold-critic", "solution-designer", "verdict"]
```

### 7. `src/types/index.ts`

`./dialectic.js`와 `./verdict.js`를 export에 추가한다.

### 8. `src/lib/runStore.ts`

`STEP_OUTPUT_FILES`에 `verdict: "verdict.json"`을 추가한다. `Record<PipelineStepName, string>`이므로
step 6번을 추가하면 이 매핑이 없을 때 타입 에러가 난다 — 그게 정상 동작이다.
`RunStore`의 다른 메서드는 건드리지 마라.

### 9. 컴파일 보전 (최소 수정)

`src/lib/report.ts`와 `src/agents/coldCritic.ts`·`solutionDesigner.ts`는 삭제된 필드
(`criticism.painPointReality` 등)를 참조한다. **`npx tsc --noEmit`이 통과할 만큼만** 기계적으로 고쳐라:

- `report.ts`: `criticism.points`를 `axis`로 그룹핑해 기존과 동일한 3개 소제목으로 출력한다.
  서사 순서 재배치와 아코디언은 **step 4가 한다.** 여기서는 컴파일만 통과시킨다.
- 에이전트들: 타입 참조만 고친다. **프롬프트 문자열은 건드리지 마라 — step 2의 일이다.**

## 테스트 (TDD — 먼저 작성한다)

`src/types/dialectic.test.ts`, `thesis.test.ts`, `criticism.test.ts`, `verdict.test.ts`,
`marketContext.test.ts`를 갱신/신설하라. 최소한 아래를 덮어야 한다:

- 세 축을 모두 덮은 `points`는 통과하고, 한 축이 빠지면 **실패**한다.
- `id`가 중복되면 실패한다.
- `severity: "fatal"` + `riskScore: 20` 조합은 실패한다(밴드 위반). `fatal` + `80`은 통과한다.
- `recommendation: "proceed"` + `survivalScore: 20`은 실패한다. `proceed` + `85`는 통과한다.
- `rebuts`가 없어도 `CriticismPointSchema`는 통과한다.
- `marketSizeIndicators: []`와 `youtubeVoices: []`는 통과한다.
- `DIALECTIC_AXIS_LABELS`와 `RECOMMENDATION_LABELS`는 각 enum 값을 **빠짐없이** 덮는다(exhaustive).
- `z.toJSONSchema(ThesisSchema)`가 throw하지 않는다 — Gemini 구조화 출력 경로가 살아 있음을 보장한다.

기존 `src/lib/report.test.ts`는 삭제된 필드를 쓰므로 새 스키마에 맞게 픽스처를 갱신하라.
리포트 **내용**에 대한 단언은 step 4에서 다시 쓴다. 여기서는 통과만 시켜라.

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run
```

`npm run build`와 `npm test`는 이 step에서 **실패한다.** 루트 스크립트가 `web` 워크스페이스까지
체이닝하는데, `web/src/lib/severity.ts`와 `web/src/components/report/CriticismSection.tsx`가 아직
삭제된 `criticism.painPointReality`를 참조하기 때문이다. 이건 예상된 상태다 — web은 **step 5**에서 복구한다.
루트 `tsconfig.json`의 `include`는 `["src"]`이고 루트 `vitest.config.ts`는 `web/**`를 제외하므로,
위 두 커맨드가 이 step의 정확한 검증 범위다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/types/`에만 신규 파일)
   - ADR 기술 스택(zod + TypeScript strict)을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (types/에서 외부 API 호출 없음, TDD 준수)
   - `src/types/` 내부에 순환 import가 없는가? (`npx tsc --noEmit`이 잡지 못하는 런타임 순환에 주의)
3. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (다음 step이 알아야 할
     타입명·파일 경로·밴드 상수 이름을 반드시 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `web/` 아래 어떤 파일도 수정하지 마라. 이유: web 복구는 step 5의 범위다. 여기서 손대면 step 5가
  이미 바뀐 코드를 다시 읽고 혼란에 빠진다.
- 에이전트의 프롬프트 문자열(`*_SYSTEM_PROMPT`, `*_PROMPT_TEMPLATE`)을 수정하지 마라.
  이유: step 2가 새 스키마에 맞춰 전면 재작성한다. 지금 고치면 두 번 쓰는 일이 된다.
- `src/agents/verdict.ts`를 만들지 마라. 이유: step 3의 범위다. 이 step은 `VerdictSchema` 타입만 만든다.
- `criticism.verdict` 필드를 삭제하지 마라. 이유: 反 섹션의 소결론으로 계속 쓰인다(ADR-010).
  최종 판정과 이름이 겹칠 뿐 역할이 다르다.
- `rebuts`에 zod 교차 검증(존재하는 ThesisPoint.id인지)을 넣지 마라. 이유: `CriticismSchema`는
  `Thesis` 인스턴스를 알 수 없고, 억지로 주입하면 Gemini 구조화 출력 스키마가 오염된다.
- `marketSizeIndicators`나 `youtubeVoices`에 `.min(1)`을 걸지 마라. 이유: 데이터를 못 구하는 정상
  상황에서 파이프라인 전체가 3회 재시도 후 실패한다.
- 기존 테스트를 깨뜨리지 마라. 단, 삭제된 필드를 참조하는 테스트는 새 스키마에 맞게 갱신하라.
