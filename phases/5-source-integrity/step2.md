# Step 2: research-artifact

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-012**(다중 소스 fail-soft 수집), **ADR-013**(step 0에서 추가됨 — 이 step의 직접 근거)
- `/docs/ARCHITECTURE.md` — `runs/{run-id}/` 산출물 목록에 `research.json`이 추가돼 있다 (step 0에서 갱신됨)
- `/CLAUDE.md`
- `src/research/collect.ts` — `collectAll`. 이 step의 주 수정 대상
- `src/research/types.ts` — `ResearchSource`, `CollectedEvidence`, `SourceFailure`
- `src/types/research.ts` — `RESEARCH_SOURCE_IDS`, `ResearchSourceIdSchema`, `SOURCE_LABELS`
- `src/types/marketContext.ts` — `CODE_INJECTED_CONTEXT_KEYS`, `MarketContextObjectSchema`, `toPromptContext`
- `src/lib/runStore.ts` — `STEP_OUTPUT_FILES`, `saveStepOutput`, `loadStepOutput`
- `src/pipeline/orchestrator.ts` — `executeStep`, context-hunter step 호출부
- `src/cli/index.ts` — `buildResearchSources` (키가 없는 소스를 배열에서 **제외**한다)
- `src/agents/contextHunter.ts` — `runContextHunter`의 반환부

## 배경 — 왜 이 step이 필요한가

`collectAll()`이 YouTube·Hacker News·네이버에서 가져온 **진짜 증거가 디스크에 저장되지 않는다.** 프롬프트 문자열로 포맷되어 LLM에 들어간 뒤 버려진다. `runContextHunter`의 `return { ...data, citations }`에서 `data`는 LLM의 초안이므로, `context.json`의 `communityVoices`는 수집된 증거가 아니라 **LLM이 다시 받아적은 것**이다.

결과:
- 리포트의 인용이 실제 수집물과 일치하는지 **대조할 방법이 없다** — 원본이 남아 있지 않기 때문이다.
- 실제로 8개 run 중 6개에서 `communityVoices`가 0건인데도, 그 URL들이 LLM의 `sources[]`에는 새어나왔다. 모델이 증거를 봤지만 목소리 필드에는 옮기지 않았다는 뜻이다.

또한 **키가 없어 등록되지 않은 소스는 흔적조차 남지 않는다.** `buildResearchSources`(`src/cli/index.ts`)는 `NAVER_CLIENT_SECRET`이 없으면 네이버를 배열에 넣지 않고 `console.warn` 한 줄만 남긴다. 그래서 8개 run 전부 네이버 인용이 0건인데 **리포트에는 그 사실이 전혀 표시되지 않는다** — 독자는 네이버 조사가 됐다고 믿는다. (`collectAll`의 `failures[]`에도 안 잡힌다. 실패가 아니라 부재이기 때문이다.)

이 step은 **수집된 증거를 진실의 원천으로 만든다.**

## 작업

### 1. `src/types/research.ts` — 커버리지·증거 스키마 신설

```ts
/**
 * 소스별 자료조사 결과. "0건"과 "키가 없어 아예 조사 안 함"과 "에러로 실패함"은 전부 다른 사실이다.
 * 이 셋을 구분하지 못하면 리포트가 "네이버 근거 없음"을 침묵으로 숨긴다.
 */
export const SourceCoverageSchema = z.object({
  source: ResearchSourceIdSchema,
  status: z.enum(["collected", "unconfigured", "failed"]),
  /** 수집 건수. unconfigured·failed면 0 */
  count: z.number().int().nonnegative(),
  /** status가 failed일 때만 */
  error: z.string().optional(),
});
export type SourceCoverage = z.infer<typeof SourceCoverageSchema>;

/** runs/{id}/research.json — 수집된 원시 증거. context.json의 communityVoices는 이것의 부분집합이어야 한다 */
export const ResearchEvidenceSchema = z.object({
  voices: z.array(CommunityVoiceSchema),
  coverage: z.array(SourceCoverageSchema),
});
export type ResearchEvidence = z.infer<typeof ResearchEvidenceSchema>;
```

