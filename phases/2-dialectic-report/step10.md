# Step 10: report-view

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
- `/docs/PRD.md` — "리포트 뷰" UX 원칙(순차 논증), 5단계 서사표
- `/docs/UI_GUIDE.md` — 디자인 원칙 2(순차 논증), 레이아웃(목차 네비, Split View 폭 예외)
- `/docs/ADR.md` — **ADR-008(결론 후치). 이 step의 존재 이유다**
- `/web/src/components/report/ReportView.tsx` — 현재 구현 (역피라미드)
- `/web/src/components/report/VerdictBanner.tsx` — **이 step에서 삭제된다**
- `/web/src/components/report/SectionNav.tsx` — 현재 5개 앵커
- `/web/src/components/report/ReportHeader.tsx`
- `/web/src/components/report/DialecticSplit.tsx` (step 7) — 앵커 `thesis`, `antithesis`
- `/web/src/components/report/MarketContextSection.tsx` (step 8) — 앵커 `market`
- `/web/src/components/report/SolutionSection.tsx`, `VerdictSection.tsx` (step 9) — 앵커 `solution`, `verdict`
- `/web/src/lib/server/runs.ts` — `RunDetail`(`thesis`·`verdict` 포함)
- `/web/src/test/components/report.test.tsx`

## 배경

이 phase의 마지막 UI 조립이다. 지금까지 만든 섹션들을 **5단계 서사 순서로** 배치한다.

현재 `ReportView`는 헤더 바로 아래에 `VerdictBanner`를 둔다 — 역피라미드다. 결론을 먼저 보여주면
그 뒤의 正/反 대립은 이미 답을 아는 독자에게 장식일 뿐이다. ADR-008이 이 구조를 폐기했다.

**이 step에서 `VerdictBanner`가 사라진다.** 상단에는 결론도, severity 집계도, 생존 점수도 남지 않는다.
사용자는 끝까지 읽어야 판정을 본다.

## 작업

### 1. `web/src/components/report/ReportView.tsx` (재배치)

```tsx
export function ReportView({ detail }: { detail: RunDetail }): JSX.Element;
```

배치 순서(협상 불가 — ADR-008):

```
ReportHeader            아이디어 제목 · 실행 일시 · report.md 다운로드
────────────────────────────────────────────────
SectionNav (좌측 sticky / 모바일 상단 가로 스크롤)
  ① 시장 맥락      → #market       MarketContextSection   (max-w-3xl)
  ② 낙관적 가설 正 → #thesis   ┐
  ③ 냉정한 비판 反 → #antithesis ┘ DialecticSplit          (max-w-5xl)
  ④ 인사이트 및 재설계 合 → #solution  SolutionSection    (max-w-3xl)
  ⑤ 최종 판정      → #verdict      VerdictSection         (max-w-3xl)
```

- **`VerdictBanner`를 렌더링하지 않는다.** `VerdictBanner.tsx` 파일을 삭제하라.
- 섹션 폭이 다르다: `DialecticSplit`만 `max-w-5xl`, 나머지는 `max-w-3xl`.
  현재처럼 `max-w-3xl` 컨테이너로 전부 감싸면 Split View가 좁아진다. 폭을 각 섹션이
  스스로 정하도록 컨테이너 구조를 바꿔라(예: 바깥은 `max-w-5xl`, 3xl 섹션이 자기 폭을 제한).
- `detail`에서 `context`·`thesis`·`criticism`·`solution`·`verdict`를 각 섹션에 넘긴다.
  각 섹션은 `undefined`를 빈 상태로 처리하도록 이미 구현돼 있다.
- **구버전 run 안내**: `detail.verdict === undefined && detail.hasReport`인 경우
  (= 완료됐지만 새 스키마 산출물이 없는 run) 헤더 아래에 안내 배너를 하나 렌더링하라:
  "이 리포트는 이전 버전 형식으로 생성되었습니다. 전체 내용은 report.md 다운로드로 확인하세요."
  이건 결론 스포일러가 아니라 데이터 상태 안내이므로 상단에 두어도 ADR-008에 어긋나지 않는다.

### 2. `web/src/components/report/SectionNav.tsx` (갱신)

`REPORT_SECTIONS` 상수를 5단계 서사에 맞게 교체한다:

```ts
[
  { id: "market",     label: "① 시장 맥락" },
  { id: "thesis",     label: "② 낙관적 가설 (正)" },
  { id: "antithesis", label: "③ 냉정한 비판 (反)" },
  { id: "solution",   label: "④ 인사이트 및 재설계 (合)" },
  { id: "verdict",    label: "⑤ 최종 판정" },
]
```

**현재 섹션 강조를 추가한다.** ADR-008의 트레이드오프("결론을 보려면 스크롤이 필요하다")를 완화하는
장치다. 사용자가 논증의 어디쯤 있는지 알 수 있어야 한다.

- `IntersectionObserver`로 현재 뷰포트에 있는 섹션을 추적하고 해당 네비 항목에 `aria-current="location"`을
  붙인다. 강조는 색이 아니라 **굵기/좌측 보더** 같은 무채색 수단을 우선하라(UI_GUIDE 원칙 3).
- 클라이언트 컴포넌트가 필요하다(`"use client"`). `ReportView` 전체를 클라이언트로 만들지 말고
  `SectionNav`만 클라이언트로 분리하라.
