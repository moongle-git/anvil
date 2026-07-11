# Step 4: naver-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — **CRITICAL: 외부 API 호출은 `src/services/`에서만. 테스트에서 실제 API를 호출하지 마라**
- `/docs/ADR.md` — ADR-012(다중 소스)
- `/docs/ARCHITECTURE.md` — 서비스 레이어 격리
- `/src/services/youtube.ts` — 서비스 구조의 원본. **단 `request()`가 헤더를 안 보낸다는 차이에 주의**
- `/src/services/youtube.test.ts` — duck-typed `fetchFn` mock 패턴
- `/src/services/hackerNews.ts` — step 3 산출물. 같은 구조를 따른다
- `/src/services/withTimeout.ts`
- `/src/lib/html.ts` — step 2의 `stripHtml()`. 네이버 `<b>` 하이라이트 정제에 필수

## 배경

네이버 검색 API를 자료조사 소스로 추가한다(ADR-012). 무료이고 **하루 25,000회**다.

이 프로젝트는 한국 시장이 타겟이다(`youtube.ts`의 `relevanceLanguage=ko`). 그런데 한국 유저의 실제
페인포인트는 **네이버 카페·지식iN**에 밀집해 있다. 지금은 이걸 전혀 보지 않는다.

이 step에서는 **서비스만 만든다. 파이프라인에 연결하지 않는다.**
`src/cli/index.ts`, `src/agents/`, `src/pipeline/`을 건드리지 마라 — 배선은 step 6·9의 몫이다.

## 작업

### `src/services/naver.ts` (신설)

#### API 계약 (네이버 검색 API)

- Base: `https://openapi.naver.com/v1/search`
- 엔드포인트: `GET /{corpus}.json` — `corpus`는 `blog` | `cafearticle` | `kin`
- 파라미터: `query`(필수), `display`(기본 10, 최대 100), `start`(기본 1), `sort=sim`(정확도순) | `date`
- **★ 인증은 URL 파라미터가 아니라 HTTP 헤더다:**
  ```
  X-Naver-Client-Id: {clientId}
  X-Naver-Client-Secret: {clientSecret}
  ```
  **이게 `YoutubeService`와의 결정적 차이다.** `youtube.ts:174-205`의 `request()`는
  `this.fetchFn(url, { signal })`만 호출하고 헤더를 전혀 보내지 않는다.
  `NaverService.request()`는 `this.fetchFn(url, { headers, signal })`여야 한다.
  **복붙하면 401로 조용히 실패한다.**

응답 봉투: `{ lastBuildDate, total, start, display, items: [...] }`

| corpus | item 필드 |
|---|---|
| `blog` | `title`, `link`, `description`, `bloggername`, `bloggerlink`, `postdate` |
| `cafearticle` | `title`, `link`, `description`, `cafename`, `cafeurl` |
| `kin` | `title`, `link`, `description` |

에러 응답 바디: `{ errorMessage, errorCode }`

#### 시그니처

```ts
export type NaverCorpus = "blog" | "cafearticle" | "kin";

export interface NaverPost {
  corpus: NaverCorpus;
  title: string;          // stripHtml 적용
  link: string;
  description: string;    // stripHtml 적용 — ★ 본문이 아니라 검색 스니펫이다
  authorName?: string;    // blog: bloggername / cafearticle: cafename / kin: 없음
  postedAt?: string;      // blog: postdate (YYYYMMDD)
}

export interface NaverServiceOptions {
  clientId: string;
  clientSecret: string;
  corpora?: readonly NaverCorpus[];   // 기본 ["cafearticle", "kin", "blog"]
  display?: number;                   // 기본 5 (corpus당)
  fetchFn?: typeof fetch;             // 테스트 seam
  timeoutMs?: number;                 // 기본 15_000
}

export class NaverApiError extends Error {
  constructor(message: string, readonly status: number, readonly errorCode?: string);
}

export class NaverService {
  constructor(options: NaverServiceOptions);
  async search(corpus: NaverCorpus, query: string): Promise<NaverPost[]>;
  async collect(query: string): Promise<NaverPost[]>;
  private request<T>(corpus: NaverCorpus, params: Record<string, string>): Promise<T>;
}
```

#### 반드시 지켜야 할 규칙

