# Step 0: design-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 기획·아키텍처·설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` — 목표·핵심 기능·리포트 출력 규격·컴포넌트 매핑
- `/docs/ARCHITECTURE.md` — 디렉토리 구조·패턴·데이터 흐름
- `/docs/ADR.md` — 특히 ADR-001(Gemini grounding), ADR-003(웹검색=grounding, YouTube=Data API), ADR-004(하네스 패턴), ADR-011(스키마 변경 시 하위호환)
- `/src/agents/contextHunter.ts` — 현재 자료조사의 전부
- `/src/services/gemini.ts`, `/src/services/youtube.ts` — 현재 서비스 레이어
- `/src/types/marketContext.ts` — 자료조사 산출물 스키마

## 배경

이 step은 **코드를 한 줄도 바꾸지 않는다.** 가드레일 문서만 갱신한다.

step 1~9의 `step{N}.md`는 전부 첫 절이 "**읽어야 할 파일**"이고 거기에 `/docs/ADR.md`·`/docs/ARCHITECTURE.md`가
들어 있다. 각 세션은 그 문서를 **디스크에서 직접 읽고** 작업한다. 문서를 먼저 바꾸지 않으면
step 1~9가 "웹검색은 grounding, 유저 목소리는 YouTube 하나"라는 **옛 설계 의도(ADR-003)를 읽은 채로**
다중 소스를 구현하게 된다. 그래서 문서가 맨 앞에 온다.

> 참고: `scripts/execute.py`는 `CLAUDE.md` + `docs/*.md`를 **매 step 시작 시 다시 읽어**
> 프롬프트 preamble로도 주입한다(`_execute_all_steps`). 즉 이 step이 디스크의 문서를 고치면
> step 1~9는 두 경로(preamble + "읽어야 할 파일")로 새 설계 의도를 받는다.
> **디스크의 문서를 정확하게 만드는 것이 이 step의 전부다.**

### 무엇이 바뀌는가

현재 자료조사(`context-hunter`)의 문제 3가지:

1. **웹검색이 검증되지 않는다.** `gemini.ts`는 `response.text`만 읽고 `groundingMetadata`를 전혀 보지 않는다.
   그래서 `MarketContext.sources[]`는 **실제 검색 인용이 아니라 LLM이 자기 기억으로 적어낸 URL**이다.
   환각 URL을 걸러낼 장치가 없다.
2. **검색 쿼리가 아이디어 원문 그대로다.** `contextHunter.ts`가 `collectVoices(idea)`로 아이디어 문장 전체를
   YouTube `q=` 파라미터에 넣는다. 인터뷰 답변(`clarifications`)은 프롬프트에만 붙고 검색어에는 반영되지 않는다.
3. **유저 목소리가 YouTube 댓글로만 편향된다.** 한국 시장 타겟인데(`relevanceLanguage=ko`) 국내 커뮤니티를 안 본다.

이번 phase가 도입하는 것:

- **소스 3개** — YouTube(기존) + Hacker News(Algolia API, 키 불필요) + 네이버 검색(블로그·카페글·지식iN)
- **정규화된 `CommunityVoice`** — 소스별 스키마를 따로 두지 않고 `{source, title, url, text, authorName?, score?, extra?}` 하나로 통일
- **`citations[]`** — Gemini `groundingMetadata`에서 코드가 추출한 실제 검색 인용. 기존 `sources[]`와 **공존**
- **Gemini `urlContext` 툴** — 경쟁사 공식 페이지를 직접 읽어 가격·기능 정확도를 올린다
- **`researchPlanner`** — 소스별 검색어를 LLM이 생성 (HN은 영어, 네이버·YouTube는 한국어)
- **`src/research/`** — 소스 어댑터 + 병렬 수집(`Promise.allSettled`) + 프롬프트 포맷팅의 새 레이어

## 작업

### 1. `docs/ADR.md` — ADR-012 추가 (append)

