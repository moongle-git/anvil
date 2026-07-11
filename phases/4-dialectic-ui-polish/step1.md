# Step 1: richtext-ordered-list

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — 특히 `## 타이포그래피`의 번호 목록 규격 (직전 step 0에서 갱신됨)
- `/docs/ARCHITECTURE.md`
- `web/src/lib/richText.tsx` — **이 step에서 수정할 유일한 파일**
- `web/src/lib/richTextParser.ts` — **읽되 수정하지 마라** (계약 이해용)
- `web/src/test/lib/richText.test.tsx` — 반드시 정독하라. 여기 걸린 단언이 구현을 강하게 제약한다
- `web/src/test/lib/richTextParser.test.ts`
- `web/src/test/richTextFixtures.ts` — 실제 에이전트 산출물이 어떻게 생겼는지 확인

## 배경

`合` 섹션 등 장문 필드의 번호 목록이 읽기 어렵다. 에이전트 산출물은 `1. **최소 입력 구조:** 사용자는 앱을 열고…` 꼴인데, 현재 `richText.tsx`의 `renderItems`가

```tsx
<li key={index}>{renderTokens(item.spans)}</li>
```

로 렌더링해서 **볼드 라벨과 본문이 한 흐름에 이어붙는다.** 결과적으로 1·2·3 번호가 있어도 각 항목이 통짜 문단이라 스캔이 안 된다.

목표 렌더링:

```
1. 최소 입력 구조
   사용자는 앱을 열고 버튼 하나만 누른다. 나머지
   맥락은 캘린더·위치에서 자동 수집한다.

2. 에이전틱 워크플로우
   에이전트가 일정을 미리 읽고 초안을 만들어 둔다.
```

내어쓰기는 `list-decimal`의 기본 동작(`list-style-position: outside`)이 이미 처리하므로 별도 CSS가 필요 없다.

## 작업

`web/src/lib/richText.tsx`만 수정한다.

### 1. `renderItems`에 lead 분리 옵션 추가

`renderItems(items: ListItem[])`에 "첫머리 볼드 라벨을 별도 줄로 분리할지" 여부를 받는 두 번째 인자를 추가하고, **`orderedList` 블록에서만 `true`로 호출**하라.

분리 조건: `item.spans[0]?.type === "strong"`일 때만. 아니면 현행 인라인 렌더링으로 폴백한다 (방어적 분기 — 실제로는 파서의 `ORDERED_ITEM` 정규식이 `(?=\*\*)` lookahead를 써서 "ordered 항목 content는 항상 `**`로 시작"을 불변식으로 보장하므로 거의 항상 참이다).

분리 시 DOM 구조는 **정확히 다음이어야 한다**:

```tsx
<li>
  <strong className="block">라벨</strong>
  <div className="mt-1">본문 나머지 spans…</div>
  {children가 있으면 중첩 <ul>}
</li>
```

- `<strong>`은 반드시 `<li>`의 **직계 자식**이어야 한다. `<span>`이나 `<p>`로 감싸지 마라.
- 본문 래퍼는 반드시 `<div>`여야 한다. **`<p>`를 쓰지 마라.**
- 라벨(`spans[0]`)을 소비한 뒤 **나머지 spans만** 본문에 렌더링하라. 라벨이 두 번 나오면 안 된다.
- 본문이 비어 있으면(spans가 strong 하나뿐이면) 본문 `<div>`를 렌더링하지 마라.

두 DOM 제약(직계 `<strong>`, `<p>` 금지)은 임의의 취향이 아니라 **기존 테스트가 걸어둔 계약**이다:
- `web/src/test/lib/richText.test.tsx`가 `ol > li > strong` 개수를 3으로 단언한다 → `<span>`으로 감싸면 깨진다.
- 같은 파일이 `p` 개수를 0으로 단언한다 → 이건 "818자짜리 통짜 `<p>` 하나로 렌더링되던" 과거 회귀를 막는 방어선이므로 살려두는 게 옳다. 본문을 `<p>`로 감싸면 깨진다.

