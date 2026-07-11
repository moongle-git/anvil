# Step 5: grounded-citations

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ADR.md` — **ADR-012**(citations 공존·urlContext), ADR-001(grounding), ADR-004(하네스 재시도)
- `/docs/ARCHITECTURE.md` — 데이터 흐름, **상태 관리(STALLED 15분)**
- `/docs/PRD.md` — run 상태 파생 규칙 (mtime 임계값)
- `/src/services/gemini.ts` — 이 step이 재작성할 파일 (139줄, 전부 읽어라)
- `/src/services/gemini.test.ts` — mock 패턴(`fakeClient`), 재시도 시퀀스 테스트
- `/src/types/marketContext.ts` — step 1 산출물. `CitationSchema`, `MarketContextDraftSchema`, `MarketContextObjectSchema`
- `/src/agents/contextHunter.ts` — 유일한 grounding 호출부
- `/src/lib/runStore.ts` — `STALLED_THRESHOLD_MS`(`:31`), `deriveRunStatus`
- `/src/pipeline/orchestrator.ts` — `executeStep`, `PipelineDeps`
- `/src/pipeline/orchestrator.test.ts` — **`fakeGemini`(`:141-165`)가 `schema === MarketContextSchema`로 호출을 식별한다.** 이 step이 깨뜨린다
- `/src/pipeline/e2e.test.ts` — 진짜 GeminiService + 진짜 RunStore를 관통하는 테스트
- `/src/agents/{thesis,coldCritic,solutionDesigner,verdict}.ts` — `JSON.stringify(context, null, 2)` 주입부

## 배경

**리포트의 `sources[]`는 지금 거짓말을 할 수 있다.**

`gemini.ts:114`가 `response.text`만 읽고 `response.candidates[0].groundingMetadata`를 **전혀 보지 않는다.**
그래서 `MarketContext.sources[]`는 실제 검색 인용이 아니라 **LLM이 자기 기억으로 적어낸 URL 문자열**이다.
환각 URL을 걸러낼 장치가 코드에 없다.

SDK는 이미 인용을 준다 (`node_modules/@google/genai/dist/genai.d.ts`에서 확인됨):
- `Candidate.groundingMetadata?: GroundingMetadata` (`:1421`)
- `GroundingMetadata.groundingChunks?: GroundingChunk[]` (`:6291`)
- `GroundingChunk.web?: GroundingChunkWeb` (`:6143`)
- `GroundingChunkWeb { domain?: string; title?: string; uri?: string }` (`:6274`) — **셋 다 optional이다**
- `GroundingMetadata.webSearchQueries?: string[]` — 모델이 실제로 검색한 쿼리
- `Candidate.urlContextMetadata?: UrlContextMetadata` (`:1430`)
- `Tool.urlContext?: UrlContext` (`:12398`) — `googleSearch`와 **병용 가능**

### ★ 함정 1: groundingChunks의 uri는 원 사이트 URL이 아니다

Gemini가 돌려주는 `web.uri`는 대개 `https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`
형태의 **만료되는 리다이렉트 URL**이다. 원 도메인은 `domain` 필드에만 (있을 때) 담긴다.

**그래서 `citations`는 `sources`를 대체하지도 병합하지도 않고 공존한다** (ADR-012):

| 필드 | 채우는 주체 | 실패 모드 |
|---|---|---|
| `sources: string[]` | LLM 자기보고 | 부정확할 수 있음. **안 만료됨** |
| `citations: Citation[]` | **코드**가 groundingMetadata에서 추출 | 정확함. **uri가 만료될 수 있음** |

실패 모드가 정확히 상보적이다. 하나로 합치면 "grounding이 아무것도 안 돌려줬다"는 사실이 자기보고에 가려진다.

### ★ 함정 2: urlContext 지연을 그냥 늘리면 STALLED 오탐이 난다

`gemini.ts:5-8` 주석대로 grounding 단독 정상 응답이 이미 50~90초다(실측 52초). `urlContext`로 페이지를
fetch하면 더 느려진다.

그런데 `runStore.ts:31` `STALLED_THRESHOLD_MS = 10 * 60 * 1000`(10분)이고,
`executeStep`(`orchestrator.ts:98-137`)은 step **실행 중에는 `state.json`을 건드리지 않는다.**
즉 context-hunter가 10분을 넘기면 웹 UI가 **정상 실행 중인 run을 "중단됨"으로 오탐**한다.

- 지금: 3 재시도 × 120초 = 6분 < 10분 → 안전
- 순진하게 240초로 올리면: 3 × 240 = **12분 > 10분 → 버그**

**해법을 세트로 적용하라** (아래 작업 3·4).

## 작업

### 1. `src/services/gemini.ts` — `generateGrounded()` 신설

`generateStructured`의 시그니처를 **바꾸지 마라.** grounding을 안 쓰는 호출부 5곳
(interviewer / thesis / coldCritic / solutionDesigner / verdict)은 한 글자도 안 바뀌어야 한다.
`GenerateStructuredParams.useGrounding` 필드는 **제거**한다(유일한 사용처가 contextHunter이고, 그건
`generateGrounded`로 옮긴다).

```ts
export interface GroundingCitation {
  uri: string;              // 필수 — uri 없는 chunk는 인용으로 쓸 수 없다
  title?: string;
  domain?: string;
}

