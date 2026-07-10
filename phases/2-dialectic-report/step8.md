# Step 8: evidence-accordion

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
- `/docs/PRD.md` — 5단계 서사의 1단계 "시장 맥락(건조한 팩트)", Accordion(Summary/Details) 규격
- `/docs/UI_GUIDE.md` — 정보 밀도 규칙, 인용 스타일, 타이포그래피
- `/src/types/marketContext.ts` — step 1이 추가한 `briefing`·`marketSizeIndicators`·
  `competitorInsight`·`voicesInsight`
- `/web/src/components/report/MarketContextSection.tsx` — 현재 구현
- `/web/src/components/report/CompetitorTable.tsx`
- `/web/src/components/ui/Collapsible.tsx` — 네이티브 `<details>` 기반
- `/web/src/lib/richText.tsx`
- `/web/src/test/components/report.test.tsx`

## 배경

현재 `MarketContextSection`은 트렌드 불릿, 경쟁사 표, YouTube 댓글 카드, 페인포인트 근거를
**전부 본문에 나열한다.** 사용자가 리포트를 열자마자 원시 데이터에 파묻힌다.

PRD의 출력 원칙: **원시 데이터를 그대로 나열하지 말고, AI의 시각으로 분석하고 정제된 형태의
'인사이트'로 변환하여 제공한다.** 방대한 근거 자료는 아코디언 안에 숨긴다.

step 1이 `MarketContext`에 정제된 인사이트 필드 4개를 추가했다. 이제 본문은 그것만 보여주고,
원시 배열은 접힌 영역으로 내린다.

또한 이 섹션은 5단계 서사의 1단계다. 톤은 **건조하고 팩트 위주**여야 한다 — 낙관도 비관도 없다.

## 작업

### `web/src/components/report/MarketContextSection.tsx` (재작성)

```tsx
export function MarketContextSection({ context }: { context?: MarketContext }): JSX.Element;
```

구조:

```
<section id="market" aria-labelledby="market">   ← max-w-3xl (본문 폭 유지)
  <SectionHeading id="market">① 시장 맥락</SectionHeading>

  {context.briefing}                              ← 리드 문단. renderRichText

  ### 시장 규모 지표                                ← marketSizeIndicators가 비어 있으면 통째로 생략
    불릿 목록

  ### 경쟁 구도
    {context.competitorInsight}                   ← 본문 (Summary)

  ### 타겟 유저의 목소리
    {context.voicesInsight}                       ← 본문 (Summary)

  <Collapsible summary="근거 자료 — 경쟁 서비스 N개 · 유저 목소리 N건 · 트렌드 N건 · 출처 N개">
    ── 트렌드 (불릿)
    ── 경쟁 서비스 (CompetitorTable)
    ── 실제 유저 목소리 (인용 카드)
    ── 페인포인트 근거 (불릿)
    ── 출처 (링크 목록)
  </Collapsible>
</section>
```

규칙:

- **본문에는 `briefing`·`marketSizeIndicators`·`competitorInsight`·`voicesInsight`만 놓는다.**
  `trends`·`competitors`·`youtubeVoices`·`painPointEvidence`·`sources`는 전부 `Collapsible` 안이다.
- `Collapsible`의 `summary`에는 **건수를 표기**한다(UI_GUIDE 정보 밀도 규칙). 개수가 0인 항목은
  summary 문자열에서 뺀다(예: YouTube 수집 실패 시 "유저 목소리 0건"이 아니라 항목 자체를 생략).
- 원시 데이터가 하나도 없으면(`trends`/`competitors`/`youtubeVoices`/`painPointEvidence`/`sources`가
  모두 빈 배열) `Collapsible` 자체를 렌더링하지 않는다.
- `marketSizeIndicators`가 빈 배열이면 "시장 규모 지표" 소제목을 출력하지 않는다.
  이유: 검색으로 지표를 못 찾는 정상 상황이 있고(step 1이 `.min(1)`을 걸지 않은 이유), 빈 소제목은 노이즈다.
- `youtubeVoices`가 빈 배열이면 접힌 영역 안에 "수집된 YouTube 목소리 없음"을 표시한다.
  `voicesInsight`는 (에이전트가 그 사실을 진술했으므로) 본문에 그대로 렌더링한다.
- 장문 텍스트는 `renderRichText`로 렌더링한다. `<p>`/`<li>` 안의 문자열에는 `renderInline`을 쓴다.
  **산출물 문자열을 그대로 JSX에 넣지 마라 — `**`가 화면에 노출된다.**
