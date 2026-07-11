# Step 3: voice-reference-injection

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-012**, **ADR-013**(step 0에서 추가됨 — 이 step의 직접 근거)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md`
- `src/agents/contextHunter.ts` — `CONTEXT_HUNTER_PROMPT_TEMPLATE`, `runContextHunter`. 주 수정 대상
- `src/research/format.ts` — `formatEvidenceSection`, `voiceBlock`, `EVIDENCE_EMPTY_SECTION`. 주 수정 대상
- `src/types/marketContext.ts` — `MarketContextDraftSchema`, `MarketContextObjectSchema`, `CODE_INJECTED_CONTEXT_KEYS`, `promoteLegacyVoices`
- `src/types/research.ts` — `ResearchEvidence`, `SourceCoverage`, `CommunityVoice` (step 2에서 정비됨)
- `src/agents/contextHunter.test.ts`, `src/research/format.test.ts`

## 배경 — 고쳐야 할 것

현재 프롬프트는 LLM에게 **목소리 객체를 통째로 출력하라**고 시킨다:

```
"communityVoices": [{ "source": "youtube", "title": "출처 문서 제목(영상·글)", "url": "출처 퍼머링크", "text": "인용 원문 그대로", ... }],
```

즉 **LLM이 URL과 인용 원문을 손으로 타이핑한다.** 방어는 프롬프트 문장("수집 결과에 실제로 존재하는 문서·댓글만 사용하라")뿐이고, 코드에는 아무 강제가 없다. `CommunityVoiceSchema.url`의 `z.url()`은 형식만 볼 뿐 **출처를 검증하지 않는다** — `https://www.youtube.com/watch?v=TOTALLYFAKE`도 통과한다.

실제 산출물에 이 실패가 남아 있다. `sources[]`에 저장된 문자열 하나:
```
https://vertexaisearch.cloud.google.google.com/grounding-api-redirect/AUZIYQEe... [4] 10 Best AI Meeting Assistants and Note-Takers in 2026 - We360.ai
```
도메인에 `.google`이 중복됐고(같은 파일의 나머지 29개는 정상), URL·각주번호·제목이 한 문자열로 뭉개져 있다. **코드가 주입한 URL은 오타가 날 수 없다.** 모델이 URL을 받아적고 있다는 증거다.

**해법**: LLM에게서 URL을 타이핑할 자리를 **아예 없앤다.** 목소리 선별은 여전히 LLM의 판단(노이즈 제거)이지만, 선별의 결과는 **ID 참조**로만 표현한다. 사실(원문·출처·작성자·인기도)은 코드가 소유한다.

## 작업

### 1. `src/research/format.ts` — 증거에 안정적 ID를 부여하고 URL을 프롬프트에서 제거

- `formatEvidenceSection(evidence)`가 각 voice에 **`V1`, `V2`, … 형태의 안정적 ID**를 부여해 프롬프트에 제시한다. ID는 **`evidence.voices` 배열의 인덱스 기준 1-origin**이며, 소스별로 리셋하지 않는다(전역 연번). 이유: `runContextHunter`가 ID → voice를 인덱스로 복원해야 하고, 소스별 리셋은 충돌한다.
- ID 생성과 해석이 **한 곳에 있어야 한다.** `format.ts`에 export하라:
  ```ts
  export function voiceRefId(index: number): string;          // 0 → "V1"
  export function parseVoiceRef(ref: string): number | null;  // "V1" → 0, 잘못된 형식이면 null
  ```
  `runContextHunter`가 `parseVoiceRef`를 쓴다. 문자열 포맷을 양쪽에 중복 구현하지 마라.
- **`voiceBlock`에서 URL 출력을 제거하라.** 현재는 `- 출처: ${voice.title} — ${voice.url}`을 찍는다. 이제 URL은 프롬프트에 **넣지 않는다.** 모델이 볼 수 없는 URL은 받아적을 수도 없다 — 이것이 이 step의 핵심 방어선이다. 대신 ID·제목·소스 라벨·작성자·인기도만 제시한다. 예시 형태(정확한 문구는 재량):
  ```
  ### YouTube — 3건
  - [V1] (김범조, 인기도 5) 시작 비용이 조금 크더라고요
    - 출처: 갑자기 뭔데!?#오토바이
  ```
