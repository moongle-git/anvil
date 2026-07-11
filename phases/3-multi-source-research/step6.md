# Step 6: research-layer

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — **CRITICAL: 외부 API 호출은 `src/services/`에서만.** `research/`는 직접 fetch하지 않는다
- `/docs/ADR.md` — **ADR-012**(소스 정규화·병렬 수집·fail-soft), ADR-004(하네스 패턴의 "분기·병렬은 직접 확장")
- `/docs/ARCHITECTURE.md` — **`src/research/` 계층**(step 0에서 추가됨), 데이터 흐름
- `/src/types/research.ts` — step 1. `RESEARCH_SOURCE_IDS`, `SOURCE_LABELS`
- `/src/types/marketContext.ts` — step 1. `CommunityVoiceSchema`
- `/src/services/youtube.ts` — `collectVoices()`, `YoutubeVideo`, `YoutubeComment`
- `/src/services/hackerNews.ts` — step 3. `collect()`, `HackerNewsStory`, `HackerNewsComment`
- `/src/services/naver.ts` — step 4. `collect()`, `NaverPost`
- `/src/agents/contextHunter.ts` — `formatYoutubeSection`, `YOUTUBE_EMPTY_SECTION`, try/catch fail-soft
- `/src/pipeline/orchestrator.ts` — `PipelineDeps`(`:25-30`), context-hunter 호출부(`:198-204`)
- `/src/pipeline/orchestrator.test.ts` — `fakeYoutube()`, `makeDeps()`. step 5가 `fakeGemini`를 이미 고쳤다
- `/src/pipeline/e2e.test.ts` — **`youtubeFetch()`의 `url.includes("/search")` 분기(`:47`). 이 step이 반드시 고친다**
- `/src/cli/index.ts` — `buildYoutubeService()`(`:29-40`), deps 조립(`:69-73`)

## 배경

소스가 3개가 되면 두 가지가 무너진다.

1. **지연이 선형 증가한다.** `contextHunter.ts:97`은 YouTube 하나를 순차로 부른다. HN·네이버를 그냥 이어 붙이면
   `sum(모든 소스)`가 된다. `Promise.allSettled`로 병렬화하면 `max(가장 느린 소스)`가 된다.
   ADR-004가 "분기·병렬 실행이 필요해지면 직접 확장해야 한다"고 명시한 바로 그 지점이다.
2. **contextHunter가 소스마다 `formatXSection()`을 하나씩 갖게 된다.** 프롬프트 placeholder도 3개가 된다.

이 step은 소스를 **정규화된 `CommunityVoice`로 통일**하고, **병렬 수집**하고, **fail-soft**를 한 곳에 모은다.

### ★ 이 step은 배관만 깐다. 동작은 바뀌지 않는다.

CLI에는 **YouTube 소스 하나만 등록**한다. HN·네이버는 step 9에서 켠다.
이 step이 끝난 뒤 파이프라인의 실제 동작은 지금과 **동일**해야 한다 — 다만 구조가 3소스를 받을 준비가 된다.
이렇게 나누는 이유: 배관 변경(파급이 큼)과 기능 활성화(파급이 작음)를 같은 커밋에 섞으면 회귀 원인을 못 찾는다.

### 왜 레지스트리가 아니라 배열인가 (ADR-012)

소스는 정확히 3개, 전부 컴파일 타임에 알려져 있고, 생성 지점은 `src/cli/index.ts` 한 곳이다.
동적 등록도, 소스별 옵션 스키마도, 설정 파일도 필요 없다. **`readonly ResearchSource[]` 배열 자체가 레지스트리다.**
플러그인 시스템을 만들지 마라.

## 작업

### 1. `src/research/types.ts` (신설)

```ts
import type { CommunityVoice, ResearchSourceId } from "../types/index.js";

export interface ResearchSource {
  readonly id: ResearchSourceId;
  readonly label: string;                              // 프롬프트 섹션 제목 — SOURCE_LABELS에서 가져온다
  collect(query: string): Promise<CommunityVoice[]>;   // 실패 시 throw — 흡수는 collectAll의 책임
}

export interface SourceFailure {
  source: ResearchSourceId;
  message: string;
}

export interface CollectedEvidence {
  voices: CommunityVoice[];
  failures: SourceFailure[];
}
```

