# Step 8: evidence-render

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` — **컴포넌트 매핑 규격의 Accordion 원칙**: "원시 데이터는 본문에 투척하지 않는다.
  본문에는 정제된 인사이트 문단만, 원시 근거는 접힌 영역에" — 이 원칙을 지켜라
- `/docs/UI_GUIDE.md` — 색은 데이터 의미에만. 무채색 문서 톤
- `/docs/ADR.md` — ADR-012(citations 공존), ADR-008(결론 후치)
- `/src/types/marketContext.ts` — step 1. `CommunityVoice`, `Citation`
- `/src/types/research.ts` — step 1. **`SOURCE_LABELS`** (라벨의 유일한 소스)
- `/src/lib/report.ts` — `voiceBlock`(`:35-41`), `rawEvidenceDetails`(`:55-92`), 1절 시장 맥락(`:145-154`)
- `/src/lib/report.test.ts`
- `/web/src/components/report/MarketContextSection.tsx` — `YoutubeVoiceCard`(`:9-34`),
  `evidenceSummary()`(`:43-53`), `<Collapsible>`(`:111-182`)
- `/web/src/components/ui/Badge.tsx` — **이미 존재한다. 소스 뱃지로 재사용하라**
- `/web/src/components/ui/Collapsible.tsx`
- `/web/src/components/report/CompetitorTable.tsx` — 아코디언 안의 기존 테이블
- `/web/src/test/components/report.test.tsx`
- `/web/src/test/clientFixtures.ts`

## 배경

step 1이 스키마를 `communityVoices` + `citations`로 바꾸면서 `report.ts`와 `MarketContextSection.tsx`는
**필드 이름만 기계적으로 갈아끼워 컴파일을 통과시킨 상태**다. 렌더링은 아직 YouTube 단일 소스 시절 그대로다:

- 목소리가 **소스 구분 없이 한 덩어리**로 나온다. YouTube 댓글인지 HN 코멘트인지 네이버 카페글인지 알 수 없다.
- **`citations`가 어디에도 렌더링되지 않는다.** step 5가 힘들게 추출한 검증된 검색 인용이 화면에 안 나온다.
- 빈 상태 문구가 "수집된 YouTube 목소리 없음"이다.

이 step이 **렌더링 레이어를 제대로 만든다.**

### 지켜야 할 원칙

1. **원시 근거는 아코디언 안에 있다** (PRD 컴포넌트 매핑). 본문(`briefing`, `competitorInsight`, `voicesInsight`)에
   목소리 원문을 끌어올리지 마라.
2. **`sources`와 `citations`는 나란히, 그러나 분리해서** 보여준다. 합치지 마라 (ADR-012 — 실패 모드가 상보적).
3. **소스 라벨은 `SOURCE_LABELS` 상수에서만** 온다. `"YouTube"` 같은 문자열을 렌더러에 하드코딩하지 마라.
4. **새 색을 도입하지 마라** (UI_GUIDE — 색은 데이터 의미에만). 소스 구분은 기존 `Badge`의 무채색 톤으로 한다.
   severity 팔레트를 소스 구분에 전용하지 마라 — 소스는 위험도가 아니다.

## 작업

### 1. `src/lib/report.ts` (Markdown 렌더러)

- **`voiceBlock(voice: CommunityVoice)`** — 소스 라벨을 인용 출처에 넣는다:
  ```
  > "원문 그대로의 인용"
  > — [YouTube] 영상 제목 (https://..., 좋아요 42)
  ```
  라벨은 `SOURCE_LABELS[voice.source]`. `score`가 없으면 생략. `extra`가 있으면 출처 줄에 덧붙인다
  (예: `— [네이버] 글 제목 (https://..., 검색 스니펫)`).
  기존의 `replace(/\n/g, "\n> ")` 개행 처리는 **반드시 보존**하라 (원문에 줄바꿈이 있어도 인용 블록이 안 끊긴다).

- **`rawEvidenceDetails(context)`의 `#### 유저 목소리`** — **소스별로 그룹핑**한다.
  `RESEARCH_SOURCE_IDS` 순서로 돌며 해당 소스의 voice가 있으면 `##### {SOURCE_LABELS[id]}` 소제목 후 인용.
  빈 소스는 소제목째 생략한다. 전체가 비면 **"수집된 유저 목소리 없음"**.

- **`<summary>` 건수 표기** — 소스 내역을 괄호로 덧붙인다:
  ```
  원시 근거 — 경쟁 서비스 3개 · 유저 목소리 12건(YouTube 5 · Hacker News 4 · 네이버 3) · 트렌드 4건 · 출처 6개 · 검색 인용 9개
  ```
  0인 항목은 문자열에서 제거한다 (기존 `evidenceSummary` 관례).

- **`#### 검색 인용` 소절 신설** — `#### 출처` **다음에** 형제로 놓는다. **합치지 마라.**
  각 citation은 `[{title ?? domain ?? uri}]({uri})` 링크로 렌더링한다.
  `citations`가 비면 소제목째 생략한다.

- **전부 `<details>` 안에 있어야 한다** (PRD 아코디언 원칙).

### 2. `web/src/components/report/MarketContextSection.tsx`

- **`YoutubeVoiceCard` → `CommunityVoiceCard`**로 이름을 바꾸고 `CommunityVoice`를 받는다.
  기존 `<figure>/<blockquote>/<figcaption>` 시맨틱 마크업은 **유지**한다.
  `<figcaption>`에 **기존 `ui/Badge.tsx`로 소스 뱃지**를 단다 (`SOURCE_LABELS[voice.source]`).
  `score`·`authorName`·`extra`는 있을 때만 노출.
  외부 링크는 기존처럼 `target="_blank"` + `rel`.

- **소스별 그룹핑** — `<Collapsible>` 안에서 `RESEARCH_SOURCE_IDS` 순으로 소제목(`{라벨} · N건`) 후 카드들.
  **아코디언 밖으로 절대 내보내지 마라.**

- **`evidenceSummary()`** — `context.communityVoices.length` + 소스별 내역 + `인용 {citations.length}개`.
  0인 항목은 생략하는 기존 규칙 유지.

- **`hasRawEvidence`** 판정에 `citations.length > 0`을 추가한다 (인용만 있어도 아코디언이 떠야 한다).

- **검색 인용 리스트** — 기존 "출처" 블록의 **형제**로 추가. 링크 텍스트는 `title ?? domain ?? uri`.
  "출처"와 "검색 인용"이 **다른 것**임을 사용자가 알 수 있게 소제목을 분리하라.

- **`EmptyState`**(`context === undefined`)는 그대로 유지한다.

### 3. web 테스트 fixture

- `web/src/test/clientFixtures.ts` — `MARKET_CONTEXT`에 **3개 소스의 voice**(youtube/hackernews/naver 각 1건 이상)와
  `citations` 2건 이상을 넣어라. 렌더링 테스트가 실제로 그룹핑·뱃지를 검증할 수 있어야 한다.
- **`web/src/test/fixtures/*/context.json`** — step 1이 **구 형식(`youtubeVoices`)으로 남겨둔 fixture는
  그대로 두어라.** 그게 하위호환(preprocess 승격) 회귀 가드다. 새 형식 fixture가 필요하면 별도로 추가하라.

## 테스트 (TDD — 먼저 작성한다)

> **이 프로젝트의 테스트 품질 규약**: Tailwind 클래스 단언 같은 브리틀한 검사를 쓰지 마라.
> **계약·동작·접근성·시맨틱 `data-*` 훅**으로 검증한다. (phase 2의 step 8~11이 이 규약을 확립했다.
> `web/src/test/components/report.test.tsx`의 기존 테스트를 읽고 스타일을 맞춰라.)

### `src/lib/report.test.ts` (갱신)

- 소스가 3개 섞인 `communityVoices` → 마크다운에 **소스별 소제목**이 `SOURCE_LABELS` 값으로 나온다
  (하드코딩 문자열 대신 상수를 참조해 단언하라)
- `voiceBlock`이 **원문을 축자로** 싣는다 (자르지 않음). 개행이 있는 댓글도 인용 블록이 안 끊긴다
- **`citations`가 `#### 검색 인용`으로 렌더링되고, `#### 출처`와 별개 소절이다** (둘 다 존재)
- `citations`가 비면 검색 인용 소제목이 **없다**
- `title`도 `domain`도 없는 citation → 링크 텍스트가 `uri`로 폴백된다
- **원시 근거가 전부 `<details>` 안에 있다** (`<details>` 시작/종료 인덱스로 위치 검증 — 기존 report.test.ts 패턴)
- `briefing`/`competitorInsight`/`voicesInsight`는 `<details>` **밖**에 있다
- `<summary>` 건수 문자열에 소스별 내역이 들어간다
- `communityVoices`가 비면 "수집된 유저 목소리 없음"
- 순수성: 같은 입력 → 같은 출력

### `web/src/test/components/report.test.tsx` (갱신)

- 3개 소스의 voice가 **각각 소스 뱃지와 함께** 렌더링된다 (텍스트는 `SOURCE_LABELS` 참조로 단언)
- 목소리 카드가 **`<details>`(Collapsible) 안**에 있다 (`details.contains(node) === true`)
- `briefing`은 `<details>` **밖**이다 (`details.contains(node) === false`)
- **`<details>`가 기본 닫힘이고, `<summary>` 클릭으로 열린다**
- `<summary>` 건수에 소스별 내역과 인용 개수가 들어간다
- **`citations`가 "출처"와 분리된 소제목으로 렌더링된다**
- citation 링크가 `target="_blank"` + `rel`을 갖는다
- `communityVoices`가 비어도 `voicesInsight`는 본문에 남는다 (에이전트가 부재를 이미 진술한다)
- 원시 배열이 전부 비고 `citations`도 비면 `<details>` 자체가 없다
- `citations`만 있고 나머지가 비면 `<details>`가 **있다** (`hasRawEvidence` 회귀 가드)
- `context === undefined` → `EmptyState`, no-throw
- `**볼드**` 마크다운이 화면에 그대로 노출되지 않는다 (`renderRichText`)
- **구 형식 fixture(fx01)로 렌더링해도 목소리가 나온다** — preprocess 승격 + 렌더링 관통

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
grep -q "SOURCE_LABELS" src/lib/report.ts
grep -q "SOURCE_LABELS" web/src/components/report/MarketContextSection.tsx
grep -rq "YoutubeVoiceCard" web/src && echo "FAIL: 구 컴포넌트가 남아 있다" && exit 1
grep -q "검색 인용" src/lib/report.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **개발 서버로 눈으로 확인하라.** `npm run web`을 띄우고 fixture run
   (`web/src/test/fixtures/` 중 완료된 것)의 `/runs/{id}` 페이지를 열어:
   - 목소리가 소스별로 그룹핑되고 뱃지가 붙는가?
   - "출처"와 "검색 인용"이 **분리**되어 보이는가?
   - 목소리·인용이 전부 **접힌 영역 안**에 있는가? (본문에 투척되지 않았는가)
   - 구 형식 fixture도 목소리가 보이는가?
3. 아키텍처 체크리스트:
   - PRD의 아코디언 원칙(원시 데이터는 접힌 영역)이 지켜지는가?
   - UI_GUIDE — **새 색(hex)을 추가하지 않았는가?** severity 팔레트를 소스 구분에 전용하지 않았는가?
   - 소스 라벨이 `SOURCE_LABELS` 단일 소스에서 오는가? (web에서 중복 정의 0 — ADR-006)
   - 테스트가 Tailwind 클래스가 아니라 계약·동작·접근성·`data-*`로 검증하는가?
   - 테스트가 API 키 없이 통과하는가?
4. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `voiceBlock` 출력 형식, `<summary>` 건수 문자열 형식, `CommunityVoiceCard`의 훅,
     "검색 인용" 소절의 위치를 포함하라.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **`sources`와 `citations`를 하나의 목록으로 합치지 마라.** 이유: `citations`의 uri는 만료되는 리다이렉트
  URL이고, `sources`는 LLM 자기보고라 부정확할 수 있다. 실패 모드가 상보적이라 **분리해서** 보여야
  사용자가 무엇을 믿을지 판단할 수 있다 (ADR-012).
- **목소리·인용·경쟁사 표를 본문(아코디언 밖)으로 끌어올리지 마라.** 이유: PRD 컴포넌트 매핑 규격 —
  "원시 데이터는 본문에 투척하지 않는다". 본문은 정제된 인사이트(`briefing`/`competitorInsight`/`voicesInsight`)만이다.
- **소스 라벨을 하드코딩하지 마라** (`"YouTube"`, `"Hacker News"`, `"네이버"`). 이유: `SOURCE_LABELS`가
  단일 소스다. 하드코딩하면 두 개의 진실이 생긴다.
- **새 색(hex)을 추가하지 마라.** 이유: UI_GUIDE — 색은 데이터 의미(severity)에만 쓴다. 소스 구분은
  기존 `Badge`의 무채색 톤으로 충분하다. **severity 팔레트(red/amber/gray)를 소스 구분에 전용하지 마라** —
  소스는 위험도가 아니다. 독자가 "네이버가 빨간색이니 위험한가?"라고 오해한다.
- **`web/src/test/fixtures/*/context.json`의 구 형식 fixture를 새 형식으로 바꾸지 마라.** 이유: step 1이
  하위호환(preprocess 승격) 회귀 가드로 일부러 남겨둔 것이다. 바꾸면 승격 경로가 무테스트가 된다.
- **Tailwind 클래스 이름으로 단언하는 테스트를 쓰지 마라.** 이유: 이 프로젝트의 테스트 규약은
  계약·동작·접근성·시맨틱 `data-*` 훅으로 검증하는 것이다. 클래스 단언은 리팩터링에 브리틀하다.
- **차트 라이브러리를 추가하지 마라** (ADR-009). 이 step에 시각화는 없다.
- **`src/agents/`·`src/services/`·`src/research/`·`src/cli/`를 건드리지 마라.** 이유: 이 step은
  **렌더링 레이어**만이다. 소스 활성화는 step 9다.
- 테스트에서 실제 API를 호출하지 마라.
- 기존 테스트를 깨뜨리지 마라.
