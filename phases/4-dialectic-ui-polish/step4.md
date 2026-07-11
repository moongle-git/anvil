# Step 4: dialectic-symmetry

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — 특히 `## 컴포넌트`의 **정반합 카드(미러 액센트 레일)** 규격과 테두리 블록 내부 여백 규격
- `/docs/PRD.md` — Split View 규격: "같은 축의 낙관 주장과 비판이 좌우로 나란히 놓인다"
- `/docs/ADR.md`
- `web/src/components/report/DialecticSplit.tsx` — **이 step에서 수정할 유일한 프로덕션 파일**
- `web/src/components/ui/Card.tsx` — step 2에서 `accent` prop이 추가됐다. **시그니처를 반드시 확인하고 그대로 쓸 것**
- `web/src/components/report/RiskScoreBadge.tsx`
- `web/src/components/report/RiskRadar.tsx` — step 3에서 figure 카드로 바뀌었다
- `src/types/dialectic.ts` — `DIALECTIC_AXES`, `DIALECTIC_AXIS_LABELS`, `CriticismSeverity`
- `web/src/test/components/dialectic.test.tsx` — **반드시 정독하라.** 여기 걸린 훅이 구현을 강하게 제약한다

## 배경

正(낙관적 가설)과 反(냉정한 비판)이 좌우로 대립하는데, **디자인이 서로 다른 게 의도가 아니라 그냥 통일이 안 된 상태다.**

현재 문제:

1. **리드 행 골격 불일치** — 正 리드는 `<Card>`(4면 테두리, `rounded-md`, `p-6`)인데, 反 리드는 `<div className="border-l-2 border-neutral-300 bg-neutral-50 p-4">`로 **카드가 아니다.** 각진 모서리에 padding도 8px 좁다.
2. **축 행 baseline 어긋남** — `CriticismCard`만 `RiskScoreBadge`가 제목 **위**에 있어, 왼쪽 카드는 제목부터 시작하는데 오른쪽 카드는 뱃지부터 시작한다.
3. **데스크톱에 좌우 정체성 신호가 없음** — `SideChip`이 `lg:hidden`이라, 스크롤해서 "해자와 카피캣" 축까지 내려가면 상단 컬럼 헤더는 이미 화면 밖이다. 남는 구분 신호가 severity 뱃지 유무뿐이다.
4. **인용 블록이 테두리에 붙음** — `rebuttedClaim` 인용이 `border-l-2 … pl-3`으로 상하 여백이 0이다.

**설계 결정 (UI_GUIDE 정반합 카드 규격):** 골격은 완전히 통일하고, "주장이 서로 반대"라는 것은 **액센트 레일의 방향**으로만 표현한다.

- 正 = **왼쪽** 레일, 무채색(`neutral-900`)
- 反 = **오른쪽** 레일, 해당 항목의 severity 색

두 레일이 가운데 거터를 사이에 두고 마주 보며 정면 대치를 만든다. 이게 컬럼 헤더를 대신하는 좌우 정체성 신호다.

## 작업

`web/src/components/report/DialecticSplit.tsx`만 수정한다.

### 1. 리드 행 — 反 리드를 `Card`로 승격

```
왼쪽: Card accent={left, 무채색}   "핵심 논지"  + thesis.winningThesis
오른쪽: Card accent={right, 최고 severity 톤}  "反의 소결론" + criticism.verdict  (bg-neutral-50 유지)
        그 아래 RiskRadar (step 3에서 이미 figure 카드가 됐다 — 그대로 렌더링만 하면 된다)
```

- 反 리드의 레일 톤은 `maxSeverity(criticism)` (이미 import되어 있다)로 결정한다.
- 배경 `bg-neutral-50`은 유지해도 좋다 (UI_GUIDE: 인용/콜아웃 배경). padding은 `Card` 기본 `p-6`을 쓴다 — `className`으로 `p-4`를 덮어쓰지 마라.
- `criticism.verdict`가 최종 판정이 아니라 反 섹션의 소결론이라는 기존 주석(ADR-010)을 유지하라.

