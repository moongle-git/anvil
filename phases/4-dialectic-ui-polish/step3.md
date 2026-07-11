# Step 3: risk-radar-figure

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — 특히 `### RiskRadar` 절과 `## 레이아웃`의 정렬 규칙(도형 중앙 정렬 예외)
- `/docs/ADR.md` — **ADR-009**: 차트 라이브러리 없이 인라인 SVG로 직접 구현한다. recharts는 명시적으로 기각됐다
- `web/src/components/report/RiskRadar.tsx` — **이 step에서 수정할 주 파일**
- `web/src/lib/radar.ts` — 좌표 기하 (읽기만 하고 수정하지 마라)
- `web/src/lib/risk.ts` — `RiskAxisScore` 타입, `buildRiskProfile`
- `web/src/components/ui/Card.tsx` — step 2에서 `accent` prop이 추가됐다
- `web/src/test/components/risk.test.tsx` — **반드시 정독하라.** 여기 걸린 단언이 구현을 강하게 제약한다
- `web/src/components/report/DialecticSplit.tsx` — RiskRadar의 유일한 호출부 (읽기만 할 것. 수정은 step 4)

## 배경

리포트의 反(냉정한 비판) 컬럼 하단에 삼각형 레이더 차트가 있는데 **컬럼 기준으로 왼쪽에 치우쳐 보인다.**

원인: `RiskRadar.tsx`의 래퍼가 그냥 `<div data-max-severity={...}>`(블록, 폭 100%)이고, 그 안의 `<svg width={size} height={size}>`는 고정폭(기본 200px)이다. 부모 컬럼은 데스크톱에서 약 460px인데 중앙 정렬 코드가 없어 SVG가 좌측에 붙는다. 게다가 테두리가 없어 그림이 허공에 떠 보인다.

목표: 레이더를 `<figure>` + `<figcaption>`("축별 최고 위험도") 카드로 감싸고 SVG를 가로 중앙 정렬한다.

## 작업

`web/src/components/report/RiskRadar.tsx`만 수정한다. 좌표 계산(`radar.ts`)과 점수 파생(`risk.ts`)은 손대지 않는다 — 문제는 순수하게 배치다.

### 1. figure 카드로 감싸고 SVG 중앙 정렬

현재 구조:

```
<div data-max-severity>
  <svg role="img" aria-label="리스크 레이더 — …">…</svg>
  <ul aria-label="축별 리스크 점수" class="sr-only">…</ul>
</div>
```

목표 구조:

```
<figure data-max-severity>          ← 카드 골격 (rounded-md border border-neutral-200 p-6)
  <figcaption>축별 최고 위험도</figcaption>
  <svg role="img" aria-label="리스크 레이더 — …">…</svg>   ← 가로 중앙 정렬
  <ul aria-label="축별 리스크 점수" class="sr-only">…</ul>
</figure>
```

- SVG 중앙 정렬은 `mx-auto block`(또는 flex 컨테이너 + `justify-center`)로 한다. `block`이 필요한 이유: 인라인 SVG는 baseline 정렬 때문에 아래에 미세한 여백이 생긴다.
- `figcaption`은 카드 제목/라벨 규격(`text-sm font-medium text-neutral-500`)을 따른다. UI_GUIDE 타이포그래피 표를 확인하라.
- 카드 골격은 `ui/Card`를 쓰거나, `<figure>`에 카드 클래스를 직접 얹어도 된다. **판단은 재량에 맡긴다.** 단 `Card`를 쓸 경우 `<div>`로 렌더링되므로 `<figure>` 시맨틱을 잃는다 — 그게 싫으면 `<figure>`에 카드 클래스를 직접 얹어라. 어느 쪽이든 padding은 UI_GUIDE 카드 규격(`p-6`)을 따른다.

### 2. 반드시 지켜야 할 접근성·테스트 계약

`web/src/test/components/risk.test.tsx`가 아래를 단언한다. **하나라도 어기면 테스트가 깨진다.**

