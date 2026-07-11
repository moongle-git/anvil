# Step 3: hackernews-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — **CRITICAL: 외부 API 호출은 `src/services/`에서만. 테스트에서 실제 API를 호출하지 마라**
- `/docs/ADR.md` — ADR-012(다중 소스), 철학(외부 의존성 최소화)
- `/docs/ARCHITECTURE.md` — 서비스 레이어 격리
- `/src/services/youtube.ts` — **이 파일의 구조를 그대로 따른다.** 옵션 인터페이스, 도메인 에러 클래스,
  `private request<T>()`, `withTimeout` + `AbortSignal` 이중 방어, 한국어 에러 메시지 매핑
- `/src/services/youtube.test.ts` — **duck-typed `fetchFn` mock 패턴.** 이 테스트 구조를 그대로 따른다
- `/src/services/withTimeout.ts` — `withTimeout(promise, ms, label)`
- `/src/lib/html.ts` — step 2에서 만든 `stripHtml()`. HN 댓글 정제에 필수

## 배경

Hacker News를 자료조사 소스로 추가한다(ADR-012). **API 키가 필요 없고 무료다.**

이 step에서는 **서비스만 만든다. 파이프라인에 연결하지 않는다.**
`src/cli/index.ts`, `src/agents/`, `src/pipeline/`을 건드리지 마라 — 배선은 step 6·9의 몫이다.

### 왜 Hacker News인가

영어권 빌더·얼리어답터의 실제 토론이 밀집해 있다. "Show HN" 스토리는 경쟁 제품 발굴에 강하고,
댓글은 "이거 왜 안 쓰는지" "이미 X로 해결됨" 같은 냉정한 피드백의 보고다.

**★ HN은 영어권이다.** 한국어 쿼리로 검색하면 **에러 없이 조용히 0건**이 나온다.
소스별 영어 검색어 생성은 step 7(`researchPlanner`)이 담당한다. 이 step은 **주어진 쿼리를 그대로 쓴다.**

## 작업

### `src/services/hackerNews.ts` (신설)

#### API 계약 (Algolia HN Search)

- Base: `https://hn.algolia.com/api/v1`
- 엔드포인트: `GET /search` — **관련도 순**. (`/search_by_date`는 최신순이라 쓰지 않는다.)
- **인증 없음.** 레이트리밋은 IP당 시간당 10,000회 — run당 2회 호출이라 사실상 무제한이다.

**스토리 검색**: `?query={q}&tags=story&hitsPerPage={maxStories}&numericFilters=points>={minPoints}`
응답 hit 필드: `objectID`, `title`, `url`, `author`, `points`, `num_comments`

**코멘트 검색**: `?query={q}&tags=comment&hitsPerPage={maxComments}`
응답 hit 필드: `objectID`, `comment_text`, `author`, `story_id`, `story_title`, `story_url`

응답 봉투: `{ hits: [...], nbHits, page }`

#### 시그니처

```ts
export interface HackerNewsStory {
  objectId: string;
  title: string;
  url: string;          // 항상 유효 — 아래 폴백 규칙 참조
  author: string;
  points: number;
  numComments: number;
}

export interface HackerNewsComment {
  objectId: string;
  text: string;         // stripHtml 적용된 평문
  author: string;
  storyTitle: string;
  url: string;          // 항상 코멘트 퍼머링크
}

export interface HackerNewsServiceOptions {
  maxStories?: number;        // 기본 5
  maxComments?: number;       // 기본 12
  minPoints?: number;         // 기본 10 — 저품질 스토리 컷
  fetchFn?: typeof fetch;     // 테스트 seam (YoutubeService와 동일)
  timeoutMs?: number;         // 기본 15_000
}

export class HackerNewsApiError extends Error {
  constructor(message: string, readonly status: number);
}

export class HackerNewsService {
  constructor(options?: HackerNewsServiceOptions);
  async searchStories(query: string): Promise<HackerNewsStory[]>;
  async searchComments(query: string): Promise<HackerNewsComment[]>;
  async collect(query: string): Promise<{ stories: HackerNewsStory[]; comments: HackerNewsComment[] }>;
  private request<T>(params: Record<string, string>): Promise<T>;
}
```

`apiKey`가 없다는 점에 주목하라 — `HackerNewsServiceOptions`는 전부 optional이므로 `new HackerNewsService({})`
또는 `new HackerNewsService()`로 생성된다.

