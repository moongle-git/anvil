# Step 9: pivot-verdict

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
- `/docs/PRD.md` — 5단계 서사에서 4단계(合)가 "가장 중요한 섹션", 5단계(최종 판정)의 정의
- `/docs/UI_GUIDE.md` — `SurvivalGauge` 규격, 뱃지 규격, 색상표, 애니메이션 금지 규칙
- `/docs/ADR.md` — ADR-008(결론 후치), ADR-010(verdict 분리)
- `/src/types/verdict.ts` — `Verdict`, `RECOMMENDATION_LABELS`, `RECOMMENDATION_SCORE_BANDS`
- `/src/types/solution.ts` — `Solution`(`synthesis`는 optional)
- `/web/src/components/report/SolutionSection.tsx`, `MonetizationSection.tsx` — 현재 구현
- `/web/src/components/report/VerdictBanner.tsx` — **step 10에서 삭제된다. 지금은 건드리지 마라**
- `/web/src/components/report/RiskScoreBadge.tsx` (step 6)
- `/web/src/components/ui/` — `Badge`, `Card`, `SectionHeading`, `EmptyState`, `SeverityBadge`
- `/web/src/lib/richText.tsx`

## 배경

5단계 서사의 마지막 두 섹션을 만든다.

**4단계 合**은 이 리포트에서 가장 중요한 섹션이다. 단순 절충이 아니라 反의 비판을 방어·우회해
새로운 비즈니스 가치를 만드는 **피벗(Pivot) 전략**이다. 현재 `SolutionSection`은 `synthesis`를
작은 카드로 다루고 `monetization`은 별도 최상위 섹션(`MonetizationSection`)으로 떠 있다.

**5단계 최종 판정**은 지금 존재하지 않는다. 현재 화면의 "종합 판정"은 `criticism.verdict`,
즉 反 에이전트의 소결론이다. step 3이 만든 `verdict.json`을 렌더링하는 컴포넌트가 필요하다.

## 작업

### 1. `web/src/components/report/SolutionSection.tsx` (재작성)

```tsx
export function SolutionSection({ solution }: { solution?: Solution }): JSX.Element;
```

- 섹션 제목: `④ 인사이트 및 재설계 (合)`. 앵커 `id="solution"`.
- **`synthesis`를 섹션의 리드**로 올린다. 강조 테두리 카드(`border-neutral-900`)에 "정반합 통찰"
  라벨과 함께. `undefined`면 블록 자체를 생략한다(구 `solution.json` 하위호환).
- 그 다음 `revisedConcept`를 "재설계된 컨셉"으로 강조 렌더링한다.
- 하위 절: `① 최소 입력 구조` / `② 에이전틱 워크플로우` / `③ 독점적 데이터 플라이휠` /
  **`④ 지속 가능한 비즈니스 모델`(= `solution.monetization`)**.
- **`MonetizationSection.tsx`를 삭제하고 `monetization`을 이 섹션의 하위 절로 흡수한다.**
  이유: 5단계 서사에서 최상위 5번 섹션은 최종 판정 하나뿐이다. 수익화는 재설계의 일부다.
- 본문 폭 `max-w-3xl` 유지. 장문 텍스트는 `renderRichText`.
- `solution`이 `undefined`면 `EmptyState`.

### 2. `web/src/components/report/SurvivalGauge.tsx` (신설)

```tsx
interface SurvivalGaugeProps {
  score: number;                    // 0~100
  recommendation: Recommendation;
}
export function SurvivalGauge({ score, recommendation }: SurvivalGaugeProps): JSX.Element;
```

UI_GUIDE 규격:
- 트랙은 `neutral-200`, 값 부분은 **점수 밴드 색**: 0~39 red-600 / 40~69 amber-600 / 70~100 green-600.
  이 경계는 `RECOMMENDATION_SCORE_BANDS`와 일치한다 — **숫자를 하드코딩하지 말고 상수에서 파생하라.**
- 점수 숫자는 `tabular-nums`.
- **애니메이션·트랜지션 금지.** 정적 렌더링이다.
- 인라인 SVG 또는 단순 div 바 중 하나를 골라라(ADR-009: 차트 라이브러리 금지).
- 접근성: `role="meter"` + `aria-valuenow`/`aria-valuemin`/`aria-valuemax`/`aria-label`.
- 테스트 훅: `data-survival-score={score}`, `data-recommendation={recommendation}`.

### 3. `web/src/components/report/VerdictSection.tsx` (신설)

```tsx
export function VerdictSection({ verdict }: { verdict?: Verdict }): JSX.Element;
```

- 섹션 제목: `⑤ 최종 판정`. 앵커 `id="verdict"`.
- `headline`을 큰 글씨(페이지 제목보다 작고 섹션 제목보다 큰 급)로 먼저 노출한다.
- `SurvivalGauge`(score + recommendation)와 `RECOMMENDATION_LABELS[recommendation]` 뱃지.
  뱃지는 기존 `Badge` 프리미티브의 시맨틱 톤을 재사용하라(`proceed`→success, `pivot`→warning,
  `abandon`→danger). **새 색을 만들지 마라.**