기존 ADR 형식(**결정** / **이유** / **트레이드오프**, 필요 시 **뒤집는 결정** / **기각한 대안**)을 그대로 따른다.
ADR-008(`docs/ADR.md:47`)이 **뒤집는 결정** 필드로 선행 결정을 명시적으로 폐기하는 관례를 쓰고 있다 — 이를 따른다.

`### ADR-012: 자료조사를 다중 소스로 확장하고 grounding 인용을 코드로 추출`

담아야 할 내용:

- **결정**: 유저 목소리 수집을 YouTube 단일 소스에서 **YouTube + Hacker News + 네이버 검색** 3소스로 확장한다.
  소스별 원시 타입은 `src/services/`에 유지하되 얇은 어댑터로 공통 `CommunityVoice`로 정규화하고,
  `src/research/`에서 `Promise.allSettled`로 **병렬 수집**한다. 웹검색은 계속 Gemini grounding을 쓰되,
  `groundingMetadata.groundingChunks`에서 **코드가 인용을 추출해 `MarketContext.citations[]`에 담는다**.
  `urlContext` 툴을 `googleSearch`와 병용해 경쟁사 페이지를 직접 읽는다.
  소스별 검색어는 `researchPlanner`가 생성한다(파이프라인 step이 아니라 context-hunter 내부 호출).

- **뒤집는 결정**: ADR-003의 "웹검색은 grounding, 유저 목소리는 YouTube Data API" 범위를 갱신한다.
  grounding을 웹검색 엔진으로 쓴다는 결정은 유지하되, **그 결과를 LLM의 자기보고로만 받던 방식은 폐기한다.**
  YouTube가 유일한 유저 목소리 소스라는 전제도 폐기한다. ADR-003의 "자막 수집 제외"는 그대로 유효하다.

- **이유**:
  - `sources[]`가 LLM 자기보고라 환각 URL을 검증할 수 없었다. `groundingMetadata`는 SDK가 이미 제공하는데
    코드가 읽지 않고 버리고 있었다.
  - **`groundingChunks[].web.uri`는 원 사이트 URL이 아니라 `vertexaisearch.cloud.google.com/grounding-api-redirect/...`
    형태의 만료되는 리다이렉트 URL**이다. 그래서 `sources[]`를 대체하지 않고 `citations[]`로 **공존**시킨다 —
    두 필드의 실패 모드가 상보적이다(자기보고는 부정확하지만 안 만료되고, 인용은 정확하지만 만료된다).
    합치면 "grounding이 아무것도 안 돌려줬다"는 사실이 자기보고에 가려진다.
  - YouTube 댓글만으로는 한국 커뮤니티(카페·지식iN)와 영어권 빌더 담론(HN)을 놓친다.
  - 소스별 타입을 끝까지 끌면 스키마 3개 × 프롬프트 JSON 예시 3블록 × 렌더러 3개 × 웹 카드 3개로 비용이 곱해진다.
    특히 **grounding 모드는 `responseSchema`를 못 써서 프롬프트의 JSON 예시가 유일한 형식 지시**이므로,
    예시 블록이 3배가 되면 형식 실패율이 3배 리스크가 된다.

- **기각한 대안**: 플러그인 레지스트리(동적 소스 등록). 소스는 정확히 3개이고 전부 컴파일 타임에 알려져 있으며
  생성 지점이 `src/cli/index.ts` 한 곳이다. `readonly ResearchSource[]` 배열 자체가 레지스트리다.
  쿼리 생성을 별도 pipeline step으로 분리하는 안도 기각했다 — resume 이득이 거의 없는데(non-grounding 구조화 호출,
  2~4초) `PIPELINE_STEPS`·`STEP_OUTPUT_FILES`·웹 진행 뷰까지 파급되고, 사용자에게 노출되는 "변증법 단계" 언어를
  구현 디테일로 오염시킨다.