#### 반드시 지켜야 할 규칙

1. **★ `collect()`는 두 요청을 `Promise.all`로 병렬 실행한다 — 정확히 2 round-trip.**
   `tags=comment,story_{id}`로 스토리마다 댓글 트리를 도는 N+1 설계를 **채택하지 마라.**
   이유: `tags=comment` 검색 결과의 각 hit이 이미 `story_id`/`story_title`/`story_url`을 실어 온다.
   쿼리에 직접 매칭되는 코멘트를 뽑는 게 스토리를 경유하는 것보다 관련도도 높고 호출도 1/5이다.

2. **`story.url`은 Ask HN / Show HN에서 `null`이다.**
   `null`·빈 문자열이면 `https://news.ycombinator.com/item?id={objectID}`로 폴백하라.
   `HackerNewsStory.url`은 **항상 유효한 문자열**이어야 한다 (`CommunityVoice.url`이 `z.url()`이다).

3. **★ `HackerNewsComment.url`은 항상 코멘트 퍼머링크다**: `https://news.ycombinator.com/item?id={objectID}`.
   `story_url`을 쓰지 마라 — `null`일 수 있고, 인용의 출처는 그 댓글이지 원문 기사가 아니다.

4. **`comment_text`는 HTML이다.** 반드시 `stripHtml()`(step 2, `src/lib/html.ts`)을 통과시켜라.

5. **★ 1200자를 초과하는 코멘트는 자르지 말고 드롭하라.**
   이유: HN에는 에세이급 장문 댓글이 흔하다. 잘라서 넘기면 LLM이 `…`로 끝나는 조각을 "원문 그대로 인용"으로
   리포트에 싣게 되어 인용 계약이 깨진다. 잘린 문장을 완결된 인용인 양 내보내느니 그 댓글은 버린다.
   `stripHtml()` **적용 후** 길이로 판단하라.

6. **빈 필드 방어**: `YoutubeService`처럼 옵셔널 체이닝 + 기본값(`?? ""`)으로 수동 매핑한다.
   원시 API 응답에 zod 검증을 걸지 마라 — `services/`의 기존 관례가 아니다.
   `objectID`나 `comment_text`가 없는 hit은 **조용히 건너뛴다.**

7. **타임아웃 이중 방어**: `YoutubeService.request`(`youtube.ts:174-205`)와 동일하게
   `withTimeout(this.fetchFn(url, { signal: AbortSignal.timeout(this.timeoutMs) }), this.timeoutMs, "Hacker News API 요청")`.

8. **에러 메시지는 한국어**로 매핑한다(`youtube.ts:75-83`의 `buildApiErrorMessage` 패턴):
   - `429` → `"Hacker News API 요청 한도를 초과했다 (HTTP 429): {message}"`
   - 그 외 → `"Hacker News API 요청이 실패했다 (HTTP {status}): {message}"`

9. **재시도·백오프를 구현하지 마라.** `YoutubeService`도 하지 않는다. 실패는 그대로 throw하고,
   소스 단위 fail-soft는 step 6의 `collectAll`이 `Promise.allSettled`로 흡수한다.

## 테스트 (TDD — 먼저 작성한다)

### `src/services/hackerNews.test.ts` (신설)

`src/services/youtube.test.ts:18-28`의 duck-typed mock 패턴을 그대로 쓴다:
```ts
fetchFn.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(body) });
```
**실제 `fetch`를 호출하지 마라** (CLAUDE.md CRITICAL — API 키 없이 `npm test` 통과).

- 스토리 요청 URL에 `tags=story`, `hitsPerPage`, `numericFilters`(points 하한)가 포함된다
- 코멘트 요청 URL에 `tags=comment`가 포함된다
- **★ `collect()`가 `fetchFn`을 정확히 2회 호출한다** — N+1 회귀 가드
- **★ `collect()`의 두 요청이 병렬이다**: 첫 호출을 resolve하기 전에 두 번째 호출이 이미 발생했음을 단언
  (수동 제어 promise를 반환하는 `fetchFn`으로 검증)