| 제약 | 이유 |
|---|---|
| `<figure>`에 `role="img"`를 붙이지 마라 | `getByRole("img")`가 **단수** 조회다. img role이 둘이 되면 "multiple elements found" 에러가 난다. SVG의 `role="img"`는 그대로 유지하라 |
| `<figcaption>`에 `data-axis`를 붙이지 마라 | `[data-axis]` 요소가 **정확히 3개**(축 라벨 `<text>`)여야 한다고 단언한다 |
| `data-max-severity`를 **한 곳에만** 붙여라 | DOM 순서 첫 매치의 값을 단언한다. 두 곳에 서로 다른 값을 붙이면 안 된다 |
| sr-only `<ul aria-label="축별 리스크 점수">`를 유지하라 | `getByRole("list", { name: "축별 리스크 점수" })`로 조회한다. 차트는 장식이 아니라 데이터다 |
| SVG의 `aria-label`(`리스크 레이더 — …`) 형식을 바꾸지 마라 | 조회에 쓰인다 |

### 3. 캡션 문자열

캡션은 **"축별 최고 위험도"**로 하라. 점수가 축별 평균이 아니라 **최댓값**이기 때문이다(`risk.ts`의 `buildRiskProfile` 주석 참고 — fatal 하나가 minor 셋에 희석되면 레이더가 실제보다 안전해 보인다). "위험도"라고만 쓰면 평균으로 오해된다.

이 문자열은 `CompareMatrix.tsx`의 행 라벨과 같지만 **두 컴포넌트가 같은 트리에 렌더링되지 않으므로 충돌하지 않는다.** 확인은 했으니 그대로 써라.

### 4. 테스트 추가

`web/src/test/components/risk.test.tsx`에 새 테스트를 추가하라 (기존 테스트는 수정하지 마라):
- `<figure>`가 존재하고 `<figcaption>` 텍스트가 "축별 최고 위험도"임을 검증 (`getByRole("figure")` 또는 텍스트 조회)
- 기존 `getByRole("img")` 단수 조회가 여전히 성공함을 검증 (img role이 하나뿐임)
- `[data-axis]` 개수가 여전히 3임을 검증

중앙 정렬 자체(`mx-auto`)를 클래스 문자열로 단언하지 마라 — jsdom은 레이아웃을 계산하지 않으므로 의미 있는 검증이 안 되고, 브리틀한 테스트만 남는다. 정렬은 step 5의 육안 검증에서 확인한다.

## Acceptance Criteria

리포지토리 루트에서 실행:

```bash
npm run build -w web   # next build --webpack — 타입 체크 겸함, 에러 0
npm run test  -w web   # vitest run — 전부 통과
npm run lint  -w web   # eslint — 에러 0
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --stat`을 확인한다. `web/src/components/report/RiskRadar.tsx`와 `web/src/test/components/risk.test.tsx`만 변경되어야 한다.
3. 아키텍처 체크리스트:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - **ADR-009를 지켰는가 — 차트 라이브러리를 도입하지 않았는가?**
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
4. 결과에 따라 `phases/4-dialectic-ui-polish/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (RiskRadar가 이제 무엇을 렌더링하는지 — figure 카드 여부와 캡션 문자열 포함)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **차트 라이브러리(recharts, chart.js, victory 등)를 설치하지 마라.** 이유: ADR-009가 명시적으로 기각한 결정이다. 번들이 커지고 기본 무지개 팔레트가 "색은 데이터 의미에만" 원칙과 충돌해 오버라이드 비용이 크다. 이 step은 배치 문제이지 차트 엔진 문제가 아니다.
- **`web/src/lib/radar.ts`와 `web/src/lib/risk.ts`를 수정하지 마라.** 이유: 좌표 기하와 점수 파생은 정확히 동작하고 있고 순수 함수 테스트가 걸려 있다. 치우침의 원인은 SVG 내부 좌표가 아니라 **바깥 컨테이너의 정렬**이다. 좌표를 건드리면 `radar.test.ts`의 결정적 출력 단언이 깨진다.
- **`DialecticSplit.tsx`를 수정하지 마라.** 이유: step 4가 담당한다. 특히 RiskRadar를 축 행(`data-axis-row`) **안으로 옮기지 마라** — `dialectic.test.tsx`가 "`data-axis-row="bm"` 하위의 모든 `[data-axis]`는 axis가 bm이어야 한다"고 단언하는데, 레이더의 축 라벨 `<text data-axis>` 3개가 그 안에 들어가면 즉시 깨진다. 레이더는 리드 행에 남아야 한다.
- **SVG에 애니메이션·트랜지션을 넣지 마라.** 이유: UI_GUIDE가 정적 SVG를 요구한다(좌표 애니메이션 금지).
- **아이콘 컨테이너(둥근 배경 박스)로 감싸지 마라.** 이유: UI_GUIDE 아이콘 규칙.
- 기존 테스트를 깨뜨리지 마라.