- `IntersectionObserver`가 없는 환경(jsdom 기본)에서 throw하지 않아야 한다. 테스트에서 mock하거나,
  존재 여부를 가드하라.
- ② 正과 ③ 反은 데스크톱에서 같은 스크롤 위치에 있다(좌우 분할). 둘 중 하나만 `aria-current`가
  되도록 결정적 규칙을 정하라(예: 먼저 교차한 것 우선). 모바일에서는 실제로 분리돼 있어 자연히 구분된다.

### 3. 리포트 뷰의 진입 애니메이션

UI_GUIDE가 허용하는 것은 fade-in(0.3s)뿐이다. 섹션별 스크롤 트리거 애니메이션을 넣지 마라.

## 테스트 (TDD — 먼저 작성한다)

`web/src/test/components/report.test.tsx` 갱신. **계약·동작·접근성·`data-*` 훅**으로 검증하라:

- 다섯 섹션이 **이 DOM 순서로** 렌더링된다: `#market` → `#thesis`/`#antithesis` → `#solution` → `#verdict`.
  `compareDocumentPosition` 또는 쿼리 결과의 인덱스로 순서를 단언하라.
- `verdict.headline` 텍스트가 `criticism.verdict` 텍스트보다 **뒤에** 나온다(결론 후치 회귀 방지).
- **`VerdictBanner`가 렌더링되지 않는다.** 헤더와 첫 섹션(`#market`) 사이에 `verdict.headline`이나
  `survivalScore` 숫자, severity 집계 뱃지가 존재하지 않는다. 이 테스트가 ADR-008의 회귀 방지선이다.
- `VerdictBanner.tsx` 파일에 대한 import가 코드베이스에 남아 있지 않다.
- `SectionNav`의 앵커 5개가 실제 DOM의 `id`와 모두 일치한다(끊어진 앵커 없음).
  각 `href="#x"`에 대해 `document.getElementById("x")`가 존재하는지 확인하라.
- `detail.verdict`가 `undefined`이고 `hasReport`가 `true`면 구버전 안내 배너가 보인다.
  `verdict`가 있으면 배너가 보이지 않는다.
- 모든 산출물 필드가 `undefined`인 `detail`(완전 구버전 run)로도 throw하지 않고 렌더링된다.
- `IntersectionObserver`가 정의되지 않은 환경에서 `SectionNav`가 throw하지 않는다.
- `nav`에 `aria-label`이 있고, 현재 섹션 항목에 `aria-current`가 붙는다(observer를 mock해 검증).

## Acceptance Criteria

```bash
npm run build
npm test
grep -rq "VerdictBanner" web/src && exit 1 || true
```

세 번째 커맨드: `VerdictBanner`에 대한 참조가 코드베이스에 하나도 남아 있지 않아야 한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `npm run web`으로 개발 서버를 띄우고 완료된 fixture run의 리포트를 실제로 열어
   **결론이 상단에 보이지 않는지** 눈으로 확인한다. 확인 후 서버를 종료한다.
3. UI_GUIDE 체크리스트를 확인한다:
   - 상단에 결론·생존 점수·severity 집계가 없는가? (ADR-008)
   - `DialecticSplit`만 `max-w-5xl`이고 나머지는 `max-w-3xl`인가?
   - 목차 네비의 현재 섹션 강조가 색이 아니라 무채색 수단인가?
   - 허용되지 않은 애니메이션이 없는가?
4. 아키텍처 체크리스트를 확인한다:
   - `"use client"` 경계가 `SectionNav`에만 있고 `ReportView` 전체를 클라이언트로 만들지 않았는가?
   - 타입을 `@anvil/types`에서 import하는가?
5. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 10을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 상단에 결론 요약을 어떤 형태로든 남기지 마라 — verdict 전문, `headline`, 생존 점수, severity 집계
  뱃지 전부 금지다. 이유: ADR-008. 정반합은 전개 과정 자체가 산출물이고, 결론 선노출은 正/反
  대립을 장식으로 만든다. 구버전 안내 배너만 예외다(데이터 상태 안내이지 결론이 아니다).
- `VerdictBanner.tsx`를 남겨두지 마라. 이유: 죽은 코드가 남으면 다음 세션이 "왜 안 쓰지?" 하고
  되살린다. 삭제가 의도를 코드로 표현하는 방법이다.
- `ReportView` 전체에 `"use client"`를 붙이지 마라. 이유: 서버 컴포넌트로 유지해야 fixture 기반
  서버 렌더링 테스트와 초기 로드 성능이 유지된다. `SectionNav`만 클라이언트다.
- 섹션 순서를 바꾸지 마라. `시장 맥락 → 正 → 反 → 合 → 최종 판정`은 PRD와 ADR-008이 못박았다.
- `IntersectionObserver`를 가드 없이 호출하지 마라. 이유: jsdom 기본 환경에 없다. 테스트가 죽는다.
- 스크롤 트리거 애니메이션을 넣지 마라. 이유: UI_GUIDE 애니메이션 규칙 — fade-in과 스피너만 허용.
- 섹션 컴포넌트(`MarketContextSection`·`DialecticSplit`·`SolutionSection`·`VerdictSection`)의
  내부 구현을 수정하지 마라. 이유: step 7·8·9가 확정했다. 이 step은 배치와 목차만 담당한다.
- `/compare` 뷰를 수정하지 마라. 이유: step 11의 범위다.
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다.
- 기존 테스트를 깨뜨리지 마라.