**이 파일은 `fetch`를 하지 않는다.** 타입과 인터페이스만이다 (CLAUDE.md CRITICAL).

### 2. `src/research/sources.ts` (신설) — 서비스 → `ResearchSource` 어댑터

각 함수는 **순수 매핑, 10~15줄**이다. 새 로직을 넣지 마라.

```ts
export function youtubeSource(service: YoutubeService): ResearchSource;
export function hackerNewsSource(service: HackerNewsService): ResearchSource;
export function naverSource(service: NaverService): ResearchSource;
```

매핑 규칙:

| 소스 | `title` | `url` | `text` | `authorName` | `score` | `extra` |
|---|---|---|---|---|---|---|
| youtube | `video.title` | `video.url` | `comment.text` | `comment.authorName` | `comment.likeCount` | — |
| hackernews (comment) | `comment.storyTitle` | `comment.url` (퍼머링크) | `comment.text` | `comment.author` | — | — |
| hackernews (story) | `story.title` | `story.url` | `story.title` | `story.author` | `story.points` | `"HN 스토리 · 댓글 {numComments}개"` |
| naver | `post.title` | `post.link` | `post.description` | `post.authorName` | — | `"검색 스니펫"` |

- **YouTube**: `collectVoices()`의 `{video, comments}[]`를 **댓글 단위로 평탄화**한다 (댓글 1개 = voice 1개).
- **HN**: 코멘트가 주력이다. 스토리도 voice로 넣되(`text`에 제목을 넣어 "이런 제품/글이 논의되고 있다"는 신호로),
  스토리 voice는 `extra`로 구분 가능하게 하라. 경쟁사 발굴 단서다.
- **★ 네이버**: `extra: "검색 스니펫"`을 **반드시** 넣어라. `description`은 ~200자 검색 스니펫이고 말줄임이
  들어 있다(step 4). 이 표시가 없으면 LLM이 잘린 문장을 완결된 원문 인용으로 리포트에 싣는다.
- `authorName`/`score`/`extra`는 값이 있을 때만 키를 넣어라 (`undefined` 명시 금지).

### 3. `src/research/collect.ts` (신설) — 병렬 수집

```ts
export async function collectAll(
  sources: readonly ResearchSource[],
  queries: Record<ResearchSourceId, string>,
): Promise<CollectedEvidence>;
```

**계약 (엄수):**

1. **`Promise.allSettled`로 병렬 실행한다.** 순차 `for` 루프 금지.
2. **절대 throw하지 않는다.** 어떤 입력에도 `{voices, failures}`를 반환한다.
3. 각 소스에 **자기 쿼리**(`queries[source.id]`)를 넘긴다.
4. rejected 소스는 `failures[]`에 `{source, message}`로 기록한다. `console.warn`도 남긴다.
5. **소스 배열이 비어 있으면** `{voices: [], failures: []}`를 반환하고 **HTTP 호출을 0회** 한다.
6. **전부 실패해도 에러가 아니다.** `{voices: [], failures: [3건]}`을 반환한다.
   (오늘의 YouTube 단독 실패 fail-soft와 동일한 계약이다.)

### 4. `src/research/format.ts` (신설) — 프롬프트 마크다운

```ts
export function formatEvidenceSection(evidence: CollectedEvidence): string;
export const EVIDENCE_EMPTY_SECTION: string;
```

- 소스별로 그룹핑하고 `SOURCE_LABELS`로 제목을 단다 (라벨 하드코딩 금지).
- 각 voice는 **원문 축자**로 싣는다. 자르지 마라.
- **★ 수집 0건인 소스도 "Hacker News: 0건"으로 명시하라.** 이유: HN이 영어 쿼리를 못 받아 조용히 0건이 되는
  실패가 눈에 안 보인다. 프롬프트에 0건이 적혀 있어야 LLM이 `voicesInsight`에서 근거 부재를 진술한다.