`CommunityVoiceSchema`는 `src/types/marketContext.ts`에 있다. import 방향에 순환이 생기면 `CommunityVoiceSchema`를 `research.ts`로 옮기고 `marketContext.ts`가 re-export하라 — `CommunityVoice`는 개념적으로 자료조사의 타입이지 시장 맥락의 타입이 아니다. **단, `src/types/index.ts`의 공개 export 목록은 유지해 외부 import 경로가 깨지지 않게 하라.**

`status`가 `collected`인데 `count: 0`인 경우는 **정상이다** — 소스는 켜져 있었고 검색은 됐는데 결과가 0건인 경우다 (HN에 한국어 쿼리가 들어가면 실제로 이렇게 된다). 이것과 `unconfigured`는 완전히 다른 사실이므로 절대 뭉개지 마라.

### 2. `src/research/collect.ts` — coverage를 함께 반환

```ts
export async function collectAll(
  sources: readonly ResearchSource[],
  queries: Record<ResearchSourceId, string>,
): Promise<CollectedEvidence>   // CollectedEvidence에 coverage 추가
```

`src/research/types.ts`의 `CollectedEvidence`에 `coverage: SourceCoverage[]`를 추가한다.

**핵심 규칙 — 등록되지 않은 소스도 coverage에 나타나야 한다.** 구현:
- `RESEARCH_SOURCE_IDS` 전체를 순회한다.
- `sources` 배열에 해당 id가 **없으면** → `{ status: "unconfigured", count: 0 }`
- 있고 수집에 성공하면 → `{ status: "collected", count: <해당 소스의 voice 수> }`
- 있고 rejected면 → `{ status: "failed", count: 0, error: <message> }`

`collectAll`은 여전히 **절대 throw하지 않는다** (ADR-012 fail-soft). 기존 `failures[]`도 유지하라 — `formatEvidenceSection`이 쓰고 있다.

### 3. `src/lib/runStore.ts` — research.json 영속화

`research.json`은 **step 산출물이 아니다** (step은 `context-hunter`이고 그 산출물은 `context.json`이다). 따라서 `STEP_OUTPUT_FILES`에 넣지 말고 전용 메서드를 추가하라 — `answers.json`이 step 산출물이 아닌 사람의 아티팩트로 별도 취급되는 것과 같은 패턴이다 (`ARCHITECTURE.md` 참조).

```ts
saveResearchEvidence(runId: string, evidence: ResearchEvidence): void
loadResearchEvidence(runId: string): ResearchEvidence | null   // 없거나 검증 실패면 null
```

`loadResearchEvidence`는 파일이 없으면 `null`을 반환한다 — 구 run에는 `research.json`이 없다. **throw하지 마라.**

### 4. `src/types/marketContext.ts` — researchCoverage를 코드 주입 필드로

리포트와 웹 UI는 `context.json`을 읽는다. 커버리지를 렌더하려면(step 5) `MarketContext`가 들고 있어야 한다.

- `MarketContextObjectSchema`에 `researchCoverage: z.array(SourceCoverageSchema).default([])`를 추가한다. `citations`와 같은 자리다.
- **`MarketContextDraftSchema`에는 절대 넣지 마라** — LLM이 채우는 필드가 아니다.
- `CODE_INJECTED_CONTEXT_KEYS`에 `"researchCoverage"`를 추가한다.
- `.default([])`를 거는 이유: 구 `context.json`에는 이 키가 없다. 빈 배열은 "커버리지 정보 없음"을 뜻하며 step 5의 렌더러가 이를 처리한다.
- `toPromptContext`는 `researchCoverage`를 **덜어내지 않는다.** 이유 — 하류 에이전트(正·反·合·판정)가 "국내 커뮤니티 근거가 아예 없다"는 사실을 알아야 논증에서 근거 부재를 진술할 수 있다. 크기도 3줄이라 `citations`처럼 프롬프트를 부풀리지 않는다.

### 5. `src/agents/contextHunter.ts` — 반환 시그니처만 변경

```ts
export async function runContextHunter(deps, idea, clarifications?): Promise<{
  context: MarketContext;
  evidence: ResearchEvidence;
}>
```

- `evidence`는 `collectAll`의 결과를 `ResearchEvidence` 형태(`{ voices, coverage }`)로 담은 것이다.
- `context`에 `researchCoverage: evidence.coverage`를 코드가 주입한다 (`citations`와 나란히).
- **이 step에서는 프롬프트와 `communityVoices` 처리를 건드리지 마라.** 반환 시그니처와 `researchCoverage` 주입만 한다. 프롬프트 수술은 step 3의 scope다.

