# Step 1: research-types

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ADR.md` — 특히 **ADR-012**(step 0에서 추가됨), ADR-011(스키마 변경 시 구 run 하위호환)
- `/docs/ARCHITECTURE.md` — 데이터 흐름, 상태 관리
- `/src/types/marketContext.ts` — 이 step이 재작성할 파일
- `/src/types/marketContext.test.ts` — 기존 테스트
- `/src/types/dialectic.ts` — **공유 좌표계를 leaf 파일로 두는 선례.** `src/types/research.ts`가 따를 패턴
- `/src/types/index.ts` — barrel export
- `/src/agents/contextHunter.ts` — 프롬프트의 출력 JSON 예시가 스키마와 동기화되어야 한다
- `/src/agents/contextHunter.test.ts` — **`:195-201`의 프롬프트-스키마 계약 테스트**. 이 step이 강화한다
- `/src/lib/report.ts` — `voiceBlock`, `rawEvidenceDetails`
- `/web/src/components/report/MarketContextSection.tsx` — `YoutubeVoiceCard`, `evidenceSummary`

## 배경

자료조사를 3소스(YouTube / Hacker News / 네이버)로 확장하기 위한 **타입 레이어**를 먼저 놓는다.
이 step에서는 아직 새 소스를 수집하지 않는다 — 스키마만 바꾸고, 기존 YouTube 데이터가 새 스키마에
`source: "youtube"`로 담기게 한다.

**타입이 맨 앞에 오는 이유**: 스키마에 `citations`가 먼저 있어야 step 5(grounding 인용 추출)에서
추출한 인용을 **바로 주입**할 수 있다. 타입을 뒤로 미루면 "일단 버렸다가 나중에 주입"하는 이중 작업이 생긴다.

### 핵심 설계 (ADR-012)

**1. 정규화된 `CommunityVoice`.** 소스별 스키마 3개를 두지 않는다. 수집물의 소비처는 프롬프트 마크다운과
아코디언 렌더 둘뿐이고, 둘 다 "인용문 + 출처 링크 + 작성자 + 인기도" 4-튜플이다. 소스별 타입을 끝까지 끌면
스키마 3개 × 프롬프트 JSON 예시 3블록 × 렌더러 3개 × 웹 카드 3개로 비용이 곱해진다. 특히 **grounding 모드는
`responseSchema`를 못 써서 프롬프트의 JSON 예시가 유일한 형식 지시**이므로, 예시 블록이 3배가 되면 형식
실패율이 3배 리스크가 된다.

**2. `citations[]`는 `sources[]`를 대체하지 않고 공존한다.**

| 필드 | 채우는 주체 | 실패 모드 |
|---|---|---|
| `sources: string[]` (기존 유지) | **LLM 자기보고** | 부정확할 수 있음. 안 만료됨 |
| `citations: Citation[]` (신규) | **코드**가 groundingMetadata에서 추출 (step 5) | 정확함. uri가 만료될 수 있음 |

Gemini의 `groundingChunks[].web.uri`는 원 사이트 URL이 아니라 `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
형태의 **만료되는 리다이렉트 URL**이다. 두 필드의 실패 모드가 상보적이라 합치면 안 된다.

**3. 구 run 하위호환은 `.default([])`가 아니라 `z.preprocess` 승격이다.**
`communityVoices`에 `.default([])`만 걸면 구 `context.json`은 파싱은 되지만, zod object의 기본 `strip` 정책 때문에
**`youtubeVoices` 키가 모르는 키로 조용히 버려져** 구 run의 유저 목소리가 리포트에서 사라진다.
ADR-011의 "빈 리포트"가 "반쯤 빈 리포트"로 바뀔 뿐이다. 반드시 `z.preprocess`로 승격하라.

