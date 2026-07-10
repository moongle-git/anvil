# Step 5: web-data-layer

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
  코드를 쓰기 전에 `node_modules/next/dist/docs/`의 관련 가이드를 읽어라
- `/docs/ARCHITECTURE.md` — 웹 UI 데이터 흐름, 타입 단일 소스 규칙
- `/docs/ADR.md` — ADR-005/006(타입 공유), ADR-009(인라인 SVG), ADR-011(평탄화)
- `/docs/PRD.md` — 5단계 서사, 컴포넌트 매핑
- `/src/types/dialectic.ts`, `verdict.ts`, `criticism.ts`, `thesis.ts` — step 1 산출물
- `/web/src/lib/server/runs.ts` — `RunDetail`과 `getRunDetail`
- `/web/src/lib/severity.ts` — `countSeverities` (삭제된 필드를 참조해 **현재 컴파일이 깨져 있다**)
- `/web/src/lib/client/types.ts` — 중복 정의된 `RunDetail`
- `/web/src/components/report/CriticismSection.tsx` — 삭제된 필드를 참조해 **현재 컴파일이 깨져 있다**
- `/web/src/test/fixtures.ts` 와 `/web/src/test/fixtures/` — fixture run 4종
- `/web/src/test/lib/severity.test.ts`, `/web/src/test/server/runs.test.ts`

## 배경

step 1~4에서 `src/types`의 스키마가 바뀌었고, **`web` 워크스페이스는 지금 컴파일되지 않는다.**
`npm run build`와 `npm test`가 실패하는 상태다. 이 step의 첫 번째 임무는 **web을 다시 green으로
되돌리는 것**이다.

두 번째 임무는 UI 계층(step 6~11)이 쓸 **순수 데이터 함수**를 만드는 것이다. 레이더 차트의 축별
점수는 LLM에게 두 번 묻지 않는다(항목별 점수와 축별 점수가 어긋난다). `criticism.points`에서
**파생**한다 — 결정적이고 테스트하기 쉽다.

## 작업

### 1. `web/src/lib/risk.ts` (신설)

```ts
import type { Criticism, CriticismPoint, DialecticAxis } from "@anvil/types";

export interface RiskAxisScore {
  axis: DialecticAxis;
  label: string;     // DIALECTIC_AXIS_LABELS[axis]
  score: number;     // 해당 축 points의 riskScore 최댓값
  keyword: string;   // 그 최댓값을 낸 point의 riskKeyword
}

/** DIALECTIC_AXES 순서로 3개 원소를 항상 반환한다. 레이더 차트의 축 순서가 곧 이 순서다. */
export function buildRiskProfile(criticism: Criticism): RiskAxisScore[];

/** points를 axis별로 묶는다. 모든 축 키가 존재하며, 해당 축에 point가 없으면 빈 배열이다. */
export function groupPointsByAxis<T extends { axis: DialecticAxis }>(
  points: readonly T[],
): Record<DialecticAxis, T[]>;

/** rebuts → ThesisPoint 조회용 맵. 끊어진 참조는 단순히 조회 실패(undefined)가 된다. */
export function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T>;
```

`buildRiskProfile` 규칙:
- 축별 최댓값을 쓴다(평균이 아니다). 이유: 리스크는 최악의 항목이 지배한다. `fatal` 하나가
  `minor` 셋에 희석되면 레이더가 거짓말을 한다.
- 동점이면 배열에서 **먼저 나온** point의 `keyword`를 쓴다(결정적 동작).
- 해당 축에 point가 없으면 `score: 0`, `keyword: ""`. `CriticismSchema`의 refine이 이를 막지만,
  방어적으로 처리하라 — 이 함수는 구버전/손상 데이터를 만날 수 있다.

`groupPointsByAxis`는 `ThesisPoint[]`와 `CriticismPoint[]` 양쪽에 쓰이므로 제네릭이다.

### 2. `web/src/lib/severity.ts` (수정)

`countSeverities(criticism)`가 `criticism.points`를 순회하도록 고친다.
반환 타입 `SeverityCounts`는 그대로 둔다 — 호출부(`VerdictBanner`, `CompareMatrix`)가 의존한다.

### 3. `web/src/lib/server/runs.ts` (수정)

`RunDetail`에 `verdict?: Verdict`를 추가하고, `getRunDetail`이 `loadStepOutput(runId, "verdict",
VerdictSchema)`로 읽게 한다. 기존 패턴(값이 `null`이면 필드 자체를 생략하는 스프레드)을 그대로 따른다.

**`loadStepOutput`이 스키마 검증 실패 시 `null`을 반환하는 동작에 의존한다.** 구버전 run의
`criticism.json`은 새 스키마를 통과하지 못해 `criticism` 필드가 생략되고, UI는 빈 상태를 보여준다.
이건 의도된 하위호환 동작이다(ADR-011) — `throw`로 바꾸지 마라.

### 4. `web/src/lib/client/types.ts` (수정)

여기 있는 `RunDetail`은 `server/runs.ts`의 것과 **중복 정의**이며 `thesis`가 빠져 낡았다.
`thesis`와 `verdict`를 추가해 서버 쪽 정의와 일치시키고, `Thesis`·`Verdict`·`DialecticAxis`·
`CriticismPoint`·`ThesisPoint` 타입을 `@anvil/types`에서 re-export하라.
**web에서 zod 스키마나 타입을 새로 정의하지 마라** — `src/types`가 단일 소스다(ADR-005/006).

### 5. `web/src/components/report/CriticismSection.tsx` (기계적 수정)

`criticism.painPointReality` 등 3개 배열 참조를 `groupPointsByAxis(criticism.points)`로 바꾸고,
축 제목은 `DIALECTIC_AXIS_LABELS`에서 가져온다. `SeverityBadge` + `Collapsible` 구조는 유지한다.

