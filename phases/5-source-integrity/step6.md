# Step 6: youtube-comment-permalink

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-003**(YouTube Data API 직접 연동), **ADR-012**, **ADR-013**(step 0에서 추가됨)
- `/docs/ARCHITECTURE.md`
- `/CLAUDE.md` — CRITICAL 규칙 (외부 API는 `src/services/`에서만, 테스트는 mock)
- `src/services/youtube.ts` — `fetchComments`, `collectVoices`, URL 생성부. 주 수정 대상
- `src/services/hackerNews.ts` — **참고 기준**. 댓글 인용의 출처는 그 댓글이지 원문 기사가 아니라는 원칙이 주석에 명시돼 있다
- `src/research/sources.ts` — `youtubeSource` 어댑터. 주 수정 대상
- `src/services/youtube.test.ts`, `src/research/sources.test.ts`

## 배경 — 인용을 독자가 검증할 수 없다

YouTube 수집 계층 자체는 **정상이다.** 영상 ID 10개를 라이브로 검증한 결과 10/10 실존했고(oEmbed 200), 댓글 텍스트·작성자·좋아요 수 모두 실제 API 데이터다.

문제는 **인용의 granularity**다. `src/research/sources.ts`의 YouTube 어댑터는 **댓글 하나하나를 voice로 만들면서 URL은 영상 페이지를 쓴다**:

```ts
comments.map((comment) => ({
  source: "youtube" as const,
  title: video.title,
  url: video.url,          // ← 영상 URL. 댓글이 아니다
  text: comment.text,
```

그래서 리포트가 특정 댓글을 인용해놓고 링크는 영상으로 보낸다. 독자는 그 영상의 수백 개 댓글 중 어느 것이 인용된 것인지 **찾을 방법이 없다.** 실제 산출물에서 다섯 개의 서로 다른 댓글이 전부 `watch?v=USGvvBKZme4` 하나를 가리키고 있다.

Hacker News는 정반대로 **댓글 permalink**를 쓴다 (`hackerNews.ts`의 주석: "인용의 출처는 그 댓글이지 원문 기사(story_url)가 아니다"). 소스 간 인용 계약이 어긋나 있다.

그리고 **API는 이미 답을 주고 있다.** `commentThreads` 응답의 `snippet.topLevelComment.id`가 댓글 ID인데, `fetchComments`가 `textOriginal`·`authorDisplayName`·`likeCount`만 파싱하고 **ID를 버린다.**

## 작업

### 1. `src/services/youtube.ts` — 댓글 ID를 파싱한다

- `commentThreads` 응답에서 `snippet.topLevelComment.id`를 읽어 댓글 원시 타입에 `id` 필드를 추가한다.
- ID가 없는 항목은 **건너뛴다** (방어적으로). 네이버 어댑터가 `link`가 없는 item을 건너뛰는 것과 같은 패턴이다 — `CommunityVoice.url`이 `z.url()`이라 깨진 값이 새어나가면 스키마 검증이 터진다.
- 기존 동작을 유지하라: `commentsDisabled`는 흡수하고(0건 처리), 그 외의 에러는 rethrow한다. quota 에러가 "댓글 0건"으로 위장되면 안 된다.
- `part` 파라미터가 `snippet`인 것으로 충분한지 확인하라 (topLevelComment는 `snippet` part에 포함된다). 불필요하게 part를 늘려 quota를 더 쓰지 마라.

### 2. `src/research/sources.ts` — 댓글 permalink를 생성한다

댓글 voice의 URL을 **댓글 permalink**로 바꾼다:

```
https://www.youtube.com/watch?v={videoId}&lc={commentId}
```

- **URL 조립은 `src/services/youtube.ts`에서 하라.** 이유: `research/`는 services/를 정규화만 하는 얇은 어댑터이고(CLAUDE.md), 이미 `youtube.ts`가 영상 URL을 만들고 있다. URL 형식 지식이 두 곳에 흩어지면 안 된다. `youtube.ts`가 댓글 permalink를 만들어 넘기고, `sources.ts`는 그것을 `CommunityVoice.url`에 매핑하기만 한다.
- `&lc=`의 `&`가 이스케이프되지 않게 주의하라. `URL`/`URLSearchParams`로 만들 경우 `lc` 값이 인코딩되면서 permalink가 깨질 수 있다 — 댓글 ID는 `UgxAbc...` 형태의 안전한 문자열이지만, 결과 문자열이 실제로 `watch?v=X&lc=Y` 형태인지 테스트로 못박아라.
- `title`은 여전히 **영상 제목**이다 (댓글에는 제목이 없다). 그대로 둔다.

### 3. 테스트

**CRITICAL**: YouTube API를 실제로 호출하지 마라. mock으로 대체한다. API 키 없이 `npm test`가 통과해야 한다.

- `src/services/youtube.test.ts`:
  - `topLevelComment.id`가 파싱되는가
  - ID가 없는 댓글 항목은 건너뛰는가
  - 생성된 permalink가 정확히 `https://www.youtube.com/watch?v={videoId}&lc={commentId}` 형태인가 (문자열 동등 비교로 못박아라 — `&`가 `&amp;`로 이스케이프되거나 `lc`가 URL 인코딩되면 실패해야 한다)
  - `commentsDisabled` 흡수 / 그 외 에러 rethrow (회귀 방지)
- `src/research/sources.test.ts`:
  - YouTube 댓글 voice의 `url`이 **영상 URL이 아니라 댓글 permalink**인가
  - 같은 영상의 서로 다른 두 댓글이 **서로 다른 url**을 갖는가 (지금은 둘 다 영상 URL이라 동일하다 — 이게 버그다)
  - `CommunityVoiceSchema` 검증을 통과하는가

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과
npm run lint    # ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **실물 확인** (선택이지만 권장): 테스트 fixture의 videoId·commentId로 만들어진 permalink 형식이 실제 YouTube에서 동작하는 형식인지 확인하라. `https://www.youtube.com/watch?v=VIDEO&lc=COMMENT_ID`는 해당 댓글로 스크롤·하이라이트되는 표준 형식이다.
3. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/` 안에만 있는가? (`research/`가 직접 fetch하지 않는가)
   - URL 조립 지식이 `youtube.ts` 한 곳에만 있는가?
   - 테스트가 실제 YouTube API를 호출하지 않는가?
4. 결과에 따라 `phases/5-source-integrity/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`research/sources.ts`에서 URL 문자열을 조립하지 마라.** 이유: `research/`는 services/를 `CommunityVoice`로 정규화만 하는 레이어다(CLAUDE.md CRITICAL). URL 형식은 services/의 지식이다.
- **댓글 ID가 없을 때 영상 URL로 fallback하지 마라.** 이유: 그러면 "검증 가능한 인용"이라는 계약이 조용히 깨진 채 통과한다. ID가 없는 항목은 건너뛰는 편이 정직하다 — 없는 근거보다 잘못된 근거가 나쁘다.
- **quota를 늘리는 방향으로 API part를 추가하지 마라.** 이유: `topLevelComment.id`는 이미 `snippet` part에 포함돼 있다. ADR-003의 트레이드오프가 quota 관리를 명시한다.
- 기존 테스트를 깨뜨리지 마라.