**4. `communityVoices`는 LLM이 채운다 (코드 주입 아님).** 수집 원본은 노이즈가 지배적이다(YouTube 인사말·광고,
네이버 블로그 SEO 스팸). contextHunter 시스템 프롬프트의 "노이즈를 제거하고 유의미한 것만 선별" 지시가
실제 가치의 절반이다. 코드가 수집물을 통째로 주입하면 리포트가 스팸으로 채워진다.
**`citations`만 코드 주입이다** — 그건 사실이지 판단이 아니니까.

## 작업

### 1. `src/types/research.ts` (신설)

`src/types/dialectic.ts`처럼 **zod만 import하는 leaf 파일**로 만든다(순환 import 방지).

```ts
export const RESEARCH_SOURCE_IDS = ["youtube", "hackernews", "naver"] as const;
export const ResearchSourceIdSchema: z.ZodEnum</* … */>;
export type ResearchSourceId = (typeof RESEARCH_SOURCE_IDS)[number];

/** 소스 표시 라벨 — report.ts와 web이 이 상수 하나만 쓴다 (라벨 하드코딩 금지) */
export const SOURCE_LABELS: Record<ResearchSourceId, string>;
//   youtube: "YouTube", hackernews: "Hacker News", naver: "네이버"

/** researchPlanner 산출물 (step 7에서 사용). 여기서 정의만 해 둔다 */
export const SearchQueriesSchema: /* z.object */;
//   youtube:    string (min1)  — 한국어
//   hackernews: string (min1)  — 반드시 영어
//   naver:      string (min1)  — 한국어
//   web:        string[] (min1, max3) — grounding 힌트
export type SearchQueries = z.infer<typeof SearchQueriesSchema>;
```

`SearchQueriesSchema`의 각 필드에 **한국어/영어 요구사항을 JSDoc 주석으로 남겨라.** step 7이 이 주석을 읽는다.

### 2. `src/types/marketContext.ts` (재작성)

```ts
export const CitationSchema = z.object({
  uri: z.url(),
  title: z.string().optional(),
  domain: z.string().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const CommunityVoiceSchema = z.object({
  source: ResearchSourceIdSchema,
  title: z.string().min(1),      // 출처 문서 제목 (영상/스토리/글)
  url: z.url(),                  // 출처 퍼머링크
  text: z.string().min(1),       // 인용 원문
  authorName: z.string().optional(),
  score: z.number().int().nonnegative().optional(),   // 좋아요 | points — "인기도"로 단일화
  extra: z.string().optional(),  // 소스별 부가 1줄 ("검색 스니펫" 등)
});
export type CommunityVoice = z.infer<typeof CommunityVoiceSchema>;

/** LLM이 프롬프트 JSON 예시로 지시받아 채우는 부분 — grounding 호출의 schema */
export const MarketContextDraftSchema = z.object({
  ideaTitle, briefing, marketSizeIndicators, competitorInsight, voicesInsight,
  trends, competitors, painPointEvidence, sources,          // ← 전부 기존 그대로
  communityVoices: z.array(CommunityVoiceSchema),           // ← youtubeVoices를 대체
});

/** 코드가 주입하는 키. 프롬프트에 절대 넣지 않는다 — LLM이 인용을 지어내면 안 된다 */
export const CODE_INJECTED_CONTEXT_KEYS = ["citations"] as const;

/** 저장·소비되는 최종 형태. `.shape` 접근이 필요한 테스트·계약 검증은 이걸 쓴다 */
export const MarketContextObjectSchema = MarketContextDraftSchema.extend({
  citations: z.array(CitationSchema).default([]),
});

/** 구 run 하위호환: youtubeVoices[] → communityVoices[] 승격 */
export const MarketContextSchema = z.preprocess(/* … */, MarketContextObjectSchema);
export type MarketContext = z.infer<typeof MarketContextSchema>;
```

`CompetitorServiceSchema`는 **그대로 유지**한다. `YoutubeVoiceSchema`는 **삭제**한다.

**preprocess 함수의 계약** (정확히 지켜라):