export interface GroundedResult<T> {
  data: T;
  citations: GroundingCitation[];
  webSearchQueries: string[];   // 모델이 실제 검색한 쿼리 — 관측용
}

export interface GenerateGroundedParams<T> {
  systemInstruction: string;
  prompt: string;
  schema: ZodType<T>;
  useUrlContext?: boolean;      // 기본 true
}

export class GeminiService {
  async generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;      // 시그니처 불변
  async generateGrounded<T>(params: GenerateGroundedParams<T>): Promise<GroundedResult<T>>;
}
```

**재시도/파싱/검증 루프(`:96-133`)를 두 메서드가 공유하도록 private 헬퍼로 뽑아라.**
`stripNullProps`, `extractJsonText`, `[교정 요청]` 피드백 루프, `z.prettifyError`는 전부 그대로 유지한다.

**★ 핵심 계약: 인용은 JSON 검증을 통과한 그 시도의 response에서 읽어야 한다.**
루프가 최대 N회 돈다. 1차 시도가 형식 실패하면 그 시도의 `groundingMetadata`는 **버려야 한다**.
따라서 private 헬퍼는 성공한 시도의 raw `GenerateContentResponse`를 함께 반환해야 한다:
`Promise<{ data: T; response: GenerateContentResponse }>`.

### 2. `extractCitations()` — groundingMetadata → `GroundingCitation[]`

`gemini.ts` 안의 모듈 레벨 순수 함수로 만들고 **export하라**(테스트가 직접 부른다).

```ts
export function extractCitations(response: GenerateContentResponse): GroundingCitation[];
```

규칙:

1. `response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []`를 순회한다.
2. **`chunk.web?.uri`가 없거나 빈 문자열이면 버린다.** (uri 없는 인용은 쓸모가 없다.)
3. **uri로 중복을 제거한다.** 같은 소스가 여러 chunk로 쪼개져 온다.
4. `title`·`domain`은 **있을 때만** 키를 넣는다 (`undefined`를 명시적으로 넣지 마라 — `exactOptionalPropertyTypes`).
5. **`urlContextMetadata`도 병합한다**: `response.candidates?.[0]?.urlContextMetadata?.urlMetadata ?? []`를 돌며
   `urlRetrievalStatus`가 성공인 항목의 `retrievedUrl`을 (중복이 아니면) 추가한다.
   urlContext로 **실제로 읽은** 페이지는 가장 강한 인용이다.
   ⚠️ 정확한 필드명은 `genai.d.ts`의 `UrlContextMetadata` / `UrlMetadata`를 **직접 읽고 확인하라.**
   추측하지 마라. 필드가 다르면 SDK 타입을 따르라.
6. `candidates`가 없거나 metadata가 없으면 **`[]`를 반환한다. 절대 throw하지 않는다.**

### 3. urlContext 툴 + 타임아웃/재시도 세트

`generateGrounded`의 config:
```ts
tools: [{ googleSearch: {} }, { urlContext: {} }]   // useUrlContext가 true일 때
```
`responseJsonSchema`는 **쓸 수 없다** (grounding과 동시 사용 불가). 기존처럼 `JSON_ONLY_INSTRUCTION`을
프롬프트 끝에 붙이고 `extractJsonText`로 JSON을 긁어낸다.

`GeminiServiceOptions`에 추가:
```ts
groundedTimeoutMs?: number;    // 기본 180_000 (3분)
groundedMaxRetries?: number;   // 기본 2
```
**최악 2 × 180초 = 6분** — 기존(3 × 120초 = 6분)과 동일하다. 이 숫자를 지켜라.
grounding 호출의 실패 모드는 JSON 형식이라 2회면 충분하다(3회째가 살리는 경우는 드물다).

기존 `timeoutMs`(120초) / `maxRetries`(3)는 **non-grounding 경로용으로 그대로 유지**한다.

### 4. `src/lib/runStore.ts` — `STALLED_THRESHOLD_MS` 10분 → **15분**

`:31`의 상수를 `15 * 60 * 1000`으로 바꾼다. 최악 6분 + 다른 step들의 시간 + 여유.
**`runStore.test.ts`의 stalled 판정 테스트가 이 상수를 참조하는지 확인하고 함께 갱신하라.**
`docs/PRD.md`와 `docs/ARCHITECTURE.md`는 step 0에서 이미 15분으로 갱신되어 있다 — 코드가 문서를 따라간다.

### 5. `toPromptContext()` — 하류 프롬프트 토큰 방어

`src/types/marketContext.ts`에 추가:
```ts
/** 하류 에이전트 프롬프트용. citations는 코드가 만든 출처 메타데이터라 논증에 쓰이지 않는다 */
export function toPromptContext(context: MarketContext): Omit<MarketContext, "citations">;
```

`src/agents/{thesis,coldCritic,solutionDesigner,verdict}.ts`의
`JSON.stringify(context, null, 2)` → `JSON.stringify(toPromptContext(context), null, 2)`.

이유: `citations`는 run당 10~30개이고 리다이렉트 URL은 길다. 하류 4개 에이전트가 `MarketContext` 전체를
주입받으므로 그대로 두면 **같은 URL 뭉치가 4번 중복 실린다.** 하류는 인용을 쓰지 않는다.
`sources`는 **남긴다** — LLM 자기보고 설명은 하류에 맥락을 준다.

### 6. `src/agents/contextHunter.ts` — citations 주입

`gemini.generateStructured({ ..., useGrounding: true })` →
`gemini.generateGrounded({ systemInstruction, prompt, schema: MarketContextDraftSchema })`.

⚠️ **schema가 `MarketContextSchema`가 아니라 `MarketContextDraftSchema`다** (step 1). LLM은 `citations`를
채우지 않는다. 반환값을 조립하라:
```ts
const { data, citations, webSearchQueries } = await deps.gemini.generateGrounded({...});
// citations를 코드가 주입한다 — LLM이 지어낸 게 아니다
return { ...data, citations };
```
`webSearchQueries`는 `console.log`/`deps.log`로 **로그만** 남긴다. 스키마에 넣지 마라.

**수집 로직(`formatYoutubeSection`, `collectVoices` 호출, try/catch)은 건드리지 마라 — step 6의 범위다.**

### 7. `src/pipeline/orchestrator.test.ts` — 깨진 mock 복구

**`fakeGemini`(`:141-165`)가 `schema === MarketContextSchema`로 gemini 호출을 식별한다.**
contextHunter가 `generateGrounded`로 옮기면 이게 전부 깨진다. `:155`, `:209`, `:403`, `:476`, `:485`, `:510` 확인.

- `fakeGemini`에 **`generateGrounded` mock을 추가**한다. `schema === MarketContextDraftSchema`일 때
  `{ data: marketContext, citations: [], webSearchQueries: [] }`를 반환한다.
- `failOn` 옵션이 **두 메서드 모두**에 적용되게 한다.
- `calledSchemas(generateStructured)` 기대 배열에서 `MarketContextSchema`를 **제거**한다.
- `:485`의 `schema === MarketContextSchema`로 context 호출을 찾는 로직은
  `generateGrounded.mock.calls[0]`으로 바꾼다.

## 테스트 (TDD — 먼저 작성한다)

### `src/services/gemini.test.ts` (확장)

**기존 구조화 출력(non-grounding) 테스트는 손대지 마라.** 그게 "5개 호출부가 안 깨졌다"는 증명이다.
`:199~263`의 `useGrounding: true` 테스트만 `generateGrounded`로 이전한다.

- config에 `tools: [{ googleSearch: {} }, { urlContext: {} }]`가 있고 `responseJsonSchema`가 **없다**
- `useUrlContext: false`면 `tools`에 `googleSearch`만 있다
- 반환값이 `{ data, citations, webSearchQueries }` 모양이다
- **★ 인용은 성공한 시도에서 읽는다**: 1차 응답은 JSON 파싱 실패 + `groundingChunks: [{web:{uri:"A"}}]`,
  2차 응답은 성공 + `groundingChunks: [{web:{uri:"B"}}]` → **citations는 `B`만** (A가 아니다).
  이 테스트가 이 step의 핵심 계약이다.
- `web.uri`가 없는 chunk는 드롭된다
- 같은 uri가 여러 chunk에 나오면 **1개로 dedupe**된다
- `title`/`domain`이 없으면 결과 객체에 **키가 없다** (`undefined` 명시 금지)
- `candidates`가 없는 응답 → `citations: []`, **throw하지 않는다**
- `urlContextMetadata`의 성공 항목이 citations에 병합된다. 실패 항목은 무시된다
- `groundedMaxRetries: 2`가 지켜진다 (2회 실패 후 throw)
- `groundedTimeoutMs`가 grounding 경로에만 적용되고 `timeoutMs`는 non-grounding에 남는다

### `src/pipeline/e2e.test.ts` (확장) — **★ 최고 가치 테스트**

진짜 `GeminiService` + 진짜 `RunStore`(`mkdtempSync`)를 관통하는 인용 경로 증명:

- context 호출의 fake GenAI 응답에 실제 metadata를 실어라:
  ```ts
  candidates: [{
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://x.example", title: "T" } }, { web: {} }],
      webSearchQueries: ["회의록 요약 서비스"],
    },
  }]
  ```
- 파이프라인 완주 후 **디스크의 `runs/{id}/context.json`에 `citations`가 정확히 1건**(uri 없는 chunk는 드롭)
  들어 있는지 단언한다.
- ⚠️ **기존 `CONTEXT_TEXT`의 `"url": null` 형태를 없애지 마라** — `stripNullProps`의 회귀 커버리지다.

### `src/lib/runStore.test.ts`

`STALLED_THRESHOLD_MS`가 15분이 되었으므로, 12분 된 run이 **`running`**(stalled 아님)이고
16분 된 run이 `stalled`인지 단언하라. 기존 테스트가 10분 경계를 하드코딩했다면 갱신한다.

### `src/agents/{thesis,coldCritic,solutionDesigner,verdict}.test.ts`

프롬프트에 `citations` 문자열이 **포함되지 않는다**는 단언을 추가하라 (`toPromptContext` 계약).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
grep -q "generateGrounded" src/agents/contextHunter.ts
grep -q "urlContext" src/services/gemini.ts
grep -q "15 \* 60 \* 1000" src/lib/runStore.ts
grep -rq "useGrounding" src/agents/ && echo "FAIL: useGrounding이 남아 있다" && exit 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **`generateStructured`의 시그니처가 안 바뀌었는지** 확인한다 — interviewer/thesis/coldCritic/
   solutionDesigner/verdict의 **호출부 코드가 한 줄도 안 바뀌어야 한다** (`useGrounding: false` 인자 제거는 예외).
   `git diff src/agents/interviewer.ts`가 비어 있어야 한다.
3. 타이밍 산술을 확인한다: `groundedMaxRetries × groundedTimeoutMs = 2 × 180초 = 6분 < STALLED 15분`. ✅
4. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/`에만 있는가?
   - 에이전트 산출물이 zod 검증을 통과해야 다음 step으로 가는가? 검증 실패 시 재시도(피드백 포함)하는가?
   - `state.json`이 여전히 단일 진실 공급원이고 resume이 completed step을 건너뛰는가?
   - 테스트가 API 키 없이 통과하는가?
5. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `generateGrounded`/`extractCitations`의 시그니처, `GroundedResult<T>` 필드,
     `groundedTimeoutMs`/`groundedMaxRetries` 기본값, `toPromptContext` 경로, STALLED 15분,
     그리고 **orchestrator.test의 fakeGemini를 어떻게 고쳤는지**를 포함하라. step 6이 같은 mock을 또 건드린다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **`citations`로 `sources`를 대체하거나 병합하지 마라.** 이유: `groundingChunks`의 uri는
  `vertexaisearch.cloud.google.com/grounding-api-redirect/...` 형태의 **만료되는 리다이렉트 URL**이다.
  두 필드의 실패 모드가 상보적이라 공존해야 한다 (ADR-012). 합치면 "grounding이 아무것도 안 돌려줬다"는
  사실이 LLM 자기보고에 가려진다.
- **실패한 시도의 groundingMetadata를 쓰지 마라.** 이유: 재시도 루프가 최대 2회 돈다. JSON 형식 검증을
  통과한 **그 시도**의 response에서 인용을 읽어야 한다. 그래서 private 헬퍼가 `{ data, response }`를 반환한다.
- **`generateStructured`의 시그니처를 바꾸지 마라.** 이유: grounding을 안 쓰는 5개 호출부가 전부 깨진다.
  `generateGrounded`를 **별도 메서드**로 만드는 이유가 이것이다. 오버로드로 반환 타입을 분기시키지도 마라 —
  TS strict에서 제네릭 + 불리언 리터럴 추론이 깨져 모든 호출부에 `as`를 강요한다.
