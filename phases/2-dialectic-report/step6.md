# Step 6: risk-radar

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
- `/docs/UI_GUIDE.md` — 특히 `RiskRadar`·`RiskScoreBadge` 규격, AI 슬롭 안티패턴, 색상표, 애니메이션 규칙
- `/docs/ADR.md` — ADR-009(외부 차트 라이브러리 없이 인라인 SVG)
- `/web/src/lib/risk.ts` — `RiskAxisScore`, `buildRiskProfile` (step 5 산출물)
- `/web/src/components/ui/` 전체 — 특히 `Badge.tsx`, `SeverityBadge.tsx`, `index.ts` 배럴
- `/web/src/test/components/ui.test.tsx` — 이 프로젝트의 컴포넌트 테스트 철학

## 배경

리스크 지표가 텍스트에 묻히지 않게 한다. 위험도 점수(0~100)와 리스크 키워드를 분리해 뱃지로 보여주고,
축별 점수는 레이더 차트로 시각화한다.

ADR-009에 따라 **외부 차트 라이브러리를 도입하지 않는다.** 3축 레이더는 좌표 계산이 단순하고,
recharts의 기본 테마는 UI_GUIDE의 무채색 문서 톤과 충돌한다.

이 step은 **프리미티브 두 개만** 만든다. 이것들을 어디에 배치할지는 step 7(`DialecticSplit`)과
step 9(`VerdictSection`)가 정한다.

## 작업

### 1. `web/src/lib/radar.ts` (신설) — 순수 기하 함수

SVG 좌표 계산을 컴포넌트에서 분리한다. 이유: 좌표는 테스트 가능한 수학이고, JSX는 아니다.

```ts
export interface Point2D { x: number; y: number; }

/**
 * n각형 레이더의 꼭짓점 좌표. 첫 축은 12시 방향(-90°)에서 시작해 시계방향으로 돈다.
 * @param values 0~100 점수 배열
 * @param size   SVG viewBox 한 변의 길이
 * @param maxValue 척도의 최댓값 (기본 100)
 */
export function radarVertices(values: readonly number[], size: number, maxValue?: number): Point2D[];

/** SVG polygon의 points 속성 문자열 ("x1,y1 x2,y2 …") */
export function toPolygonPoints(vertices: readonly Point2D[]): string;

/** 축 라벨을 놓을 바깥쪽 좌표 (반지름 * labelOffset) */
export function axisLabelPositions(count: number, size: number): Point2D[];
```

규칙:
- 중심은 `(size/2, size/2)`, 최대 반지름은 `size/2` 에서 라벨 여백을 뺀 값이다.
- `values`가 비어 있으면 빈 배열을 반환한다(throw 금지).
- `values`의 원소가 0이면 중심점 좌표를 반환한다. 음수나 `maxValue` 초과는 클램프한다.
- 부동소수점 좌표는 소수점 2자리로 반올림해 SVG 출력이 결정적이게 하라(스냅샷·단언 안정성).

### 2. `web/src/components/report/RiskRadar.tsx` (신설)

```tsx
interface RiskRadarProps {
  profile: RiskAxisScore[];       // buildRiskProfile()의 결과
  maxSeverity: CriticismSeverity; // 폴리곤 색을 결정한다
  size?: number;                  // 기본 200
}
export function RiskRadar({ profile, maxSeverity, size }: RiskRadarProps): JSX.Element;
```

UI_GUIDE가 정한 규격을 그대로 지켜라:
- 격자(동심 다각형 3겹)와 축선은 `neutral-200`.
- 데이터 폴리곤: stroke는 `maxSeverity`의 severity 색(fatal red-600 / major amber-600 / minor gray-500),
  fill은 같은 색 opacity `0.08`.
- 축 라벨: `text-xs`, `neutral-500`. 라벨 텍스트는 `RiskAxisScore.label`을 쓴다.
- **애니메이션·트랜지션 금지.** 정적 SVG다.
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.
- 새 색상 hex를 도입하지 마라. 기존 severity 색만 재사용한다.

접근성:
- `<svg role="img">`에 `aria-label`로 "리스크 레이더 — {축: 점수} 요약"을 제공한다.
- 시각장애 사용자를 위해 축·점수를 담은 시각적 숨김(`sr-only`) 텍스트 목록을 함께 렌더링하라.
  차트는 장식이 아니라 데이터다.

테스트 훅: 각 축 폴리곤/라벨에 `data-axis={axis}`를, 루트에 `data-max-severity={maxSeverity}`를 단다.

### 3. `web/src/components/report/RiskScoreBadge.tsx` (신설)