- Ask HN(`url: null`) 스토리 → `news.ycombinator.com/item?id={objectID}` 폴백
- 코멘트의 `url`이 **코멘트 퍼머링크**다 (`story_url`이 아니다). `story_url: null`인 hit으로 검증하라
- `comment_text`의 HTML 태그·엔티티가 제거된다 (`<p>`가 개행이 된다)
- **1200자 초과 코멘트는 결과에서 드롭된다** (잘리지 않는다 — 남은 것이 `…`로 끝나지 않는지 확인)
- `objectID` 없는 hit, `comment_text` 없는 hit은 조용히 건너뛴다
- `hits`가 없는 응답(`{}`)에도 빈 배열을 반환하고 throw하지 않는다
- 429 → `HackerNewsApiError`, `status === 429`, 메시지에 "한도"
- 500 → `HackerNewsApiError`, 한국어 메시지
- `timeoutMs: 10` + 영원히 정착하지 않는 `fetchFn` → 시간 초과 에러 (hang 방지)
- `maxStories`/`maxComments` 상한이 지켜진다 (API가 더 많이 줘도 잘라낸다)

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
git diff --name-only   # src/services/hackerNews.ts, src/services/hackerNews.test.ts 2개만
grep -rq "hackerNews\|HackerNews" src/cli src/agents src/pipeline && echo "FAIL: 아직 배선하면 안 된다" && exit 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --name-only`가 정확히 2개 파일인지 확인한다. `src/cli/`·`src/agents/`·`src/pipeline/`이 나오면 실패다.
3. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/`에만 있는가? (CLAUDE.md CRITICAL)
   - `fetchFn` 주입으로 테스트가 실제 네트워크를 타지 않는가?
   - `withTimeout` + `AbortSignal.timeout` 이중 방어가 있는가? (hang 방지는 이 레포의 강제 관행)
   - 새 런타임 의존성이 0개인가? (내장 `fetch`만 사용)
   - 테스트가 API 키 없이 통과하는가?
4. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `HackerNewsService`의 **public 메서드 시그니처**와 `HackerNewsStory`/`HackerNewsComment` 필드,
     기본 상한(5 스토리 / 12 코멘트 / minPoints 10)을 포함하라. step 6의 어댑터가 이 타입을 매핑한다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **`tags=comment,story_{id}`로 스토리별 댓글 트리를 순회하지 마라 (N+1).** 이유: `tags=comment` hit이
  이미 `story_id`/`story_title`/`story_url`을 실어 온다. 스토리 5개를 경유하면 호출이 6회가 되는데,
  쿼리 직접 매칭보다 관련도도 낮다. `collect()`는 정확히 2 round-trip이다.
- **1200자 초과 코멘트를 잘라서(truncate) 넣지 마라. 드롭하라.** 이유: 잘린 조각을 LLM이 "원문 그대로 인용"으로
  리포트에 실으면 인용 계약이 깨진다. HN에는 에세이급 댓글이 흔하다.
- **`HackerNewsComment.url`에 `story_url`을 쓰지 마라.** 이유: `null`일 수 있고(`z.url()` 검증 실패),
  인용의 출처는 그 댓글이지 원문 기사가 아니다. 항상 코멘트 퍼머링크를 쓴다.
- **`comment_text`를 `stripHtml()` 없이 그대로 쓰지 마라.** 이유: HN의 `comment_text`는 HTML이다.
  `&#x27;`와 `<p>`가 리포트 인용문에 그대로 노출된다.
- **`src/cli/index.ts`·`src/agents/`·`src/pipeline/`을 건드리지 마라.** 이유: 배선은 step 6(추상화)과
  step 9(CLI 활성화)의 범위다. 이 step은 부품만 만든다.
- **재시도·백오프·캐싱을 구현하지 마라.** 이유: `YoutubeService`도 하지 않는다. 소스 단위 fail-soft는
  step 6의 `collectAll`이 `Promise.allSettled`로 흡수한다. 여기서 하면 두 겹이 된다.
- **원시 API 응답에 zod 스키마를 걸지 마라.** 이유: `services/`의 기존 관례는 옵셔널 체이닝 + 기본값 수동 매핑이다
  (`youtube.ts:110-124`). zod 검증은 **에이전트 산출물**에만 적용된다(CLAUDE.md).
- 테스트에서 실제 HTTP 요청을 하지 마라. 이유: CLAUDE.md CRITICAL — API 키 없이 `npm test`가 통과해야 한다.
- 기존 테스트를 깨뜨리지 마라.