- `rationale`을 본문으로(`renderRichText`, `max-w-3xl`).
- `### 잔존 리스크` — `residualRisks[]`를 `SeverityBadge` + `keyword` + `note`로 렌더링.
  `keyword`는 뱃지 옆에 분리 노출한다.
- `### 생존 조건` — `conditions[]`를 번호 목록(`list-decimal`)으로.
- `verdict`가 `undefined`면 `EmptyState` — 구버전 run에는 `verdict.json`이 없다.
  안내 문구에 "이 실행은 최종 판정 단계 이전에 생성되었습니다"류의 맥락을 담아라.

`RECOMMENDATION_LABELS`를 web에서 새로 정의하지 마라. `@anvil/types`에서 import한다.

## 테스트 (TDD — 먼저 작성한다)

`web/src/test/components/verdict.test.tsx` (신설) + `report.test.tsx`의 `SolutionSection` 갱신.
Tailwind 클래스가 아니라 **계약·동작·접근성·`data-*` 훅**으로 검증하라:

### SolutionSection
- `synthesis`가 `revisedConcept`보다 **앞에** 렌더링된다(DOM 순서 단언).
- `synthesis`가 `undefined`여도 throw하지 않고 나머지가 렌더링된다.
- `monetization`이 이 섹션 **안에** 있고, 별도 `<section>`으로 분리되지 않는다.
- `MonetizationSection` 파일이 더 이상 존재하지 않는다(import 참조가 남아 있지 않다).
- `solution`이 `undefined`면 `EmptyState`.

### SurvivalGauge
- `role="meter"`와 `aria-valuenow={score}`가 존재한다.
- 점수 0 / 39 / 40 / 69 / 70 / 100 각각에서 밴드 색 클래스가 아니라 **`data-recommendation`과
  점수 밴드 경계 동작**이 기대대로인지 검증하라(경계값 테스트).
- `score: 0`과 `score: 100`에서 throw하지 않는다.

### VerdictSection
- `headline`·`rationale`이 렌더링된다.
- `recommendation` 3종 모두에 대해 `RECOMMENDATION_LABELS`의 한국어 라벨이 노출된다(exhaustive).
- `residualRisks`의 각 `keyword`와 severity 한국어 라벨이 노출되고, `data-severity`가 붙는다.
- `conditions`가 번호 목록(`<ol>`)으로 렌더링된다.
- `verdict`가 `undefined`면 `EmptyState`가 보이고 throw하지 않는다.
- `id="verdict"` 앵커가 존재한다(step 10의 목차 네비가 가리킨다).
- 섹션이 `aria-labelledby`로 제목과 연결된다.

## Acceptance Criteria

```bash
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. UI_GUIDE 체크리스트를 확인한다:
   - 새 색상 hex를 도입하지 않았는가? (severity 색과 run 상태 색만 재사용)
   - 게이지에 애니메이션·트랜지션이 없는가?
   - 차트 라이브러리를 설치하지 않았는가? (ADR-009)
   - 본문 폭이 `max-w-3xl`인가?
3. 아키텍처 체크리스트를 확인한다:
   - `RECOMMENDATION_LABELS`·`RECOMMENDATION_SCORE_BANDS`를 `@anvil/types`에서 import하는가?
   - 밴드 경계 숫자(39/40/69/70)를 컴포넌트에 하드코딩하지 않았는가?
   - `MonetizationSection.tsx`가 삭제됐고 참조가 남아 있지 않은가?
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 9를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (앵커 id `solution`/`verdict`와
     삭제된 `MonetizationSection`을 명시하라 — step 10이 목차를 갱신한다)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `criticism.verdict`를 `VerdictSection`에 렌더링하지 마라. 이유: 그건 反 섹션의 소결론이고
  `DialecticSplit`이 이미 보여준다. 최종 판정의 유일한 출처는 `verdict.json`이다(ADR-010).
- 밴드 경계 숫자(39/40/69/70)를 컴포넌트에 하드코딩하지 마라. 이유: `RECOMMENDATION_SCORE_BANDS`가
  단일 소스다. 두 곳에 적으면 스키마 refine과 UI 색이 어긋난다.
- `SolutionSchema.synthesis`를 required로 가정하지 마라. 이유: optional이다. 구 `solution.json`에는 없다.
- `monetization`을 최상위 `<section>`으로 남기지 마라. 이유: 5단계 서사에서 5번 섹션은 최종 판정
  하나다. 수익화는 合의 하위 절이다.
- 게이지·뱃지에 애니메이션을 넣지 마라. 이유: UI_GUIDE 애니메이션 규칙(fade-in과 스피너만 허용).
- `VerdictBanner.tsx`를 삭제하거나 `ReportView.tsx`를 수정하지 마라. 이유: step 10의 범위다.
  이 step은 섹션 컴포넌트만 만든다.
- `RECOMMENDATION_LABELS`를 web에서 새로 정의하지 마라. 이유: `src/types`가 단일 소스다(ADR-006).
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다.
- 기존 테스트를 깨뜨리지 마라.