```tsx
interface RiskScoreBadgeProps {
  severity: CriticismSeverity;
  score: number;      // 0~100
  keyword: string;
}
export function RiskScoreBadge({ severity, score, keyword }: RiskScoreBadgeProps): JSX.Element;
```

- 기존 `SeverityBadge`를 **재사용**해 severity 라벨을 렌더링한다. 뱃지를 새로 만들지 마라.
- 점수는 `tabular-nums`로 `{score}/100` 형태.
- 키워드는 뱃지 **바깥**에 `text-xs text-neutral-500`으로 분리 노출한다.
  (사용자 요구: "위험도 점수와 키워드를 분리해서 제공")
- 테스트 훅: `data-risk-score={score}`, `data-risk-keyword={keyword}`.

### 4. `web/src/components/ui/index.ts`

`RiskRadar`·`RiskScoreBadge`는 `components/report/`에 두고 **`ui/` 배럴에 추가하지 마라.**
이유: `ui/`는 도메인 중립 프리미티브다. 이 둘은 리포트 도메인(리스크)에 묶여 있다.

## 테스트 (TDD — 먼저 작성한다)

### `web/src/test/lib/radar.test.ts` (신설)

- `radarVertices([100, 100, 100], 200)`의 첫 꼭짓점이 12시 방향(중심 바로 위)이다.
- `radarVertices([0, 0, 0], 200)`의 모든 꼭짓점이 중심과 같다.
- 음수·120 같은 범위 밖 값이 0·100으로 클램프된다.
- 빈 배열은 빈 배열을 반환하고 throw하지 않는다.
- `toPolygonPoints`가 `"x,y x,y x,y"` 형태의 문자열을 만든다.
- 같은 입력에 대해 항상 같은 문자열이 나온다(결정성).

### `web/src/test/components/risk.test.tsx` (신설)

Tailwind 클래스 문자열을 단언하지 마라. **계약·동작·접근성·`data-*` 훅**으로 검증한다:

- `RiskRadar`가 `profile`의 축 개수만큼 `data-axis` 요소를 렌더링한다.
- `data-max-severity`가 prop과 일치한다.
- `role="img"`와 `aria-label`이 존재하고, 라벨에 축 이름이 포함된다.
- `sr-only` 목록에 세 축의 점수가 모두 텍스트로 존재한다(스크린리더 접근성).
- `profile`의 모든 점수가 0이어도 throw하지 않고 렌더링된다.
- `RiskScoreBadge`가 severity 한국어 라벨(`SEVERITY_LABELS`)과 `{score}/100`, `keyword`를
  모두 노출한다.
- `data-risk-score`·`data-risk-keyword`가 prop과 일치한다.
- severity 3종 모두에 대해 렌더링이 성공한다(exhaustive).

## Acceptance Criteria

```bash
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. UI_GUIDE 체크리스트를 확인한다:
   - 새 색상 hex를 도입하지 않았는가? (기존 severity 색만)
   - `backdrop-filter`, gradient, glow, 애니메이션이 없는가?
   - 아이콘/차트를 둥근 배경 컨테이너로 감싸지 않았는가?
   - 차트 라이브러리를 `package.json`에 추가하지 않았는가? (ADR-009)
3. 아키텍처 체크리스트를 확인한다:
   - `radar.ts`가 순수 함수만 담고 React를 import하지 않는가?
   - 타입을 `@anvil/types`에서 가져오는가?
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (컴포넌트 props 시그니처를 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `recharts`·`chart.js`·`d3` 등 어떤 차트 라이브러리도 설치하지 마라. 이유: ADR-009가 명시적으로
  기각했다. 번들 증가와 기본 테마 충돌이 이유다.
- 레이더에 트랜지션·호버 애니메이션을 넣지 마라. 이유: UI_GUIDE 애니메이션 규칙이 fade-in과
  진행 스피너만 허용한다. 차트 애니메이션은 AI 슬롭의 징후다.
- 새 색상 hex를 만들지 마라. 이유: UI_GUIDE 원칙 3 — 색은 데이터의 의미에만 쓴다.
  레이더 색은 최고 severity 하나로 결정된다.
- 차트를 `role="img"`와 대체 텍스트 없이 내보내지 마라. 이유: 레이더는 장식이 아니라 데이터다.
  스크린리더에서 정보가 사라지면 안 된다.
- `RiskRadar`·`RiskScoreBadge`를 `web/src/components/ui/index.ts` 배럴에 추가하지 마라.
  이유: `ui/`는 도메인 중립 프리미티브 계층이다.
- 이 step에서 `ReportView`·`CriticismSection`·`DialecticSplit`을 수정하지 마라.
  이유: 배치는 step 7·9·10의 범위다. 여기서는 프리미티브만 만든다.
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다.
- 기존 테스트를 깨뜨리지 마라.
