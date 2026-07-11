# Step 2: card-accent

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — 특히 `## 컴포넌트`의 카드 규격과 정반합 카드(미러 액센트 레일) 규격, `## 색상`의 severity 팔레트
- `/docs/ADR.md`
- `web/src/components/ui/Card.tsx` — **이 step에서 수정할 주 파일**
- `web/src/components/ui/Badge.tsx` — **이 파일의 패턴을 그대로 따를 것.** tone(의미)만 받고 Tailwind 클래스는 파일 내부로 격리하며 `data-tone` 훅을 노출한다
- `web/src/components/ui/SeverityBadge.tsx` — severity → tone 매핑 참고
- `web/src/components/ui/index.ts` — 배럴 export
- `web/src/test/components/ui.test.tsx` — 기존 Card·Badge 테스트가 무엇을 검증하는지 확인

## 배경

리포트의 正/反 대립 뷰에서 좌우 카드의 골격을 완전히 통일하고, "주장이 서로 반대"라는 것을 **액센트 레일의 방향**으로만 표현하기로 했다(UI_GUIDE 정반합 카드 규격):

- 正 = **왼쪽** 레일 2px, 무채색(`neutral-900`)
- 反 = **오른쪽** 레일 2px, 해당 항목의 severity 색

두 레일이 가운데 거터를 사이에 두고 마주 보며 정면 대치를 만든다.

지금은 `Card`가 레일을 지원하지 않아서, 호출부가 `className`으로 Tailwind 클래스를 직접 욱여넣거나 아예 카드를 안 쓰고 `<div>`로 골격을 손수 재현하고 있다. 이 step은 `Card`에 액센트 레일을 **1급 기능**으로 넣어 이후 step 3·4·5가 호출부에서 클래스 문자열을 조립하지 않게 만든다.

## 작업

### 1. `Card`에 optional `accent` prop 추가

`web/src/components/ui/Card.tsx`:

```tsx
type AccentSide = "left" | "right";
type AccentTone = /* 무채색 강조 + severity 3종을 표현할 수 있는 시맨틱 톤 */;

interface CardAccent {
  side: AccentSide;
  tone: AccentTone;
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: CardAccent;
  children: React.ReactNode;
}
```

핵심 규칙:

- **`accent`를 넘기지 않으면 렌더링 결과가 지금과 완전히 동일해야 한다.** 클래스 문자열이 바이트 단위로 같아야 하고, `data-accent-*` 속성도 붙으면 안 된다. 이유: `Card`는 홈·진행·비교 화면 등 리포트 밖에서도 쓰인다. 기본값이 바뀌면 관계없는 화면에 시각 회귀가 난다.
- **Tailwind 클래스는 `Card.tsx` 내부 구현으로 격리하라.** 호출부는 의미(side/tone)만 넘긴다. `Badge.tsx`가 `BadgeTone`을 색 클래스로 변환하는 방식을 그대로 따르라. 호출부에서 `border-l-2 border-l-red-600` 같은 문자열을 조립하게 두면 안 된다 — 그러면 이 prop을 만든 의미가 없다.
- **`data-accent-side`와 `data-accent-tone` 속성을 노출하라.** 테스트는 Tailwind 클래스가 아니라 이 훅으로 검증한다.
- 톤은 UI_GUIDE severity 팔레트를 재사용한다: fatal → red-600, major → amber-600, minor → gray-500, 그리고 무채색 강조용 neutral-900. **새 hex를 만들지 마라.**

### 2. Tailwind v4에서 side-specific border를 쓸 때의 함정

`Card`의 기본 클래스는 `border border-neutral-200`이다. 여기에 레일을 얹으려면 **한 변의 두께와 색을 따로 지정**해야 한다:

- 두께: `border-l-2` / `border-r-2`
- 색: `border-l-*` / `border-r-*` (side-specific color)

`border-red-600`처럼 **전체 border 색**을 쓰면 4면이 전부 빨개진다. 반드시 side-specific 색 유틸리티를 써라. 구현 후 실제로 한 변만 강조되는지 확인하라 (step 5의 육안 검증에서 다시 본다).

