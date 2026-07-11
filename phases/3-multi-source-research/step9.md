# Step 9: source-wiring

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — **환경변수** 절 (step 0에서 `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`이 추가됐다)
- `/docs/ADR.md` — **ADR-012** (fail-soft: 키가 없으면 소스 배열에서 제외)
- `/docs/ARCHITECTURE.md` — 다중 소스 병렬 수집 + fail-soft 패턴
- `/docs/PRD.md` — Phase 3 제외 사항
- `/src/cli/index.ts` — **`buildYoutubeService()`(`:29-40`)의 "항상 reject하는 가짜 fetchFn" 트릭.
  이 step이 삭제한다.** 키 검증(`:53-67`), deps 조립(`:69-73`)
- `/src/research/sources.ts` — step 6. `youtubeSource` / `hackerNewsSource` / `naverSource`
- `/src/research/collect.ts` — step 6. `collectAll`의 fail-soft 계약
- `/src/services/hackerNews.ts` — step 3. **키가 필요 없다**
- `/src/services/naver.ts` — step 4. `clientId` + `clientSecret`
- `/src/services/youtube.ts` — `collectVoices()`의 순차 for 루프(`:157-170`)
- `/src/pipeline/e2e.test.ts` — step 6이 만든 **host 우선 분기 mock**. 여기서 HN·네이버 분기가 처음 실제로 탄다
- `/.env.example`

## 배경

**여기서 처음으로 3소스가 켜진다.** 지금까지 8개 step이 배관·스키마·렌더링을 다 깔았지만,
`src/cli/index.ts`는 여전히 YouTube 소스 하나만 등록하고 있다.

### 삭제할 트릭

`src/cli/index.ts:29-40`의 `buildYoutubeService()`는 `YOUTUBE_API_KEY`가 없을 때
**항상 reject하는 가짜 `fetchFn`을 주입**해서, 키 부재를 네트워크 콜 없이 `contextHunter`의 catch 경로로
흘려보낸다. 소스가 1개일 땐 영리했다.

소스가 3개가 되면 이 트릭도 3개가 된다. 그리고 **"동작할 수 없는 서비스 객체"를 만드는 건 거짓말**이다.
`collectAll`은 그걸 "네이버 수집 실패"로 기록하고 LLM 프롬프트에 "네이버 수집이 실패했다"고 적을 텐데,
사실은 **실패한 게 아니라 애초에 키가 없었던** 것이다. 두 상황은 다르다.

**대체**: 키가 없으면 **소스 배열에 안 넣는다.** 실패조차 아니다. `collectAll([])`은 합법이고
HTTP 호출을 0회 한다.

## 작업

### 1. `src/cli/index.ts` — `buildResearchSources()`

`buildYoutubeService()`(`:29-40`)를 **삭제**하고 아래로 대체한다:

```ts
function buildResearchSources(env: NodeJS.ProcessEnv): ResearchSource[] {
  const sources: ResearchSource[] = [];

  if (env.YOUTUBE_API_KEY) {
    sources.push(youtubeSource(new YoutubeService({ apiKey: env.YOUTUBE_API_KEY })));
  } else {
    console.warn("YOUTUBE_API_KEY 미설정 — YouTube 수집을 건너뛴다.");
  }

  // Hacker News는 API 키가 필요 없다 — 항상 켠다
  sources.push(hackerNewsSource(new HackerNewsService({})));

  if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) {
    sources.push(naverSource(new NaverService({
      clientId: env.NAVER_CLIENT_ID,
      clientSecret: env.NAVER_CLIENT_SECRET,
    })));
  } else {
    console.warn("NAVER_CLIENT_ID/NAVER_CLIENT_SECRET 미설정 — 네이버 수집을 건너뛴다.");
  }

  return sources;
}
```

**규칙:**

- **`GEMINI_API_KEY`만 하드 실패다** (`:53-60`의 exit 1). 그대로 유지하라.
- **`YOUTUBE_API_KEY` / 네이버 키는 없어도 계속 진행**한다. `console.warn`만 남긴다.
- **네이버는 ID와 SECRET이 둘 다 있어야 한다.** 반쪽 설정(`ID`만 있고 `SECRET`이 없음)은 **부재로 취급**하고
  warn한다. 반쪽으로 서비스를 만들면 401로 죽는다.