### 2. 축 행 — `ThesisCard` / `CriticismCard` 골격 통일

두 카드 모두 **"제목 → 메타 → 근거"** 순서로 통일한다:

```
ThesisCard:     Card accent={left, 무채색}
                  <h4> claim
                  (메타 없음)
                  <Collapsible summary="근거 보기"> rationale

CriticismCard:  Card accent={right, point.severity 톤}
                  <h4> claim
                  메타 줄: RiskScoreBadge (+ rebuttedClaim 인용)
                  <Collapsible summary="근거 보기"> evidence
```

- **`RiskScoreBadge`를 제목 아래로 내려라.** 지금은 제목 위에 있어 좌우 첫 줄 baseline이 어긋난다. 제목 → 심각도 순서가 스캔 동선에도 맞다 (주장을 읽고 나서 얼마나 심각한지 본다).
- `CriticismCard`의 레일 톤은 **카드마다 다르다** — 그 항목의 `point.severity`를 쓴다. 리드 행처럼 전체 최고 severity를 쓰지 마라.
- `rebuttedClaim` 인용의 여백을 고쳐라. 현재 `border-l-2 border-neutral-300 pl-3`으로 **상하 여백이 0**이다. UI_GUIDE의 레일 인용 규격(`border-l-2 border-neutral-300 py-1 pl-4`)을 따르라.

### 3. `SideChip` 처리

`SideChip`은 모바일 전용(`lg:hidden`)이다. 데스크톱에서는 미러 레일이 그 역할을 대신하므로 **그대로 두어라.** 모바일에서는 컬럼이 세로 스택되어 레일 방향만으로는 구분이 약하므로 칩이 여전히 필요하다.

### 4. 반드시 유지해야 할 테스트 계약

`web/src/test/components/dialectic.test.tsx`가 아래 훅으로 검증한다. **구조를 바꾸되 이 훅들은 전부 유지하라.** 유지하면 테스트를 한 줄도 고치지 않고 통과한다.

| 훅 / 계약 | 비고 |
|---|---|
| `data-axis-row={axis}` (축 행 컨테이너) | |
| `data-thesis-id` / `data-axis` (ThesisCard) | `Card`의 `...rest` 스프레드로 전달된다 |
| `data-criticism-id` / `data-axis` / `data-rebuts` (CriticismCard) | |
| **`data-criticism-id` 요소 _안에_ `RiskScoreBadge`가 있어야 한다** | 제목 아래로 옮겨도 카드 내부이므로 통과 |
| **`data-criticism-id` 요소 _안에_ `rebuttedClaim` 텍스트가 있어야 한다** | |
| `id="thesis"` / `id="antithesis"` (컬럼 헤더 `<h2>`) | |
| `<section id="dialectic" aria-labelledby="thesis antithesis">` | |
| "근거 보기" `<details>`/`<summary>`가 **정확히 6개** (正 3 + 反 3) | |
| `data-axis-row="bm"` 하위의 모든 `[data-axis]`가 axis "bm"이어야 함 | **RiskRadar를 축 행 안으로 옮기면 즉시 깨진다.** 레이더의 축 라벨 `<text data-axis>` 3개는 리드 행에 있어야 한다 |
| `thesis`·`criticism` 둘 다 undefined일 때 EmptyState (ADR-011 구버전 run) | 한쪽만 undefined인 경우도 각각 EmptyState |
| growthLevers가 `<li>`에 `renderInline`으로 직접 들어가는 구조 (`li > strong`) | `ThesisNarrative`의 `LIST` 렌더링을 바꾸지 마라 |

### 5. 테스트 보강

`web/src/test/components/dialectic.test.tsx`에 새 테스트를 추가하라 (기존 테스트는 수정하지 마라):

