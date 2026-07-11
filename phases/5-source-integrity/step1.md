# Step 1: grounding-citations

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-012**(grounding 인용 코드 추출)와 **ADR-013**(step 0에서 추가됨 — 이 step의 직접 근거)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md` — CRITICAL 규칙 (특히 "테스트에서 실제 외부 API를 호출하지 말 것")
- `src/services/gemini.ts` — 이 step의 주 수정 대상
- `src/services/gemini.test.ts` — 기존 테스트. **이 step은 이 파일의 테스트 하나를 의도적으로 뒤집는다**
- `src/types/marketContext.ts` — `CitationSchema`
- `src/agents/contextHunter.ts` — `generateGrounded`의 유일한 호출부

## 배경 — 고쳐야 할 버그

실제 산출물 8개 run 전부에서 `context.json`의 `citations[]`가 **빈 배열**이었다. 코드가 grounding 응답에서 추출하는, 리포트에서 **유일하게 검증된 출처 필드**가 실전에서 한 번도 채워진 적이 없다. 그 결과 리포트에 표시되는 URL은 100%가 LLM이 타이핑한 값(`sources[]`, `competitors[].url`)이 되었고, 그중 60%가 404였다.

**근본 원인**: `generateValidated`는 재시도 루프 안에서 **검증에 성공한 시도의 `response`만** 반환한다. grounding 모드는 `responseSchema`를 쓸 수 없어 자유 텍스트 → `extractJsonText` → zod 검증 경로를 타므로 1차 시도의 형식 실패가 잦다. 그런데 재시도는 `[교정 요청] 직전 응답이 검증에 실패했다...` 프롬프트라 **모델이 새로 웹검색을 하지 않는다** → 2차 response에는 `groundingMetadata`가 없다 → `extractCitations`가 빈 배열을 반환한다.

즉 **1차 시도에서 실제로 수행된 검색의 인용이 통째로 버려지고 있다.** 그리고 LLM은 자기가 본 리다이렉트 URL을 `sources[]`에 손으로 받아적는다(도메인 오타 `cloud.google.google.com`이 실제 산출물에 남아 있다).

## 작업

### 1. `src/services/gemini.ts` — 모든 시도의 grounding 메타데이터를 누적한다

현재 `generateValidated`는 대략 이런 형태다 (실제 코드를 읽고 정확한 시그니처를 확인하라):

```ts
private async generateValidated<T>(params: ...): Promise<{ data: T; response: GenerateContentResponse }>
```

이것을 **모든 시도의 response를 누적**해 반환하도록 바꾼다:

```ts
private async generateValidated<T>(params: ...): Promise<{ data: T; responses: GenerateContentResponse[] }>
```

- 재시도 루프에서 `generateContent`가 돌아올 때마다 그 response를 배열에 push한다. **텍스트가 비어 있든, JSON 파싱에 실패하든, zod 검증에 실패하든 상관없이 push한다** — grounding 검색은 그 시도에서 이미 일어났고, 그 사실은 응답 메타데이터에 남아 있다.
- 검증에 성공하면 `{ data, responses }`를 반환한다. `responses`에는 실패한 시도들도 포함된다.
- 최종 실패로 throw할 때는 기존 동작(에러 메시지)을 유지한다.

`extractCitations`의 시그니처를 배열을 받도록 바꾼다:

```ts
export function extractCitations(responses: readonly GenerateContentResponse[]): GroundingCitation[]
```

- 모든 response의 `candidates[0]`을 순회하며 `groundingMetadata.groundingChunks`와 `urlContextMetadata.urlMetadata`를 모은다.
- **uri 기준으로 dedup**한다 (기존 `seen` Set 로직을 그대로 확장).
- `responses`가 비어 있거나 메타데이터가 전혀 없어도 **빈 배열을 반환하고 throw하지 않는다** (기존 동작 유지).

`generateGrounded`의 `webSearchQueries`도 모든 response에서 누적해 dedup하라 — 관측 로그의 정확도가 올라간다.

### 2. `kind` 판별자 추가

`src/types/marketContext.ts`의 `CitationSchema`에 `kind` 필드를 추가한다:

```ts
export const CitationSchema = z.object({
  uri: z.url(),
  title: z.string().optional(),
  domain: z.string().optional(),
  /**
   * origin  = urlContext가 실제로 읽어낸 원본 URL. 만료되지 않는다 — 가장 강한 인용이다.
   * redirect = groundingChunks의 vertexaisearch 리다이렉트 URL. 만료되면 404가 된다.
   */
  kind: z.enum(["origin", "redirect"]),
});
```

`extractCitations`에서:
- `groundingChunks[].web.uri` → `kind: "redirect"`
- `urlContextMetadata.urlMetadata[].retrievedUrl` (단, `urlRetrievalStatus`가 SUCCESS인 것만 — 기존 가드 유지) → `kind: "origin"`
- **같은 uri가 양쪽에 나타나면 `origin`이 이긴다.** 리다이렉트보다 원본이 강한 인용이기 때문이다. dedup 로직이 이 우선순위를 지키도록 구현하라 (예: origin을 먼저 수집하거나, 이미 본 uri라도 origin이면 덮어쓰기).

`kind`는 필수 필드다. **`.default()`를 걸지 마라** — 구 `context.json`은 `citations`가 애초에 빈 배열(`[]`)이라 마이그레이션할 원소가 없다. 실제로 8개 run 전부 `citations: []`임을 확인했다. 빈 배열은 원소 스키마와 무관하게 통과한다.

`GroundingCitation` 타입(`gemini.ts`가 쓰는 것)과 `Citation`(zod 추론) 사이에 불일치가 생기지 않게 하라 — `gemini.ts`가 `src/types`의 타입을 import해 쓰고 있다면 그대로 따르고, 별도 정의라면 `kind`를 양쪽에 반영하라.

### 3. `src/services/gemini.test.ts` — 폐기 검증을 누적 검증으로 뒤집는다

이 파일에 **"1차는 JSON 형식 실패 — 그 시도의 groundingMetadata(A)는 함께 버려져야 한다"** 취지의 테스트가 있다. 이 테스트는 이제 **틀린 계약**을 지키고 있다. ADR-013이 이 결정을 뒤집었다.

- 해당 테스트를 **누적 검증으로 교체**하라: 1차 시도는 grounding 메타데이터(A)를 실었지만 JSON 형식 실패, 2차 시도는 JSON은 정상이나 메타데이터 없음 → **최종 citations에 A가 보존되어야 한다.** 이것이 실전에서 8/8 run을 망친 바로 그 시나리오다.
- 테스트 이름과 주석에 **왜 뒤집었는지**를 적어라 (인용 0건 + 환각 필드 잔존이 더 나쁜 실패다).
- 추가할 테스트:
  - 여러 시도에 걸쳐 같은 uri가 나오면 dedup되는가
  - `origin`과 `redirect`에 같은 uri가 있으면 `origin`이 이기는가
  - `urlRetrievalStatus`가 SUCCESS가 아닌 urlMetadata는 제외되는가 (기존 동작 회귀 방지)
  - 메타데이터가 전혀 없어도 빈 배열을 반환하고 throw하지 않는가 (기존 동작 회귀 방지)

**CRITICAL**: Gemini는 반드시 mock으로 대체하라. API 키 없이 `npm test`가 통과해야 한다. 기존 테스트의 fake response 헬퍼(`asResponse` 등)를 재사용하라.

### 4. 호출부 정합

`src/agents/contextHunter.ts`의 `const { data, citations, webSearchQueries } = await deps.gemini.generateGrounded({...})` 는 **시그니처가 바뀌지 않는다** — `generateGrounded`는 여전히 `{ data, citations, webSearchQueries }`를 반환한다. `responses` 누적은 `generateValidated` ↔ `generateGrounded` 사이의 내부 구현이다. contextHunter는 이 step에서 **수정하지 않는다** (step 3의 몫이다).

단, `generateStructured`도 `generateValidated`를 쓰므로 반환 타입 변경에 맞춰 조정이 필요하다 (`response` → `responses`). `generateStructured`는 citations를 쓰지 않으므로 `data`만 꺼내면 된다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint    # ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 다음을 직접 확인하라:
   - `src/services/gemini.test.ts`에 "실패한 시도의 grounding 메타데이터가 보존된다"는 취지의 테스트가 있고 통과하는가
   - `CitationSchema`에 `kind`가 있고, `extractCitations`가 origin/redirect를 올바르게 태깅하는가
3. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/` 밖으로 새지 않았는가?
   - 테스트가 실제 Gemini API를 호출하지 않는가? (API 키 없이 `npm test`가 통과해야 한다)
   - ADR-013의 결정에서 벗어나지 않았는가?