- **소스 0개도 합법이다** (모든 키가 없는 경우 — HN은 키가 없으므로 실제로는 최소 1개지만,
  `collectAll([])`이 동작해야 한다는 계약은 유지된다).

기존 키 경고 블록(`:62-67`)은 `buildResearchSources` 안으로 흡수하거나, 중복되지 않게 정리하라.

### 2. `.env.example`

```
GEMINI_API_KEY=
YOUTUBE_API_KEY=
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
```

`GEMINI_API_KEY`만 필수이고 나머지는 없으면 해당 소스를 건너뛴다는 것을 **주석 한 줄**로 적어라.
네이버 키 발급처(네이버 개발자센터 — 검색 API 애플리케이션 등록)도 주석으로 남겨라.

### 3. `src/services/youtube.ts` — 댓글 수집 병렬화

`collectVoices()`(`:157-170`)의 순차 `for` 루프를 `Promise.allSettled`로 바꾼다.
영상 5개 × 댓글 요청 1회 = 5 round-trip이 순차로 돌고 있다.

**★ 의미를 정확히 보존하라:**

- `commentsDisabled`인 영상은 **그 영상만 건너뛴다** (정상 케이스, `:160-169`).
- **그 외 에러(특히 `quotaExceeded`)는 rethrow**해야 `collectAll`이 YouTube 소스 실패로 기록한다.
  → settled 결과 중 rejected를 훑어 **`commentsDisabled`가 아닌 첫 에러를 rethrow**하라.
- 영상 순서를 보존하라 (`Promise.allSettled`는 입력 순서로 결과를 준다).

이걸 마지막에 두는 이유: 동작 변경이 아니라 **성능 최적화**라서, 3소스가 켜진 뒤 회귀가 나면
원인을 이 커밋으로 좁힐 수 있다.

## 테스트 (TDD — 먼저 작성한다)

### `src/cli/index.test.ts` (신설 또는 갱신)

`src/cli/index.ts`가 테스트 가능한 구조가 아니라면 **`buildResearchSources`를 export**해서 단위 테스트하라.
(CLI 전체를 실행하지 마라 — `process.exit`이 있다.)

- 모든 키가 있으면 소스 **3개** (`youtube`, `hackernews`, `naver` — id로 단언)
- `YOUTUBE_API_KEY`가 없으면 소스 **2개**이고 `youtube`가 **없다**. warn이 호출된다
- 네이버 키가 없으면 소스 2개이고 `naver`가 없다
- **★ `NAVER_CLIENT_ID`만 있고 `SECRET`이 없으면** 네이버 소스가 **없다** (반쪽 설정 = 부재)
- **★ 키가 없을 때 "항상 reject하는 fetchFn"을 가진 서비스를 만들지 않는다** —
  소스 배열에 아예 없어야 한다 (id 목록으로 단언)
- **HN은 키 없이 항상 포함된다**

### `src/services/youtube.test.ts` (갱신)

- **★ `collectVoices`가 댓글 요청을 병렬로 보낸다**: 첫 댓글 응답을 resolve하기 전에 나머지 요청이
  이미 발생했음을 단언 (수동 제어 promise `fetchFn`)
- **`commentsDisabled`인 영상 1개가 섞여도** 나머지 영상의 댓글이 정상 수집된다 (그 영상만 skip)
- **`quotaExceeded` 에러는 rethrow된다** (조용히 삼키지 않는다) — 이게 병렬화의 가장 위험한 회귀다
- 영상 순서가 보존된다

### `src/pipeline/e2e.test.ts` (갱신) — **★ 3소스 관통**

step 6이 만든 host 분기 mock이 **여기서 처음 실제로 HN·네이버 분기를 탄다.**

- 3소스가 전부 켜진 상태로 파이프라인을 완주시킨다
- 디스크의 `runs/{id}/context.json`에 `communityVoices`가 있고, LLM 응답(fake)이 준
  `source: "hackernews"` / `"naver"` 항목이 살아남는다
- **★ HN과 네이버가 429로 실패해도 파이프라인이 완주한다** (부분 실패 내성).
  `context.json`이 정상 생성되고 `report.md`가 나온다