### 6. `src/pipeline/orchestrator.ts` — research.json 저장

`executeStep`은 반환값을 그대로 step 산출물 파일에 저장하므로, `runContextHunter`의 새 반환값을 그대로 넘기면 `context.json`이 오염된다. 다음과 같이 감싸라:

```ts
const context = await executeStep("context-hunter", MarketContextSchema, async () => {
  const { context, evidence } = await runContextHunter({ gemini: deps.gemini, sources: deps.sources, log }, idea, clarifications || undefined);
  deps.store.saveResearchEvidence(runId, evidence);
  return context;
});
```

resume 시 `context-hunter`가 `completed`면 `run()`이 호출되지 않으므로 `research.json`은 재생성되지 않는다 — 이미 파일이 있으므로 정상이다. 이 동작을 바꾸지 마라.

### 7. 테스트

- `src/research/collect.test.ts`: 등록되지 않은 소스가 `unconfigured`로 coverage에 나타나는가 / 성공한 소스가 `collected` + 정확한 count인가 / rejected 소스가 `failed` + error message인가 / **`collected`인데 count가 0인 경우와 `unconfigured`가 구분되는가** / collectAll이 여전히 throw하지 않는가.
- `src/lib/runStore.test.ts`: `saveResearchEvidence` → `loadResearchEvidence` 왕복 / 파일이 없으면 `null` / 손상된 JSON이면 `null`.
- `src/types/marketContext.test.ts`: 구 `context.json`(researchCoverage 키 없음)이 `.default([])`로 파싱되는가 / `MarketContextDraftSchema`에 `researchCoverage`가 **없는지** / `CODE_INJECTED_CONTEXT_KEYS`에 있는지.
- `src/agents/contextHunter.test.ts`: 반환값에 `evidence`가 있고 `context.researchCoverage`가 채워지는가.
- `src/pipeline/orchestrator.test.ts`: context-hunter 실행 시 `saveResearchEvidence`가 호출되는가 / resume(completed) 시 호출되지 **않는가**.

**CRITICAL**: Gemini·YouTube·네이버·HN은 반드시 mock으로 대체하라. API 키 없이 `npm test`가 통과해야 한다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint    # ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/` 밖으로 새지 않았는가? (`research/`는 주입받은 services를 정규화만 한다)
   - `research.json`이 `STEP_OUTPUT_FILES`에 들어가지 않았는가? (step 산출물이 아니다)
   - `MarketContextDraftSchema`에 `researchCoverage`가 들어가지 않았는가? (LLM이 채우는 필드가 아니다)
   - `collectAll`이 여전히 절대 throw하지 않는가? (ADR-012 fail-soft)
3. 결과에 따라 `phases/5-source-integrity/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (ResearchEvidence·SourceCoverage의 정확한 필드명과 runContextHunter의 새 반환 시그니처를 반드시 포함 — step 3·5가 이걸 읽는다)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`unconfigured`와 `collected` + `count: 0`을 하나로 합치지 마라.** 이유: "네이버 키가 없어서 조사를 안 했다"와 "네이버를 조사했는데 결과가 0건이다"는 완전히 다른 사실이다. 전자는 우리 설정 문제이고 후자는 시장 신호다. 뭉개면 리포트가 거짓말을 한다.
- **`collectAll`이 throw하게 만들지 마라.** 이유: ADR-012의 fail-soft 규정이다. 소스가 전부 죽어도 웹검색만으로 파이프라인은 완주해야 한다.
- **`research.json`을 `STEP_OUTPUT_FILES`에 추가하지 마라.** 이유: `PipelineStepName`과 1:1 대응하는 맵이다. `research.json`은 context-hunter step의 부산물이지 별도 step의 산출물이 아니며, 추가하면 `PIPELINE_STEPS`·resume 판정·웹 진행 뷰까지 파급된다.
- **`src/agents/contextHunter.ts`의 프롬프트를 수정하지 마라.** 이유: step 3의 scope다. 이 step은 반환 시그니처와 `researchCoverage` 주입만 한다.
- 기존 테스트를 깨뜨리지 마라.