또한 Tailwind는 클래스 **순서**로 우선순위가 정해지지 않는다(CSS 정의 순서로 정해진다). `className` prop으로 `p-5` 같은 값을 넘겨 기본 `p-6`을 덮어쓰려는 시도는 동작이 불안정하다. 호출부가 그렇게 하고 있다면 그건 버그다.

### 3. 배럴 export

`accent` 관련 타입(`CardAccent` 등)이 다른 컴포넌트에서 필요하면 `web/src/components/ui/index.ts`에서 export하라.

### 4. 테스트 추가

`web/src/test/components/ui.test.tsx`에 새 테스트를 추가하라 (기존 테스트는 수정하지 마라):

- `accent` 미지정 시 `data-accent-side`·`data-accent-tone`이 **없음**을 검증
- `accent={{ side: "left", tone: ... }}` 지정 시 `data-accent-side="left"`와 해당 `data-accent-tone`이 노출됨을 검증
- `side: "right"`도 마찬가지로 검증
- 기존 `className` passthrough와 `...rest` 스프레드(`aria-label` 등)가 여전히 동작함을 검증

**Tailwind 클래스 문자열을 단언하지 마라.** `ui.test.tsx`의 기존 테스트가 이미 "Tailwind 클래스가 아닌 tone 계약 검증"이라는 이름을 달고 있다. 그 규율을 따르라.

## Acceptance Criteria

리포지토리 루트에서 실행:

```bash
npm run build -w web   # next build --webpack — 타입 체크 겸함, 에러 0
npm run test  -w web   # vitest run — 전부 통과
npm run lint  -w web   # eslint — 에러 0
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --stat`을 확인한다. `web/src/components/ui/Card.tsx`, `web/src/components/ui/index.ts`, `web/src/test/components/ui.test.tsx` 정도만 변경되어야 한다.
3. **회귀 확인**: `Card`를 `accent` 없이 쓰는 기존 호출부(홈·진행·비교·리포트)의 렌더링이 바뀌지 않았는지 `git diff`로 `Card.tsx`의 기본 클래스 문자열이 그대로인지 눈으로 확인하라.
4. 아키텍처 체크리스트:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
5. 결과에 따라 `phases/4-dialectic-ui-polish/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (accent prop의 타입 시그니처와 노출한 data-* 훅 이름을 반드시 포함할 것 — step 3·4·5가 이걸 쓴다)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`ui/Callout.tsx` 같은 새 컨테이너 프리미티브를 만들지 마라.** 이유: 레일+배경 콜아웃 패턴은 코드베이스 전체에 2곳, 레일 인용 패턴도 2곳뿐이다. `Card` + `accent`로 콜아웃 2곳이 자연 흡수된다. 별도 Callout을 만들면 Card와 기능이 90% 겹치는 두 번째 컨테이너가 생겨 "어느 걸 써야 하나" 문제만 남는다.
- **`accent` 미지정 시의 기본 클래스를 바꾸지 마라.** 이유: `Card`는 리포트 밖 화면에서도 쓰인다. 시각 회귀가 난다.
- **호출부가 Tailwind 클래스를 조립하게 두지 마라.** 이유: `Badge`가 tone→클래스를 파일 내부로 격리한 것과 같은 이유다. 색 규격이 여러 파일에 흩어지면 UI_GUIDE 팔레트를 바꿀 때 전수조사를 해야 한다.
- **새 색상 hex를 도입하지 마라.** severity 팔레트(red-600 / amber-600 / gray-500)와 무채색만 쓴다. 보라·인디고는 UI_GUIDE 안티패턴 표의 금지 항목이다.
- 이 step에서 `DialecticSplit.tsx`·`RiskRadar.tsx` 등 호출부를 수정하지 마라. 이유: step 3·4가 담당한다. 지금 손대면 커밋이 섞이고, 이 step의 AC(회귀 없음)를 검증할 수 없다.
- 기존 테스트를 깨뜨리지 마라.