- YouTube 인용 카드의 기존 스타일(좌측 2px `border-neutral-300`, 작성자·좋아요·영상 링크 새 탭)과
  `CompetitorTable`은 그대로 재사용한다. 접힌 영역 안으로 위치만 옮긴다.
- `CompetitorTable`의 "초기 8개 + 더보기" 동작이 있다면, 아코디언 안에서는 **전체를 펼쳐도 된다**
  (이미 한 겹 접혀 있으므로 이중 점진 노출은 과하다). 판단은 에이전트에게 맡긴다.

빈 상태:

- `context`가 `undefined`면 `EmptyState`. 이유: 구버전 run은 새 스키마 검증에 실패해 필드가 생략된다.

`Collapsible`의 `summary` prop이 `string`이라 건수 문자열을 만들어 넘기면 된다.
`ReactNode`가 필요하면 `Collapsible`의 prop 타입을 넓혀도 좋으나, **다른 사용처를 깨뜨리지 마라.**

## 테스트 (TDD — 먼저 작성한다)

`web/src/test/components/report.test.tsx`의 `MarketContextSection` 테스트를 재작성한다.
Tailwind 클래스가 아니라 **계약·동작·접근성·시맨틱 훅**으로 검증하라:

- `briefing`·`competitorInsight`·`voicesInsight`가 **접히지 않은 본문**에 보인다
  (`<details>` 밖에 있음을 DOM 관계로 단언 — 예: `details.contains(node) === false`).
- 첫 경쟁사 이름과 첫 YouTube 댓글 원문이 **`<details>` 안**에 있다.
- `<details>`가 기본적으로 닫혀 있고(`open` 속성 없음), summary 클릭으로 열린다.
- summary 문자열에 경쟁사·유저 목소리 건수가 포함된다.
- `marketSizeIndicators: []`면 "시장 규모 지표" 소제목이 **렌더링되지 않는다**.
- `youtubeVoices: []`면 접힌 영역에 "수집된 YouTube 목소리 없음"이 있고, `voicesInsight`는 본문에 있다.
- 모든 원시 배열이 비어 있으면 `<details>` 자체가 렌더링되지 않는다.
- `context`가 `undefined`면 `EmptyState`가 보이고 throw하지 않는다.
- YouTube 영상 링크가 `target="_blank"`와 `rel="noopener noreferrer"`를 갖는다(기존 동작 회귀 방지).
- `**볼드**`가 포함된 `briefing`이 `**` 문자 그대로 노출되지 않는다.
- 섹션이 `aria-labelledby="market"`으로 제목과 연결된다.

## Acceptance Criteria

```bash
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. UI_GUIDE 체크리스트를 확인한다:
   - 원시 데이터(경쟁사 표·댓글 원문·출처 URL)가 전부 `Collapsible` 안에 있는가?
   - 본문 폭이 `max-w-3xl`인가? (Split View만 5xl 예외)
   - 접힌 영역 summary에 건수가 표기되는가?
   - `**` 같은 마크다운 원문이 화면에 노출되지 않는가?
3. 아키텍처 체크리스트를 확인한다:
   - 타입을 `@anvil/types`에서 import하는가?
   - `Collapsible`의 기존 사용처(`sources` 외)를 깨뜨리지 않았는가?
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 원시 데이터(`trends`·`competitors`·`youtubeVoices`·`painPointEvidence`·`sources`)를 본문에
  노출하지 마라. 이유: PRD의 출력 원칙 — 방대한 근거 자료는 아코디언 안에 숨기고 본문에는
  정제된 인사이트만 놓는다. 이게 이 step의 존재 이유다.
- `<details>` 대신 커스텀 JS 아코디언을 만들지 마라. 이유: UI_GUIDE가 네이티브 `<details>/<summary>`를
  지정했다. 키보드 접근성과 인쇄 동작을 공짜로 얻는다.
- `marketSizeIndicators`가 비었을 때 빈 소제목이나 "데이터 없음" 문구를 본문에 남기지 마라.
  이유: 1단계는 건조한 팩트 브리핑이다. 빈 자리 표시는 노이즈다.
- 산출물 문자열을 `renderRichText`/`renderInline` 없이 JSX에 넣지 마라. 이유: `**볼드**`가
  화면에 그대로 노출된다(UI_GUIDE 명시).
- `MarketContext` 스키마를 수정하지 마라. 이유: step 1이 확정했다.
- `DialecticSplit`·`SolutionSection`·`ReportView`를 수정하지 마라. 이유: step 7·9·10의 범위다.
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다.
- 기존 테스트를 깨뜨리지 마라.