**이 컴포넌트는 step 7에서 `DialecticSplit`으로 대체되어 삭제된다.** 여기서는 컴파일과 기존 테스트를
통과시키는 최소 변경만 하라. 디자인을 새로 하지 마라 — 버려질 코드다.

### 6. `web/src/test/fixtures/` (갱신)

fixture run 4종이 옛 스키마를 담고 있어 스키마 검증에 실패한다. 새 스키마로 갱신하라:

- `2026-07-01T09-00-00-000Z-ai-meeting-notes-fx01` (완료 run): `context.json`을 새 인사이트 필드
  4개를 포함하도록, `criticism.json`을 `points[] + axis + riskScore + riskKeyword`로 갱신.
  **`thesis.json`과 `verdict.json`을 새로 추가**하고, `state.json`의 steps에 `thesis`·`verdict`를 추가한다.
  `criticism.points`는 세 축을 모두 덮어야 하고, 최소 하나는 `rebuts`로 `thesis.points[].id`를 가리켜야 한다
  (step 7의 "반박 대상" 칩을 테스트하려면 필요하다). 끊어진 `rebuts`를 가진 point도 하나 넣어라 —
  UI가 이를 무시하는지 검증할 수 있어야 한다.
- 나머지 3종(진행중/실패/대기)도 `state.json`의 `steps`에 새 step 이름이 반영되게 갱신한다.

`state.json`의 `steps[].name`은 `PIPELINE_STEPS`와 일치해야 `RunStateSchema.parse`를 통과한다.

## 테스트 (TDD — 먼저 작성한다)

### `web/src/test/lib/risk.test.ts` (신설)

- `buildRiskProfile`이 항상 3개 원소를 `DIALECTIC_AXES` 순서로 반환한다.
- 한 축에 `riskScore` 30/90/50이 있으면 그 축의 `score`는 90이고 `keyword`는 90짜리 point의 것이다.
- 동점(80, 80)이면 먼저 나온 point의 `keyword`를 쓴다.
- 해당 축에 point가 없으면 `score: 0`, `keyword: ""`이고 throw하지 않는다.
- `groupPointsByAxis`가 세 축 키를 모두 갖고, 빈 축은 빈 배열이다.
- `indexById`로 조회한 존재하지 않는 id는 `undefined`다.

### `web/src/test/lib/severity.test.ts` (갱신)

`points[]` 기반으로 카운트가 맞는지 검증한다.

### `web/src/test/server/runs.test.ts` (갱신)

- 완료 fixture에서 `getRunDetail`이 `thesis`와 `verdict`를 포함해 반환한다.
- `criticism.json`이 **옛 스키마**(3개 배열)일 때 `criticism` 필드가 **생략**되고 throw하지 않는다.
  이 케이스를 위한 fixture를 하나 추가하라 — 구버전 run 하위호환의 회귀 방지 테스트다.

기존 테스트 철학을 지켜라: Tailwind 클래스 문자열이 아니라 **계약·동작·접근성·시맨틱 `data-*` 훅**으로
검증한다(step 3 `design-system`의 확립된 패턴).

## Acceptance Criteria

```bash
npm run build
npm test
```

**이 step부터 루트 커맨드가 다시 통과해야 한다.** step 1~4 동안 red였던 web이 여기서 green으로 돌아온다.
통과하지 않으면 이 step은 완료된 것이 아니다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - web이 외부 API(Gemini/YouTube)를 직접 호출하지 않는가? (파일 읽기와 CLI spawn만)
   - zod 스키마·타입을 `src/types`에서 import하는가? web에서 중복 정의하지 않았는가? (ADR-005/006)
   - `loadStepOutput`의 "검증 실패 시 null" 동작이 유지되는가? (구버전 run 하위호환)
   - `risk.ts`가 순수 함수만 담고 있는가? (React import 없음)
3. 구버전 run 하위호환을 수동 확인한다: 옛 스키마 `criticism.json`을 가진 fixture로
   `getRunDetail`이 throw하지 않고 `criticism` 없이 반환하는지.
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (`risk.ts`의 export 시그니처와
     fixture 경로를 요약에 포함하라 — step 6~11이 전부 이걸 쓴다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `web/`에서 zod 스키마나 도메인 타입을 새로 정의하지 마라. 이유: `src/types`가 단일 소스다(ADR-006).
  중복 정의는 두 곳이 어긋나는 순간 런타임에만 드러나는 버그가 된다.
- `buildRiskProfile`을 평균으로 계산하지 마라. 이유: `fatal` 하나가 `minor` 셋에 희석되면
  레이더가 실제보다 안전해 보인다. 리스크는 최악값이 지배한다.
- 축별 점수를 LLM에게 물어 스키마 필드로 받지 마라. 이유: 항목별 `riskScore`와 축별 점수가 어긋난
  데이터가 생긴다. 파생이 유일한 진실이어야 한다.
- `loadStepOutput`이 검증 실패 시 `throw`하도록 바꾸지 마라. 이유: 구버전 run 하나가 목록·상세를
  전부 죽인다. `null` 반환 + UI 빈 상태가 설계된 동작이다.
- `CriticismSection.tsx`를 새로 디자인하지 마라. 이유: step 7이 `DialecticSplit`으로 대체하고 삭제한다.
  여기서는 컴파일만 통과시켜라.
- `RiskRadar`나 `VerdictSection` 컴포넌트를 만들지 마라. 이유: step 6·9의 범위다.
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다. 계약·동작·접근성·
  `data-*` 훅으로 검증하라.
- 기존 테스트를 깨뜨리지 마라.
