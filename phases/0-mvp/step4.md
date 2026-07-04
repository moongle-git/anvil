# Step 4: youtube-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (ADR-003)
- `/CLAUDE.md`
- `src/types/marketContext.ts` (step 1 산출물 — YoutubeVoice 구조 참고)
- `src/services/gemini.ts` (step 3 산출물 — 서비스 레이어 스타일 참고)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/services/youtube.ts`에 YouTube Data API v3 래퍼를 TDD로 작성한다. 별도 SDK 없이 전역 `fetch`로 REST 호출한다.

```ts
export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  url: string;          // https://www.youtube.com/watch?v={videoId}
  description: string;
}

export interface YoutubeComment {
  videoId: string;
  text: string;         // 댓글 원문 (textOriginal)
  authorName: string;
  likeCount: number;
}

export interface YoutubeServiceOptions {
  apiKey: string;
  maxVideos?: number;    // 기본 5 — quota 절약
  maxCommentsPerVideo?: number; // 기본 10
  fetchFn?: typeof fetch;  // 테스트 주입용. 기본값 globalThis.fetch
}

export class YoutubeService {
  constructor(options: YoutubeServiceOptions)
  searchVideos(query: string): Promise<YoutubeVideo[]>      // GET /youtube/v3/search (part=snippet, type=video, relevanceLanguage=ko 우선)
  fetchComments(videoId: string): Promise<YoutubeComment[]> // GET /youtube/v3/commentThreads (part=snippet, order=relevance)
  collectVoices(query: string): Promise<{ video: YoutubeVideo; comments: YoutubeComment[] }[]>
  // searchVideos 후 각 영상의 댓글 수집. 댓글이 비활성화된 영상(403/commentsDisabled)은 건너뛰고 나머지를 반환
}
```

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. **quota 절약**: maxVideos/maxCommentsPerVideo 제한을 반드시 적용하라. 페이지네이션은 구현하지 마라 — 첫 페이지 상위 결과면 충분하다.
2. **부분 실패 허용**: `collectVoices`에서 일부 영상의 댓글 수집이 실패해도 전체가 죽지 않는다. 댓글 비활성화(HTTP 403)는 정상 케이스로 처리하고, 그 외 에러(401 키 오류, 403 quotaExceeded)는 명확한 메시지로 예외를 던져라.
3. **테스트는 fetch mock**: `fetchFn` 주입으로 실제 네트워크 호출 없이 테스트하라. 시나리오: 정상 검색+댓글, 댓글 비활성화 영상 skip, quota 초과 에러 메시지, 잘못된 키.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (실제 API 호출 없이)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (외부 API 호출은 src/services/에만)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(테스트에서 실제 API 호출 금지)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- googleapis 등 무거운 SDK를 설치하지 마라. 이유: REST 엔드포인트 2개에 전역 fetch면 충분하다. 의존성 최소화(ADR 철학).
- 자막(Transcript) 수집을 구현하지 마라. 이유: PRD의 MVP 제외 사항이다.
- 테스트에서 실제 YOUTUBE_API_KEY로 API를 호출하지 마라. 이유: CLAUDE.md CRITICAL 규칙.
- 기존 테스트를 깨뜨리지 마라