- **트레이드오프**: `NAVER_CLIENT_ID`/`NAVER_CLIENT_SECRET` 발급이 필요하다(무료, 일 25,000회).
  Gemini 호출이 run당 1회 늘어난다(researchPlanner). `urlContext` 병용으로 grounding 호출 지연이 늘어
  타임아웃을 180초로 올리고 재시도를 2회로 줄인다(최악 6분, 기존과 동일). HN은 영어권이라 한국어 쿼리로는
  조용히 0건이 되므로 planner의 영어 쿼리 생성이 필수 전제다.

- **하위호환**: `MarketContext.youtubeVoices`를 `communityVoices`로 대체하되, `z.preprocess`로 구 `context.json`의
  `youtubeVoices[]`를 `communityVoices[]`(`source: "youtube"`)로 **승격**한다. ADR-011처럼 구 run을 빈 리포트로
  만들지 않는다. `.default([])`만으로는 zod의 `strip` 정책 때문에 구 데이터가 조용히 소멸하므로 부족하다.

### 2. `docs/ARCHITECTURE.md`

- **디렉토리 구조** 블록:
  - `services/` 설명에 `hackerNews.ts`, `naver.ts` 추가
  - `research/` 를 신설 계층으로 추가:
    `research/  # 소스 어댑터 + 병렬 수집(collectAll) + 프롬프트 포맷팅 — services/를 CommunityVoice로 정규화`
  - `lib/` 설명에 `html (HTML 태그·엔티티 제거)` 추가
- **패턴** 절: "서비스 레이어 격리" 항목의 외부 API 목록에 Hacker News·네이버 추가.
  새 항목 **"다중 소스 병렬 수집 + fail-soft"** 추가 — 소스는 `Promise.allSettled`로 병렬 수집하고,
  일부 실패는 흡수하며(성공한 소스만 사용), **전부 실패해도 파이프라인을 멈추지 않는다**(웹검색만으로 진행).
  API 키가 없는 소스는 실패가 아니라 **소스 배열에서 제외**한다.
- **데이터 흐름** 블록: `context-hunter` 줄을 갱신한다.
  ```
  → step: context-hunter                                       → runs/{id}/context.json
      ├ researchPlanner (gemini, 소스별 검색어 생성 — step 아님)
      ├ collectAll (youtube + hackernews + naver 병렬, fail-soft)
      └ gemini grounding + urlContext → citations 코드 추출
  ```
- **상태 관리** 절: `STALLED_THRESHOLD_MS`가 10분에서 **15분**으로 바뀐다는 사실을 반영한다
  (PRD의 "run 상태 파생 규칙"과 숫자가 일치해야 한다).

### 3. `docs/PRD.md`

- **목표**(`:4`): "실시간 시장 데이터(웹검색 + YouTube)" → "실시간 시장 데이터(웹검색 + YouTube + Hacker News + 네이버 커뮤니티)"
- **핵심 기능 1. Context Hunter**(`:14`): 다중 소스 수집 + 검증된 검색 인용을 반영해 다시 쓴다.
- **컴포넌트 매핑 규격**의 Accordion 항목(`:51`): "YouTube 댓글 원문" → "커뮤니티 목소리 원문(YouTube·Hacker News·네이버)".
  **원시 데이터는 본문에 투척하지 않고 접힌 영역에 넣는다는 원칙은 유지한다.**
- **run 상태 파생 규칙**(`:106`): mtime 10분 → **15분**.
- 문서 말미에 `# Phase 3-multi-source-research: 다중 소스 자료조사` 절을 추가한다(Phase 1·2 절과 같은 형식):
  - **목표**: 자료조사를 3소스 병렬 수집으로 확장하고, 웹검색 결과를 검증 가능한 인용으로 만든다.
  - **하위호환**: 구 `context.json`의 `youtubeVoices`는 `communityVoices`로 자동 승격된다(ADR-012).
    ADR-011과 달리 **구 run이 빈 리포트가 되지 않는다.**
  - **Phase 3 제외 사항**: Reddit(OAuth 필요), 앱스토어 리뷰, 네이버 카페 본문 전문 수집(스크래핑·로그인 월 필요 —
    검색 스니펫까지만), YouTube 자막(ADR-003 유지), 수집 결과 캐싱, HTTP 레벨 재시도·백오프.