- **★ 실패한 소스를 섹션 끝에 명기하라**: `(수집 실패: 네이버 — 네이버 API 일일 호출 한도(25,000)를 초과했다)`.
  LLM이 "국내 커뮤니티 근거가 없다"를 스스로 말하게 하기 위해서다.
- `voices`가 전부 비고 `failures`도 없으면 `EVIDENCE_EMPTY_SECTION`을 반환한다
  (기존 `YOUTUBE_EMPTY_SECTION`의 일반화: "커뮤니티 수집 결과가 없다. communityVoices는 빈 배열로 출력하고,
  웹검색만으로 조사하라.").

### 5. `src/agents/contextHunter.ts`

- `ContextHunterDeps`: `youtube: YoutubeService` → **`sources: readonly ResearchSource[]`**.
  `log?: (message: string) => void`도 추가하라 (step 7이 쓴다).
- `formatYoutubeSection`·`YOUTUBE_EMPTY_SECTION`을 **삭제**하고 `formatEvidenceSection`·`EVIDENCE_EMPTY_SECTION`으로 교체.
- 프롬프트 템플릿의 `{youtubeSection}` → **`{evidenceSection}` 하나로 교체**. placeholder를 3개로 늘리지 마라.
- 수집 호출: `collectAll(deps.sources, queries)`.
  **이 step에서는 `queries`를 모든 소스에 아이디어 원문으로 채운다** — 소스별 쿼리 생성은 step 7이다.
  ```ts
  const queries = Object.fromEntries(RESEARCH_SOURCE_IDS.map((id) => [id, idea])) as Record<ResearchSourceId, string>;
  ```
- **try/catch를 제거하라.** `collectAll`이 절대 throw하지 않으므로 불필요하다.
- 시스템 프롬프트의 "수집된 communityVoices가 빈 배열이면 목소리를 지어내지 말고 한계를 진술하라" 지시를
  **소스별 부재까지 포괄하도록 일반화**하라 (예: "일부 소스 수집이 실패했다면 그 사실과 그로 인한 근거 편향을 진술하라").
- **네이버 스니펫 주의를 프롬프트에 명시하라**: "네이버 항목은 게시글 본문이 아니라 검색 스니펫이다.
  잘린 문장을 완결된 원문인 양 인용하지 마라."
- **urlContext 상한을 프롬프트에 명시하라**: "경쟁 서비스를 찾으면 그 공식 페이지를 직접 읽어 가격·기능을
  확인하라. 단 **가장 중요한 3곳 이하**만 읽어라." (상한이 없으면 모델이 페이지를 십수 개 읽어 입력 토큰이 폭발한다.)

### 6. `src/pipeline/orchestrator.ts`

`PipelineDeps`: `youtube: YoutubeService` → **`sources: readonly ResearchSource[]`**.
context-hunter 호출부에서 `deps.sources`와 `deps.log`를 넘긴다.

### 7. `src/cli/index.ts` — **YouTube만 등록 (동작 무변화)**

`buildYoutubeService()`(`:29-40`)의 "항상 reject하는 가짜 `fetchFn`" 트릭은 **step 9에서 삭제**한다.
이 step에서는 최소 변경으로 `sources` 배열을 만든다:

```ts
const sources: ResearchSource[] = [youtubeSource(buildYoutubeService(apiKey))];
```

키가 없을 때의 동작(가짜 fetchFn → 수집 실패 → 웹검색만으로 진행)이 **그대로 유지**되어야 한다.
이제 그 실패를 `collectAll`이 `failures[]`로 흡수한다.

### 8. `src/pipeline/e2e.test.ts` — **★ fetch mock 분기를 반드시 고쳐라**

현재 `:47`이 `url.includes("/search")`로 YouTube search/comments를 가른다.
그런데 **세 API가 전부 경로에 `/search`를 포함한다**:
- YouTube: `www.googleapis.com/youtube/v3/search`
- HN: `hn.algolia.com/api/v1/search`
- 네이버: `openapi.naver.com/v1/search/cafearticle.json`

안 고치면 테스트가 **조용히 잘못된 body**를 먹는다. **host 우선 분기 + 미지 host throw**로 재작성하라:

```ts
const u = new URL(String(input));
if (u.host === "www.googleapis.com") return u.pathname.endsWith("/search") ? YT_SEARCH : YT_COMMENTS;
if (u.host === "hn.algolia.com")     return u.searchParams.get("tags")?.startsWith("comment") ? HN_COMMENTS : HN_STORIES;
if (u.host === "openapi.naver.com")  return naverBody(u.pathname);
throw new Error(`예상하지 못한 호스트: ${u.host}`);   // ★ 조용한 오분기 방지
```

이 step에서는 CLI가 YouTube만 등록하므로 HN·네이버 분기는 아직 안 타지만, **지금 만들어 두어라** —
step 9에서 켤 때 이 mock이 준비되어 있어야 한다.

## 테스트 (TDD — 먼저 작성한다)

### `src/research/collect.test.ts` (신설) — **★ 이 step의 핵심**

- **병렬 증명**: 수동 제어 promise를 반환하는 fake source 3개를 만들고, `collectAll(...)`을 **await하지 않은**
  상태에서 3개 `collect` 스파이가 **모두 호출됐음**을 단언한다. (순차 구현이면 1개만 호출된다.)
  이 테스트가 없으면 누군가 `for await` 루프로 되돌려도 아무도 모른다.
- 3소스 중 1개 reject → 나머지 2개의 voices + `failures.length === 1` (throw 안 함)
- **전부 reject → `voices: []`, `failures.length === 3`, throw 안 함**
- 빈 소스 배열 → `{voices: [], failures: []}`, 어떤 `collect`도 호출되지 않음
- 각 소스가 **자기 쿼리**(`queries[source.id]`)를 받는다

### `src/research/sources.test.ts` (신설)

- 각 어댑터가 서비스 결과를 `CommunityVoice`로 정확히 매핑한다 (위 표대로)
- **`CommunityVoiceSchema.parse()`를 통과한다** (스키마 계약 — `url`이 `z.url()`이다)
- YouTube: `{video, comments}[]`가 댓글 단위로 **평탄화**된다
- HN: 코멘트 voice의 `url`이 **코멘트 퍼머링크**다
- **네이버: 모든 voice에 `extra: "검색 스니펫"`이 붙는다**
- 서비스가 throw하면 어댑터도 throw한다 (흡수는 `collectAll`의 책임)

### `src/research/format.test.ts` (신설)

- 소스별 그룹 제목이 `SOURCE_LABELS`에서 온다 (하드코딩된 "YouTube" 문자열 단언 금지 — 상수를 참조하라)
- voice 원문이 **축자로** 포함된다 (잘리지 않음)
- **수집 0건인 소스가 "0건"으로 명시된다**
- **실패한 소스의 에러 메시지가 섹션에 포함된다**
- 전부 비면 `EVIDENCE_EMPTY_SECTION`

### `src/agents/contextHunter.test.ts` (갱신)

- `fakeDeps`가 `sources: ResearchSource[]`를 받는다
- **각 소스의 `collect`가 호출된다**
- 소스 1개 실패 / 전부 실패 / 소스 0개 → 전부 정상 반환 (throw 안 함)
- 프롬프트에 `{evidenceSection}` placeholder 잔여가 없다
- 프롬프트에 **네이버 스니펫 주의**와 **urlContext 3곳 상한**이 들어 있다
- step 1의 프롬프트-스키마 계약 테스트는 **그대로 통과해야 한다**

### `src/pipeline/orchestrator.test.ts` (갱신)

- `fakeYoutube()` → `fakeSources()`로 교체. `makeDeps`의 `youtube` → `sources`
- (step 5가 이미 `fakeGemini`에 `generateGrounded`를 추가했다. 그 위에서 작업하라.)

### `src/pipeline/e2e.test.ts` (갱신)

- host 분기 mock으로 재작성. **미지 host는 throw**한다
- step 5가 추가한 citations 단언은 그대로 통과해야 한다

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
grep -rq "formatYoutubeSection\|YOUTUBE_EMPTY_SECTION" src/ && echo "FAIL: 구 포맷터가 남아 있다" && exit 1
grep -q "allSettled" src/research/collect.ts
grep -rq "hackernews\|naver" src/cli/index.ts && echo "FAIL: 아직 HN/네이버를 켜면 안 된다 (step 9)" && exit 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **동작이 안 바뀌었는지 확인한다.** 이 step 후에도 CLI는 YouTube 하나만 수집한다.
   `src/cli/index.ts`에 `hackerNews`/`naver`가 등장하면 실패다.
3. e2e mock의 host 분기가 **미지 host에 throw**하는지 확인한다. 이게 없으면 step 9에서 조용한 오분기가 난다.
4. 아키텍처 체크리스트:
   - `src/research/`가 **직접 fetch/SDK를 호출하지 않는가?** (서비스를 주입받아 정규화만 — CLAUDE.md CRITICAL)
   - 병렬 수집이 `Promise.allSettled`인가? (`collect.test.ts`의 병렬 증명 테스트가 통과하는가)
   - fail-soft가 유지되는가? (소스 전부 실패해도 파이프라인이 완주하는가)
   - 테스트가 API 키 없이 통과하는가?
5. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `ResearchSource` 인터페이스, `collectAll`/`formatEvidenceSection` 시그니처,
     `PipelineDeps.sources` 변경, **e2e mock의 host 분기 구조**, 그리고 각 어댑터의 매핑 규칙을 포함하라.
     step 7·8·9가 전부 이걸 쓴다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **`collectAll`을 순차 `for await` 루프로 구현하지 마라.** 이유: 지연이 `sum(소스)`가 된다.
  `Promise.allSettled`로 `max(소스)`가 되어야 한다. 병렬 증명 테스트가 이를 강제한다.
- **`collectAll`이 throw하게 만들지 마라.** 이유: 소스 전부가 실패해도 파이프라인은 웹검색만으로 완주해야 한다.
  오늘의 YouTube 단독 fail-soft(`contextHunter.ts:96-104`)와 동일한 계약이다.
- **`src/research/`에서 `fetch`를 직접 호출하지 마라.** 이유: CLAUDE.md CRITICAL — 외부 API 호출은
  `src/services/`에서만. `research/`는 서비스를 **주입받아 정규화만** 한다.
- **프롬프트 placeholder를 소스별로 3개 만들지 마라** (`{youtubeSection}` `{hnSection}` `{naverSection}`).
  이유: grounding 모드는 `responseSchema`를 못 써서 프롬프트 JSON 예시가 유일한 형식 지시다.
  섹션이 늘수록 형식 실패율이 오른다. `{evidenceSection}` 하나로 통일하라.
- **플러그인 레지스트리·동적 소스 등록을 만들지 마라.** 이유: 소스는 정확히 3개이고 전부 컴파일 타임에
  알려져 있으며 생성 지점이 CLI 한 곳이다. `readonly ResearchSource[]` 배열이 곧 레지스트리다 (ADR-012).
- **`src/cli/index.ts`에 HN·네이버 소스를 등록하지 마라.** 이유: step 9의 범위다. 이 step은 **배관만** 깐다.
  배관 변경(파급 큼)과 기능 활성화(파급 작음)를 같은 커밋에 섞으면 회귀 원인을 못 찾는다.
- **소스별 검색어를 생성하지 마라.** 이유: step 7(`researchPlanner`)의 범위다. 이 step은 모든 소스에
  아이디어 원문을 넘긴다 (오늘과 동일).
- **e2e fetch mock을 `url.includes("/search")`로 두지 마라.** 이유: YouTube·HN·네이버 세 API가 전부 경로에
  `/search`를 포함한다. host로 분기하고 **미지 host는 throw**하라. 안 그러면 테스트가 조용히 잘못된 body를 먹는다.
- **네이버 voice에서 `extra: "검색 스니펫"`을 빼지 마라.** 이유: `description`은 말줄임이 들어간 200자 스니펫이다.
  표시가 없으면 LLM이 잘린 문장을 완결된 원문 인용으로 리포트에 싣는다.
- 테스트에서 실제 API를 호출하지 마라.
- 기존 테스트를 깨뜨리지 마라.