1. **★ 헤더 인증.** 위 참조. `X-Naver-Client-Id` / `X-Naver-Client-Secret`.
   API 키를 URL 쿼리 파라미터에 넣지 마라 — 네이버는 헤더만 받는다.

2. **corpus 기본 순서는 `["cafearticle", "kin", "blog"]`이고 신호 품질 순이다.**
   - **카페글** — 실제 커뮤니티의 불만·후기. 최고 신호.
   - **지식iN** — 질문 자체가 페인포인트다("~하는 방법 없나요?").
   - **블로그** — SEO 스팸 비율이 가장 높지만 진짜 후기도 섞여 있어 포함한다.

   `display=5` × corpus 3개 = **15건**. 이 상한을 지켜라 — 프롬프트 토큰 방어다.

3. **`collect()`는 corpus들을 `Promise.allSettled`로 병렬 호출한다.**
   - 일부 corpus가 실패하면 **성공한 것만 반환**한다.
   - **전부 실패하면 첫 에러를 throw**한다. (소스 단위 fail-soft는 step 6의 `collectAll`이 담당하므로,
     "네이버 전체가 죽었다"는 사실은 여기서 위로 알려야 한다.)

4. **`title`과 `description`에 `<b>` 하이라이트 태그와 HTML 엔티티가 섞여 온다.**
   반드시 `stripHtml()`(step 2)을 통과시켜라.

5. **★ `description`은 본문이 아니라 ~200자 검색 스니펫이다 (말줄임 포함).**
   이 사실을 숨기지 마라. `NaverPost`의 JSDoc에 명시하고, step 6의 어댑터가 `CommunityVoice.extra`에
   `"검색 스니펫"`을 넣을 수 있게 하라. 본문 전문 수집은 스크래핑이 필요하고 카페는 로그인 월이 있어
   **이번 phase의 범위 밖**이다(PRD Phase 3 제외 사항).

6. **에러 매핑 (한국어)** — `youtube.ts:75-83`의 `buildApiErrorMessage` 패턴:
   - `401` 또는 `errorCode === "024"` → `"네이버 API 인증에 실패했다 (NAVER_CLIENT_ID/NAVER_CLIENT_SECRET을 확인하라): {message}"`
   - `429` 또는 `errorCode === "012"` → `"네이버 API 일일 호출 한도(25,000)를 초과했다: {message}"`
   - 그 외 → `"네이버 검색 API 요청이 실패했다 (HTTP {status}{, errorCode}): {message}"`

   ⚠️ 네이버의 정확한 `errorCode` 값은 문서와 실제가 다를 수 있다. **`status` 기반 폴백 메시지를 반드시 두어라** —
   `errorCode`가 예상과 달라도 사용자가 원인을 알 수 있어야 한다.

7. **타임아웃 이중 방어**: `withTimeout(this.fetchFn(url, { headers, signal: AbortSignal.timeout(ms) }), ms, "네이버 API 요청")`.

8. **빈 필드 방어**: 옵셔널 체이닝 + `?? ""` 수동 매핑. 원시 응답에 zod를 걸지 마라.
   `link`가 없는 item은 조용히 건너뛴다 (`CommunityVoice.url`이 `z.url()`이다).

9. **재시도·백오프를 구현하지 마라.** 소스 단위 fail-soft는 step 6의 `collectAll`이 담당한다.

## 테스트 (TDD — 먼저 작성한다)

### `src/services/naver.test.ts` (신설)

`src/services/youtube.test.ts:18-28`의 duck-typed mock 패턴을 쓴다.
**실제 `fetch`를 호출하지 마라.**

- **★ 인증 헤더**: `fetchFn.mock.calls[0][1].headers`에 `X-Naver-Client-Id`와 `X-Naver-Client-Secret`이
  올바른 값으로 들어 있다. **이 테스트가 이 서비스의 1순위 계약이다** (YoutubeService를 복붙하면 여기서 깨진다).