- 입력이 `null`·비객체·배열이면 **그대로 통과**시킨다(zod가 타입 에러를 내게 둔다).
- `communityVoices`가 이미 있으면 **손대지 않는다**(신 형식).
- `communityVoices`가 없고 `youtubeVoices`가 배열이면 승격한다:
  `videoTitle→title`, `videoUrl→url`, `comment→text`, `authorName→authorName`, `likeCount→score`,
  `source: "youtube"` 주입. **원본 `youtubeVoices` 키는 제거**한다.
- 승격은 **키 매핑만** 한다. 값 검증은 zod가 한다 — 매핑 중에 throw하지 마라(손상된 구 데이터는
  `loadStepOutput`이 `null`로 처리하는 기존 경로를 타야 한다).

### 3. `src/types/index.ts`

`export * from "./research.js";` 추가.

### 4. 소비자 — **컴파일·테스트 green 보전을 위한 기계적 최소 수정만**

> **제대로 된 렌더링(소스별 그룹핑·뱃지·검색 인용 소절)은 step 8의 일이다.**
> 이 step에서는 필드 이름만 갈아끼워 green을 유지하라. 새 UI를 만들지 마라.

아래가 `youtubeVoices`/`YoutubeVoice`를 참조하는 **전체 목록**이다 (`web/.next/` 빌드 산출물 제외):