- `EVIDENCE_EMPTY_SECTION`의 문구를 갱신하라. 현재 `"...communityVoices는 빈 배열로 출력하고..."`라고 되어 있는데, 이제 LLM은 `communityVoices`를 출력하지 않는다 → `communityVoiceRefs`로 고쳐라.
- **0건인 소스도 "0건"으로 적는 기존 동작을 유지하라** (`sourceBlock`). 실패 섹션(`failureLine`)도 유지한다.

### 2. `src/types/marketContext.ts` — communityVoices를 코드 주입 필드로 전환

- `MarketContextDraftSchema`에서 **`communityVoices`를 제거**하고 대신 넣는다:
  ```ts
  /** LLM이 선별한 목소리의 ID 참조. 원문·URL은 코드가 evidence에서 복원한다 (ADR-013) */
  communityVoiceRefs: z.array(z.string().min(1)),
  ```
- `MarketContextObjectSchema`는 draft에서 `communityVoiceRefs`를 **덜어내고** 해소된 `communityVoices`를 얹는다:
  ```ts
  export const MarketContextObjectSchema = MarketContextDraftSchema
    .omit({ communityVoiceRefs: true })
    .extend({
      communityVoices: z.array(CommunityVoiceSchema).default([]),
      citations: z.array(CitationSchema).default([]),
      researchCoverage: z.array(SourceCoverageSchema).default([]),
    });
  ```
  `communityVoiceRefs`를 최종 산출물에 남기지 않는 이유: 해소된 `communityVoices`가 이미 그 정보를 담고 있고, ref는 `research.json`의 인덱스에 의존하는 내부 좌표라 산출물에 남기면 두 개의 진실이 된다.
- `CODE_INJECTED_CONTEXT_KEYS`에 `"communityVoices"`를 추가한다. (step 2에서 `"researchCoverage"`가 이미 추가됐다. 최종적으로 `["citations", "researchCoverage", "communityVoices"]`.)
- **`promoteLegacyVoices` preprocess를 절대 제거하지 마라.** 구 `context.json`의 `youtubeVoices[]` → `communityVoices[]` 승격은 ADR-012의 하위호환 규정이다. `communityVoices`가 `MarketContextObjectSchema`에 그대로 있으므로 이 preprocess는 **변경 없이 계속 동작한다.**

### 3. `src/agents/contextHunter.ts` — 프롬프트 수술 + ID 해소

**프롬프트 (`CONTEXT_HUNTER_PROMPT_TEMPLATE`)**:
- 출력 JSON 예시에서 `communityVoices` 객체 배열을 삭제하고 교체:
  ```
  "communityVoiceRefs": ["V3", "V7"],
  ```
- 지시문을 추가하라: **수집 결과 섹션의 `[V*]` ID 중에서만 고를 것. 새 ID를 만들어내지 말 것. 인용 원문을 다시 적지 말 것 — ID만 적으면 코드가 원문을 붙인다.**
- 기존 방어 문장("수집 결과에 실제로 존재하는 문서·댓글만 사용하라")은 남겨도 된다. 다만 이제 진짜 방어는 코드가 한다.
- 프롬프트 JSON 예시의 키 집합이 `MarketContextDraftSchema`의 키 집합과 일치해야 한다. 이 계약을 검증하는 기존 테스트가 있으면 함께 갱신하라 (`marketContext.ts`의 주석이 이 계약의 존재를 명시한다).

**`runContextHunter`의 해소 로직**:
```ts
const { data, citations } = await deps.gemini.generateGrounded({ ..., schema: MarketContextDraftSchema });

// LLM은 ID만 고른다. 사실(원문·URL·작성자)은 코드가 evidence에서 복원한다 (ADR-013)
const communityVoices = resolveVoiceRefs(data.communityVoiceRefs, evidence.voices, deps.log);
```

`resolveVoiceRefs`의 규칙:
- `parseVoiceRef`로 인덱스를 얻어 `evidence.voices[index]`를 꺼낸다.
- **evidence에 없는 ID(범위 밖 / 형식 오류 / 중복)는 드롭한다.** 절대 지어내지 마라.
- 드롭이 발생하면 `deps.log`로 경고하라 — 예: `[context-hunter] 알 수 없는 목소리 참조 2건을 드롭했다: V99, Vfoo`. **이것이 환각을 관측하는 유일한 계기다.**
- 중복 ID는 하나로 접는다 (같은 목소리를 두 번 인용하지 않는다).
- 반환 순서는 LLM이 고른 순서를 따른다 — 선별 순서에 LLM의 우선순위 판단이 들어 있다.
- **드롭이 전부여도(0건이어도) throw하지 마라.** 빈 `communityVoices`는 합법이다 (전 소스 실패 시 정상).