- **`groundedTimeoutMs`를 240초 이상으로 올리지 마라.** 이유: `재시도 × 타임아웃`이 `STALLED_THRESHOLD_MS`를
  넘으면 웹 UI가 **정상 실행 중인 run을 "중단됨"으로 오탐**한다 (`executeStep`은 실행 중에 state.json을
  안 건드린다). 180초 × 2회 = 6분으로 묶어라. 타임아웃을 늘리려면 재시도를 줄여라.
- **`urlContext`를 2-pass로 만들지 마라** (1차 grounding으로 경쟁사 찾고 → 2차 urlContext로 읽기).
  이유: 지연이 2배가 되고 재시도까지 곱해진다. 1-pass로 두고 모델이 같은 턴 안에서 결정하게 한다.
- **`citations`를 LLM에게 채우라고 하지 마라** (프롬프트의 출력 JSON 예시에 넣지 마라).
  이유: 그건 지금 고치려는 바로 그 버그다. step 1의 계약 테스트가 이를 강제한다.
- **`webSearchQueries`를 `MarketContext` 스키마에 넣지 마라.** 이유: 하류 4개 프롬프트 토큰만 늘고 쓰는 데가 없다.
  로그로 노출하라.
- **`src/agents/contextHunter.ts`의 수집 로직(`formatYoutubeSection`, `collectVoices`, try/catch)을 건드리지 마라.**
  이유: 소스 추상화는 step 6의 범위다. 이 step은 gemini 호출 방식과 citations 주입만 바꾼다.
- **`stripNullProps`를 제거하지 마라.** 이유: grounding 모델이 optional 필드에 명시적 `null`을 넣는 실측 실패를
  막고 있다 (`competitors[].url === null`).
- 테스트에서 실제 Gemini API를 호출하지 마라.
- 기존 테스트를 깨뜨리지 마라.