이 두 제약을 지키면 **테스트를 한 줄도 고치지 않고 전부 통과한다.**

### 2. `ORDERED` 상수의 항목 간격 확대

```
space-y-3  →  space-y-5
```

이유: 본문 줄간격이 1.8이라 `space-y-3`으로는 항목 경계가 안 보인다 (UI_GUIDE 번호 목록 규격).

`UNORDERED`·`NESTED`·`PROSE` 상수는 건드리지 마라.

### 3. 테스트 보강

`web/src/test/lib/richText.test.tsx`에 **새 테스트를 추가**하라 (기존 테스트는 수정하지 마라):
- 번호 목록의 각 `<li>`에서 볼드 라벨이 본문과 **다른 블록**에 있음을 검증한다. 클래스 문자열을 단언하지 말고, DOM 구조(`li > strong`이 존재하고 그 다음 형제 요소에 본문 텍스트가 있음)와 텍스트 내용으로 검증하라.
- 라벨이 본문에 중복 출력되지 않음을 검증한다.
- **불릿 목록에는 lead 분리가 적용되지 않음**을 검증한다 (항목 전체가 볼드인 최상위 불릿이 쪼개지지 않아야 한다).

## Acceptance Criteria

리포지토리 루트에서 실행:

```bash
npm run build -w web   # next build --webpack — 타입 체크 겸함, 에러 0
npm run test  -w web   # vitest run — 전부 통과
npm run lint  -w web   # eslint — 에러 0
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --stat`을 확인한다. **`web/src/lib/richText.tsx`와 `web/src/test/lib/richText.test.tsx` 두 파일만** 변경되어야 한다.
3. 아키텍처 체크리스트:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (마크다운 라이브러리를 새로 도입하지 않았는가)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
4. 결과에 따라 `phases/4-dialectic-ui-polish/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`web/src/lib/richTextParser.ts`를 수정하지 마라.** 이유: 라벨 분리는 순수하게 시각적 레이아웃 관심사다. `ListItem`에 `lead` 필드를 추가하면 프레젠테이션이 데이터 모델로 새고, `richTextParser.test.ts`의 4개 단언(`item.spans[0].type === "strong"` 등 — 파서의 핵심 계약 회귀선)이 무너진다. 파서는 "React 비의존"이 명시적 설계 목표다.
- **`renderInline`에 라벨 분리를 넣지 마라.** 이유: `richText.test.tsx`가 `renderInline` 결과에 `li > p`·`li > div`가 **없어야** 한다고 단언한다. `renderInline`은 이미 `<li>`/`<p>` 안에 있는 문자열용이라 블록 래퍼를 만들면 안 된다. 분리는 `renderItems` 안에서만 한다.
- **불릿 목록(unordered)에 라벨 분리를 적용하지 마라.** 이유: 실제 산출물의 최상위 불릿은 항목 **전체**가 볼드다(`*   **비판 1: '...' (Major)**`). 분리하면 본문 없는 라벨만 남아 무의미하고, 중첩 리스트에서 라벨을 또 한 줄 띄우면 세로 길이가 폭증한다.
- **기존 테스트의 단언을 수정·삭제하지 마라.** 이유: `ol > li > strong` = 3, `p` = 0은 과거 회귀를 막는 방어선이다. 이 단언이 깨진다면 구현이 틀린 것이지 테스트가 틀린 게 아니다.
- 클래스 문자열(`space-y-5` 등)을 직접 단언하는 테스트를 쓰지 마라. 이유: 이 프로젝트의 테스트는 Tailwind 클래스가 아니라 DOM 구조·역할·라벨·`data-*` 훅으로 검증한다. 리스타일에 견디는 테스트를 유지한다.
- 다른 컴포넌트(`VerdictSection` 등)의 번호 목록은 이 step에서 건드리지 마라. 이유: step 5에서 일괄 정리한다. 지금 손대면 커밋이 섞인다.