최종 반환:
```ts
return {
  context: { ...draftWithoutRefs, communityVoices, citations, researchCoverage: evidence.coverage },
  evidence,
};
```
(step 2에서 `{ context, evidence }` 반환 시그니처가 이미 도입됐다.)

### 4. 테스트

- `src/research/format.test.ts`: 증거 섹션에 `[V1]`, `[V2]` ID가 전역 연번으로 붙는가 / **URL이 프롬프트 문자열에 나타나지 않는가** / 0건 소스가 "0건"으로 표기되는가(회귀) / `voiceRefId` ↔ `parseVoiceRef` 왕복.
- `src/agents/contextHunter.test.ts`:
  - LLM이 `["V2"]`를 고르면 `communityVoices[0]`이 `evidence.voices[1]`과 **정확히 동일한 객체**인가 (url·text·authorName 전부)
  - LLM이 `["V99"]`(범위 밖) / `["Vfoo"]`(형식 오류)를 고르면 드롭되고 `deps.log`에 경고가 남는가
  - LLM이 `["V1", "V1"]`을 고르면 하나로 접히는가
  - LLM이 **evidence에 없는 URL을 지어낼 방법이 없는지** — draft 스키마에 `url` 필드가 없음을 확인하는 계약 테스트
  - 전부 드롭되어도 throw하지 않는가
- `src/types/marketContext.test.ts`: `MarketContextDraftSchema`에 `communityVoices`가 **없고** `communityVoiceRefs`가 **있는지** / `MarketContextObjectSchema`에 `communityVoiceRefs`가 **없고** `communityVoices`가 **있는지** / **구 `context.json`의 `youtubeVoices` 승격이 여전히 동작하는지(회귀)** / `CODE_INJECTED_CONTEXT_KEYS`가 `["citations", "researchCoverage", "communityVoices"]`인지.

**CRITICAL**: Gemini는 반드시 mock으로 대체하라. API 키 없이 `npm test`가 통과해야 한다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint    # ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **직접 확인하라**: `CONTEXT_HUNTER_PROMPT_TEMPLATE` 전문을 출력해, LLM이 URL을 적어낼 수 있는 자리가 `competitors[].url`과 `sources[]` 외에 **하나도 없는지** 눈으로 확인하라. (그 둘은 step 4에서 링크가 박탈된다.)
3. 아키텍처 체크리스트:
   - `research/`가 직접 fetch하지 않는가?
   - `MarketContextDraftSchema`(=LLM이 채우는 키)에 url을 타이핑할 필드가 새로 생기지 않았는가?
   - 구 run 하위호환(`youtubeVoices` 승격)이 깨지지 않았는가?
4. 결과에 따라 `phases/5-source-integrity/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (communityVoices가 코드 주입 필드가 되었음을 명시 — step 4가 이걸 읽고 링크 유지 판단을 한다)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **evidence에 없는 ID를 "가장 비슷한 목소리"로 매칭하지 마라.** 이유: 퍼지 매칭은 환각을 그럴듯한 인용으로 세탁한다. 모르는 ID는 드롭하고 로그를 남기는 것이 유일하게 정직한 처리다.
- **`voiceBlock`에 URL을 다시 넣지 마라.** 이유: 모델이 볼 수 없는 URL은 받아적을 수도 없다. 프롬프트에서 URL을 빼는 것이 이 step의 핵심 방어선이며, 실제로 모델이 URL을 손으로 옮겨적다가 도메인 오타(`cloud.google.google.com`)를 낸 증거가 있다.
- **`promoteLegacyVoices` preprocess를 제거하지 마라.** 이유: ADR-012 하위호환 규정이다. 제거하면 구 run 8개가 리포트 뷰에서 빈 상태가 된다.
- **`communityVoiceRefs`를 최종 `MarketContext`에 남기지 마라.** 이유: research.json의 인덱스에 의존하는 내부 좌표다. 산출물에 남으면 해소된 `communityVoices`와 두 개의 진실이 된다.
- **`CommunityVoiceSchema.url`을 `z.string()`으로 완화하지 마라.** 이유: 이제 이 값은 코드가 API 응답에서 만든 것이라 항상 유효한 URL이다. 검증을 약화할 이유가 없다.
- 기존 테스트를 깨뜨리지 마라.