- 正 카드들이 `data-accent-side="left"`, 反 카드들이 `data-accent-side="right"`임을 검증
- `CriticismCard`의 `data-accent-tone`이 그 항목의 severity에 대응함을 검증 (fatal 카드와 minor 카드의 톤이 다름)
- 反 리드 카드의 `data-accent-tone`이 전체 최고 severity에 대응함을 검증
- `RiskScoreBadge`가 제목 `<h4>` **뒤에** 나옴을 DOM 순서로 검증 (`compareDocumentPosition` 또는 `querySelectorAll` 순서)

**Tailwind 클래스 문자열을 단언하지 마라.** `data-*` 훅·역할·라벨·DOM 구조로만 검증한다.

## Acceptance Criteria

리포지토리 루트에서 실행:

```bash
npm run build -w web   # next build --webpack — 타입 체크 겸함, 에러 0
npm run test  -w web   # vitest run — 전부 통과
npm run lint  -w web   # eslint — 에러 0
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --stat`을 확인한다. `web/src/components/report/DialecticSplit.tsx`와 `web/src/test/components/dialectic.test.tsx`만 변경되어야 한다.
3. `DialecticSplit.tsx`를 처음부터 다시 읽고 자문하라: "正 카드와 反 카드에서 **레일 방향과 severity 뱃지 유무를 빼면** 남는 시각적 차이가 있는가?" 있다면 골격 통일이 덜 된 것이다. padding·모서리·테두리 두께·배경이 다르면 안 된다 (反 리드의 `bg-neutral-50`은 콜아웃 규격이므로 예외).
4. 아키텍처 체크리스트:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
5. 결과에 따라 `phases/4-dialectic-ui-polish/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`RiskRadar`를 축 행(`data-axis-row`) 안으로 옮기지 마라.** 이유: `dialectic.test.tsx`가 "`data-axis-row="bm"` 하위의 모든 `[data-axis]`는 axis가 bm이어야 한다"고 단언한다. 레이더의 축 라벨 `<text data-axis="painPoint|bm|copycat">` 3개가 그 안에 들어가면 즉시 깨진다. 레이더는 리드 행(反 컬럼)에 남는다.
- **`Card`에 `className`으로 padding을 덮어쓰지 마라** (`p-4`, `p-5` 등). 이유: Tailwind는 클래스 순서가 아니라 CSS 정의 순서로 우선순위가 정해져서 어느 쪽이 이길지 불안정하다. 골격 통일이 목적인데 padding을 다시 흩뜨리면 이 step의 의미가 없다.
- **호출부에서 Tailwind 레일 클래스(`border-l-2 border-l-red-600` 등)를 직접 조립하지 마라.** 이유: step 2가 `Card`의 `accent` prop으로 색 매핑을 파일 내부에 격리했다. 호출부는 의미(side/tone)만 넘긴다. 클래스를 흩뿌리면 팔레트 변경 시 전수조사를 해야 한다.
- **正 카드에 severity 색을 쓰지 마라.** 이유: 낙관 주장에는 severity가 없다. 색은 데이터 의미에만 쓴다(UI_GUIDE 원칙 3). 正의 레일은 무채색이다.
- **`SideChip`을 삭제하지 마라.** 이유: 모바일에서 컬럼이 세로 스택될 때 어느 쪽 주장인지 알리는 유일한 신호다. 레일 방향은 세로 스택에서 구분력이 약하다.
- **`ThesisNarrative`의 `LIST` 렌더링을 `renderRichText`로 바꾸지 마라.** 이유: `dialectic.test.tsx`가 `li > strong` 구조에 의존한다. growthLevers/marketTailwinds는 `renderInline`으로 `<li>`에 직접 들어가야 한다.
- **행 정렬 기준을 `rebuts`로 바꾸지 마라.** 이유: `rebuts`는 optional이고 1:N이다. 정렬 기준은 `axis`이며, `rebuts`는 "이 낙관을 반박" 인용 하나로만 쓴다 (기존 주석 참고).
- 다른 컴포넌트(`ReportView`, `VerdictSection`, `MarketContextSection`)를 건드리지 마라. 이유: step 5가 담당한다.
- 기존 테스트를 깨뜨리지 마라.