### 4. `CLAUDE.md`

- **환경변수** 절에 2줄 추가:
  ```
  NAVER_CLIENT_ID      # 네이버 개발자센터 검색 API Client ID
  NAVER_CLIENT_SECRET  # 네이버 개발자센터 검색 API Client Secret
  ```
  `GEMINI_API_KEY`만 필수이고 나머지는 **없으면 해당 소스를 건너뛴다**는 사실을 한 줄로 명시하라.
- **아키텍처 규칙**의 첫 CRITICAL(외부 API 호출은 `src/services/`에서만)에서 외부 API 목록에
  Hacker News·네이버를 추가한다. `research/`도 직접 fetch를 하지 않는다는 점을 명시하라 —
  `research/`는 `services/`를 **주입받아 정규화만** 한다.

## Acceptance Criteria

```bash
git diff --name-only            # docs/ADR.md, docs/ARCHITECTURE.md, docs/PRD.md, CLAUDE.md 4개만 나와야 한다
grep -q "ADR-012" docs/ADR.md
grep -q "src/research" docs/ARCHITECTURE.md
grep -q "NAVER_CLIENT_ID" CLAUDE.md
npm run build && npm test && npm run lint    # 코드 무변경이므로 그대로 통과해야 한다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --name-only`로 **코드 파일이 하나도 없는지** 확인한다. `src/`·`web/`·`package.json`이 나오면 실패다.
3. 문서 일관성을 확인한다:
   - ADR-012가 ADR-003을 **뒤집는 결정** 필드로 명시적으로 갱신했는가?
   - ARCHITECTURE의 디렉토리 구조·데이터 흐름·패턴이 서로 모순되지 않는가?
   - PRD의 mtime 15분과 ARCHITECTURE의 15분이 일치하는가?
4. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
     (요약에 **ADR-012의 핵심 결정 4개**(3소스 정규화·citations 공존·urlContext·planner 비-step)와
     STALLED 15분 변경을 반드시 포함하라. 다음 step들이 이 요약을 컨텍스트로 받는다.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **코드를 수정하지 마라.** `src/`, `web/`, `package.json`, `.env.example` 전부 이 step의 범위가 아니다.
  이유: 이 step의 유일한 목적은 이후 step들이 주입받을 가드레일을 교체하는 것이다. 코드가 섞이면
  execute.py의 2단계 커밋(코드 `feat` / 메타 `chore`)이 의미를 잃는다.
- ADR-003을 **삭제하거나 편집하지 마라.** 이유: ADR은 append-only 의사결정 기록이다. 폐기는 새 ADR의
  **뒤집는 결정** 필드로 한다 (ADR-008의 선례).
- ADR-011을 뒤집지 마라. 이유: ADR-011은 criticism/thesis 스키마 변경에 대한 기록이고 여전히 유효하다.
  ADR-012는 MarketContext에 대해 **더 나은 하위호환(preprocess 승격)을 택했다**고 적으면 된다.
- PRD의 5단계 서사(시장 맥락 → 正 → 反 → 合 → 최종 판정)와 "결론 후치" 원칙(ADR-008)을 건드리지 마라.
  이유: 이번 phase는 1단계(시장 맥락)의 **입력**을 바꾸는 것이지 서사를 바꾸는 게 아니다.
- 존재하지 않는 API 스펙을 지어내지 마라. 이 step은 설계 문서만 쓴다 — 구체적 엔드포인트·파라미터는
  step 3·4의 몫이다. ADR에는 **결정과 이유**만 적어라.
- 기존 테스트를 깨뜨리지 마라.