- **★ 모든 소스가 실패해도 완주한다** (grounding만으로 진행)
- step 5의 citations 단언, step 1의 하위호환 단언은 그대로 통과한다

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
grep -q "buildResearchSources" src/cli/index.ts
grep -q "NAVER_CLIENT_ID" .env.example
grep -q "allSettled" src/services/youtube.ts
grep -rq "buildYoutubeService" src/ && echo "FAIL: 가짜 fetchFn 트릭이 남아 있다" && exit 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **실제 실행 검증 (이 phase의 통합 검증이다).**
   `.env`에 `GEMINI_API_KEY`가 있는 상태에서:

   ```bash
   npm run consult -- "직장인을 위한 AI 회의록 요약 서비스"
   ```

   `runs/{run-id}/context.json`을 열어 확인하라:
   - `communityVoices`에 `source: "hackernews"` 항목이 **실제로** 있는가?
     (HN은 키가 필요 없으므로 이건 무조건 확인 가능하다.)
   - `citations[]`가 비어 있지 않은가? (grounding이 실제로 검색했는가 — step 5의 산출물)
   - **로그의 생성된 검색어에서 HN 쿼리가 영어인가?** (step 7. 한국어면 HN이 조용히 0건이 된다)
   - `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET`이 `.env`에 있다면 `source: "naver"` 항목도 있는가?

   **키가 없어 네이버를 검증할 수 없다면 `blocked`로 처리하지 마라** — 코드와 테스트는 완성이다.
   summary에 "네이버는 키가 없어 실제 호출 미검증"이라고 적고 `completed`로 진행하라.

3. **fail-soft 검증**: `.env`의 `YOUTUBE_API_KEY`를 일부러 잘못된 값으로 바꾸고 재실행해,
   파이프라인이 **완주하고** `report.md`가 나오는지 확인하라. YouTube 실패가 전체를 죽이면 실패다.

4. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/`에만 있는가?
   - 키가 없는 소스가 **실패가 아니라 부재**로 처리되는가? (배열에서 제외)
   - `collectAll`의 fail-soft가 유지되는가?
   - `state.json`이 단일 진실 공급원이고 resume이 동작하는가?
   - 테스트가 **API 키 없이** 통과하는가? (CLAUDE.md CRITICAL)

5. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 9를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `buildResearchSources`의 키별 분기, `.env.example` 내용, YouTube 병렬화의 의미 보존 규칙,
     그리고 **2번의 실제 실행 검증 결과**(HN·네이버·citations가 실제로 나왔는지)를 포함하라.
     이게 phase의 마지막 step이므로 phase 전체 통합 결과를 요약에 담아라.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **키가 없을 때 "항상 reject하는 가짜 fetchFn"을 주입하지 마라.** 이유: 그건 "동작할 수 없는 서비스 객체"를
  만드는 거짓말이다. `collectAll`이 이를 "수집 실패"로 기록해 LLM 프롬프트에 "네이버 수집이 실패했다"고 적는데,
  사실은 **애초에 키가 없었던** 것이다. 두 상황은 다르다. 키가 없으면 **배열에 안 넣는다.**
- **`GEMINI_API_KEY` 부재를 warn으로 낮추지 마라.** 이유: Gemini 없이는 파이프라인이 한 step도 못 돈다.
  하드 실패(exit 1)를 유지하라.
- **네이버 키가 반쪽만 있을 때 서비스를 만들지 마라.** 이유: `clientId`만 있고 `clientSecret`이 없으면
  401로 죽는다. 부재로 취급하고 warn하라.
- **YouTube 댓글 병렬화에서 `quotaExceeded`를 삼키지 마라.** 이유: `Promise.allSettled`로 바꾸면서
  rejected를 전부 무시하면 quota 초과가 조용히 "댓글 0개"가 된다. `commentsDisabled`만 skip하고
  **나머지는 rethrow**하라. 이게 병렬화의 가장 위험한 회귀다.
- **HN을 키 없이 못 쓰는 것처럼 다루지 마라.** 이유: Algolia HN Search는 인증이 없다. **항상 켠다.**
- **`.env`를 커밋하지 마라** (`.gitignore`에 있다). `.env.example`만 수정한다.
- **실제 실행에서 네이버 키가 없다고 `blocked`로 빠지지 마라.** 이유: 코드·테스트는 키 없이 완성된다.
  실제 호출 미검증 사실을 summary에 적고 `completed`로 진행하라.
- 테스트에서 실제 API를 호출하지 마라 (CLAUDE.md CRITICAL — `npm test`는 API 키 없이 통과해야 한다).
  **2번의 실제 실행 검증은 `npm test`가 아니라 `npm run consult`다.** 혼동하지 마라.
- 기존 테스트를 깨뜨리지 마라.