4. 결과에 따라 `phases/5-source-integrity/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (변경된 시그니처를 반드시 포함 — step 2·3이 이걸 읽는다)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`citations`가 비어 있을 때 throw하지 마라.** 이유: grounding이 아무것도 못 찾는 것은 정상적인 결과다. 그 사실은 step 5의 커버리지 표시로 드러낸다 — 파이프라인을 죽이는 것이 아니라.
- **실패한 시도의 response를 "오염"으로 취급해 필터링하지 마라.** 이유: 그 시도에서 웹검색은 실제로 일어났고 인용은 실재한다. 실패한 것은 JSON 형식이지 검색이 아니다. 이것을 버리는 것이 바로 이 step이 고치는 버그다.
- `kind`에 `.default("redirect")`를 걸지 마라. 이유: 기본값은 잘못된 데이터를 조용히 통과시킨다. 구 데이터는 `citations: []`라 마이그레이션 대상 원소가 없음을 이미 확인했다.
- `src/agents/contextHunter.ts`의 프롬프트나 `communityVoices` 처리를 건드리지 마라. 이유: step 3의 scope다. 이 step은 `services/` 레이어에 한정한다.
- 기존 테스트를 깨뜨리지 마라 — 단, 위에 명시한 "폐기 검증" 테스트 **하나만은 의도적으로 교체**한다.