**src/**
- `src/agents/contextHunter.ts` — 프롬프트 템플릿의 출력 JSON 예시에서 `"youtubeVoices"` 키를
  `"communityVoices"`로 바꾸고 필드를 새 모양(`source`/`title`/`url`/`text`/`authorName`/`score`)으로 교체.
  시스템 프롬프트의 `youtubeVoices` 언급도 `communityVoices`로. **`formatYoutubeSection`·수집 로직·
  `YOUTUBE_EMPTY_SECTION`은 건드리지 마라 — step 6의 범위다.**
  프롬프트에 "source 필드는 youtube / hackernews / naver 중 하나"임을 명시하라(지금은 youtube만 수집되지만
  스키마가 enum이므로 LLM이 알아야 한다).
- `src/lib/report.ts` — `voiceBlock(voice: YoutubeVoice)` → `voiceBlock(voice: CommunityVoice)`.
  필드 접근을 `voice.text` / `voice.title` / `voice.url` / `voice.score`로 교체.
  `rawEvidenceDetails`의 `context.youtubeVoices` → `context.communityVoices`,
  summary 문자열의 "유저 목소리 N건"은 그대로, 빈 배열 문구는 "수집된 YouTube 목소리 없음" →
  **"수집된 유저 목소리 없음"**. `import type { YoutubeVoice }` → `CommunityVoice`.
- `src/agents/{coldCritic,solutionDesigner,thesis,verdict}.test.ts` — MarketContext fixture의 필드명 교체
- `src/lib/report.test.ts`, `src/lib/runStore.test.ts`, `src/pipeline/orchestrator.test.ts` — fixture 교체
- `src/pipeline/e2e.test.ts` — `CONTEXT_TEXT`(LLM 응답 원문 문자열)의 `youtubeVoices` → `communityVoices`.
  ⚠️ **`"url": null` 같은 실측 실패 형태는 반드시 유지하라** — `stripNullProps`의 회귀 커버리지다.

**web/**
- `web/src/components/report/MarketContextSection.tsx` — `YoutubeVoiceCard`의 필드 접근을 새 이름으로.
  **컴포넌트 이름·구조·`<figure>/<blockquote>/<figcaption>` 마크업은 그대로 두어라** (step 8이 재작성).
  `evidenceSummary()`의 `context.youtubeVoices.length` → `context.communityVoices.length`.
- `web/src/test/clientFixtures.ts`, `web/src/test/components/report.test.tsx`,
  `web/src/test/schema-share.test.tsx`, `web/src/test/server/runs.test.ts` — fixture·단언 교체
- `web/src/test/fixtures/*/context.json` (3개: fx01/fx02/fx03) — ⚠️ **여기는 특별하다. 아래를 읽어라.**

#### fixture `context.json` 3개는 `youtubeVoices` 구 형식 그대로 둔다

`web/src/test/fixtures/*/context.json`은 **디스크의 구버전 run을 시뮬레이션하는 데이터**다.
새 형식으로 갈아엎으면 preprocess 승격 경로가 아무 테스트에도 걸리지 않는다.

**최소 1개(fx01)는 `youtubeVoices` 구 형식을 유지**하고, `web/src/test/schema-share.test.tsx`가
`MarketContextSchema.parse(fixture)` 후 **`communityVoices[0].source === "youtube"`로 승격을 단언**하게 하라.
나머지 2개는 새 형식으로 바꿔도 되고 유지해도 된다 — 다만 **하나라도 구 형식이 남아야 한다.**
이렇게 하면 ADR-006(스키마 단일 소스)과 하위호환을 한 테스트가 동시에 지킨다.

## 테스트 (TDD — 먼저 작성한다)

### `src/types/marketContext.test.ts` (확장) — **이 step의 최고 가치 테스트**

1. **구 run 승격**: `youtubeVoices`가 있고 `communityVoices`가 없는 객체 →
   `MarketContextSchema.parse()` **성공** + `communityVoices[0]`이
   `{ source: "youtube", title: <videoTitle>, url: <videoUrl>, text: <comment>, score: <likeCount> }`로 매핑됨.
   `youtubeVoices` 키는 결과에 남지 않는다.
2. **신 형식 라운드트립**: `communityVoices`가 있으면 승격 로직이 개입하지 않는다.
   `youtubeVoices`와 `communityVoices`가 **둘 다** 있으면 `communityVoices`가 이긴다.
3. **`citations` 기본값**: `citations` 키가 없으면 `[]`.
4. **`source` enum 검증**: `source: "reddit"` 같은 미지 값은 거부된다.
5. 기존의 "필수 필드가 빠지면 거부한다" 계열 테스트는 **유지**한다(`sources` 삭제 시 실패 등).

### `src/agents/contextHunter.test.ts` — 프롬프트-스키마 계약 테스트 **강화**

기존 `:195-201`의 계약 테스트를 아래로 **대체**하라:

```ts
const llmKeys = Object.keys(MarketContextDraftSchema.shape);
for (const k of llmKeys) {
  expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).toContain(`"${k}"`);
}
// 코드 주입 키는 프롬프트에 없어야 한다 — LLM이 인용을 지어내면 안 된다
for (const k of CODE_INJECTED_CONTEXT_KEYS) {
  expect(CONTEXT_HUNTER_PROMPT_TEMPLATE).not.toContain(`"${k}"`);
}
// draft + injected = 최종 스키마 키 전체
expect(new Set([...llmKeys, ...CODE_INJECTED_CONTEXT_KEYS]))
  .toEqual(new Set(Object.keys(MarketContextObjectSchema.shape)));
```

세 번째 단언이 진짜 강화다 — MarketContext에 필드를 추가하면서 **프롬프트에도 안 넣고 코드 주입으로도
선언 안 하는 게 불가능**해진다.

### `web/src/test/schema-share.test.tsx`

구 형식 fixture가 `MarketContextSchema`를 통과하고 `communityVoices`로 승격되는지 단언한다(위 4절 참조).

## Acceptance Criteria

```bash
npm run build     # 루트 tsc + next build — 에러 0
npm test          # vitest run && npm run test -w web — 전부 통과
npm run lint
grep -rq "youtubeVoices" src/types/marketContext.ts && echo "FAIL: 스키마에 youtubeVoices가 남아 있다" && exit 1
grep -q "communityVoices" src/agents/contextHunter.ts   # 프롬프트 JSON 예시가 갱신됐는가
```

**API 키 없이 통과해야 한다** (CLAUDE.md CRITICAL).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `MarketContextSchema`가 `z.preprocess`로 감싸졌으므로 `.shape`에 접근할 수 없다.
   `orchestrator.ts`의 `executeStep`과 `runStore.ts`의 `loadStepOutput`이 제네릭 베이스 `ZodType<T>`를
   받으므로 `ZodPipe` 할당은 통과해야 한다. **`npm run build`가 여기서 깨지면** 폴백은:
   preprocess를 포기하고 `communityVoices.default([])` + `youtubeVoices.default([])`(deprecated) 두 필드를
   공존시키고 `allVoices(context)` 어댑터를 `src/types/marketContext.ts`에서 export한다.
   폴백을 썼다면 **반드시 summary에 적어라** — step 8이 렌더링에서 이를 알아야 한다.
3. 아키텍처 체크리스트:
   - 타입·스키마가 `src/types/`에 있고 web은 `@anvil/types`로 import하는가? (중복 정의 0 — ADR-006)
   - `src/types/research.ts`가 zod만 import하는 leaf인가? (순환 import 없음 — dialectic.ts 선례)
   - 테스트가 API 키 없이 통과하는가?
4. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 **export한 심볼 전체**(`RESEARCH_SOURCE_IDS`, `SOURCE_LABELS`, `SearchQueriesSchema`,
     `CitationSchema`, `CommunityVoiceSchema`, `MarketContextDraftSchema`, `MarketContextObjectSchema`,
     `MarketContextSchema`, `CODE_INJECTED_CONTEXT_KEYS`)와 **구 형식을 유지한 fixture 경로**,
     그리고 2번의 폴백을 썼는지 여부를 반드시 포함하라. step 5·6·7·8이 전부 이 심볼들을 쓴다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **`communityVoices`에 `.default([])`만 걸고 끝내지 마라.** 이유: zod object의 기본 `strip` 정책 때문에
  구 `context.json`의 `youtubeVoices` 키가 **조용히 버려져** 구 run의 유저 목소리가 리포트에서 사라진다.
  파싱은 성공하므로 테스트가 통과해 보이지만 데이터가 소실된다. 반드시 `z.preprocess`로 승격하라.
- **`citations`를 프롬프트의 출력 JSON 예시에 넣지 마라.** 이유: `citations`는 코드가 `groundingMetadata`에서
  추출해 주입하는 **사실**이다. LLM에게 채우라고 하면 URL을 지어낸다 — 그건 지금 고치려는 바로 그 버그다.
  계약 테스트가 이를 강제한다.
- **`sources` 필드를 삭제하거나 `citations`로 대체하지 마라.** 이유: `groundingChunks`의 uri는 만료되는
  리다이렉트 URL이다. 두 필드의 실패 모드가 상보적이라 공존해야 한다 (ADR-012).
- **`web/src/test/fixtures/*/context.json`을 전부 새 형식으로 바꾸지 마라.** 이유: 최소 하나는 구 형식이어야
  preprocess 승격 경로가 테스트에 걸린다. 전부 바꾸면 하위호환이 무테스트 상태가 된다.
- **`src/agents/contextHunter.ts`의 수집 로직(`formatYoutubeSection`, `collectVoices` 호출, try/catch,
  `YOUTUBE_EMPTY_SECTION`)을 건드리지 마라.** 이유: 소스 추상화는 step 6의 범위다. 이 step은 프롬프트의
  **출력 JSON 예시**만 갱신한다.
- **`web/src/components/report/MarketContextSection.tsx`를 재설계하지 마라.** 이유: 소스별 그룹핑·뱃지·
  검색 인용 소절은 step 8의 범위다. 여기서는 필드 이름만 갈아끼워 컴파일을 통과시킨다.
- **`src/pipeline/e2e.test.ts`의 `CONTEXT_TEXT`에서 `"url": null` 형태를 없애지 마라.** 이유: grounding 모델이
  optional 필드에 명시적 `null`을 넣는 실측 실패를 재현하는 회귀 테스트다. `stripNullProps`가 이걸 막고 있다.
- `CompetitorServiceSchema`를 바꾸지 마라. 이유: 이번 phase의 범위가 아니다.
- 테스트에서 실제 Gemini/YouTube API를 호출하지 마라. 이유: CLAUDE.md CRITICAL.
- 기존 테스트를 깨뜨리지 마라.