- 요청 URL이 `openapi.naver.com/v1/search/cafearticle.json`이고 `query`·`display=5`·`sort=sim`을 포함한다
- `<b>회의록</b>` 하이라이트와 엔티티가 `title`·`description`에서 제거된다
- corpus 3개를 기본으로 호출한다 (`fetchFn` 3회, 각각 blog/cafearticle/kin)
- **`collect()`가 corpus들을 병렬 호출한다** (첫 응답 전에 3개 호출이 모두 발생)
- **corpus 1개가 실패해도 나머지 2개의 결과를 반환한다** (no-throw)
- **corpus 전부가 실패하면 throw한다** (`NaverApiError`)
- `401` → 인증 실패 한국어 메시지 (`NAVER_CLIENT_ID` 언급)
- `429` → 일일 한도 초과 한국어 메시지
- 예상 못 한 `errorCode`여도 `status` 기반 폴백 메시지가 나온다
- `link` 없는 item은 조용히 건너뛴다
- `items` 없는 응답(`{}`)에도 빈 배열, no-throw
- `timeoutMs: 10` + 미정착 `fetchFn` → 시간 초과 에러
- `display` 상한이 지켜진다

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
git diff --name-only   # src/services/naver.ts, src/services/naver.test.ts 2개만
grep -rq "NaverService\|naver" src/cli src/agents src/pipeline && echo "FAIL: 아직 배선하면 안 된다" && exit 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --name-only`가 정확히 2개 파일인지 확인한다.
3. **헤더 인증이 실제로 나가는지** 테스트로 증명됐는지 확인한다 (`fetchFn.mock.calls[0][1].headers`).
   이게 없으면 실제 실행 시 401로 조용히 죽는다.
4. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/`에만 있는가?
   - `fetchFn` 주입으로 테스트가 실제 네트워크를 타지 않는가?
   - `withTimeout` + `AbortSignal.timeout` 이중 방어가 있는가?
   - 새 런타임 의존성이 0개인가?
5. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `NaverService`의 public 메서드 시그니처, `NaverPost` 필드, 기본 corpus 3종과 display 5,
     그리고 **`description`이 검색 스니펫이라는 사실**을 포함하라. step 6의 어댑터와 step 7의 프롬프트가
     이걸 알아야 한다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 (API 키 발급 등) → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단
     ⚠️ **단, 이 step은 키 없이 완료 가능하다.** 테스트가 전부 mock이므로 실제 네이버 키가 필요 없다.
     키를 요구하며 blocked로 빠지지 마라.

## 금지사항

- **API 키를 URL 쿼리 파라미터로 보내지 마라.** 이유: 네이버는 `X-Naver-Client-Id`/`X-Naver-Client-Secret`
  **헤더**만 받는다. `YoutubeService.request()`를 복붙하면 헤더가 없어서 401로 조용히 실패한다.
  이게 이 step의 가장 흔한 실패 모드다.
- **`description`을 게시글 본문인 것처럼 다루지 마라.** 이유: ~200자 검색 스니펫이고 말줄임이 들어 있다.
  잘린 문장을 완결된 원문 인용으로 내보내면 리포트가 거짓말을 한다. JSDoc에 명시하고,
  step 6이 `extra: "검색 스니펫"`으로 표시할 수 있게 하라.
- **카페·블로그 본문을 스크래핑하지 마라.** 이유: 파서 라이브러리가 없고(ADR 철학), 네이버 카페는
  로그인 월이 있으며, PRD Phase 3 제외 사항에 명시되어 있다. 검색 스니펫까지가 이번 범위다.
- **`collect()`에서 corpus 실패를 전부 삼키지 마라.** 이유: 일부 실패는 흡수하되, **전부 실패하면 throw**해야
  step 6의 `collectAll`이 "네이버 소스가 죽었다"를 `failures[]`에 기록하고 LLM 프롬프트에 그 사실을 적을 수 있다.
  조용히 빈 배열을 반환하면 "검색 결과가 없다"와 "API가 죽었다"가 구별되지 않는다.
- **`errorCode`만 믿고 분기하지 마라.** 이유: 네이버 문서와 실제 응답 코드가 다를 수 있다.
  `status` 기반 폴백 메시지를 반드시 두어라.
- **`title`/`description`을 `stripHtml()` 없이 쓰지 마라.** 이유: `<b>` 하이라이트 태그가 리포트에 그대로 노출된다.
- **`src/cli/index.ts`·`src/agents/`·`src/pipeline/`을 건드리지 마라.** 이유: 배선은 step 6·9의 범위다.
- **원시 API 응답에 zod 스키마를 걸지 마라.** 이유: `services/`의 기존 관례는 수동 매핑이다.
- 테스트에서 실제 HTTP 요청을 하지 마라. 실제 네이버 API 키를 요구하지 마라 (전부 mock으로 가능하다).
- 기존 테스트를 깨뜨리지 마라.
