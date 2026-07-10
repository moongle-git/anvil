# Step 7: dialectic-split

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
- `/docs/PRD.md` — 5단계 서사, Split View 규격
- `/docs/UI_GUIDE.md` — Split View의 `max-w-5xl` 예외, 타이포그래피, 색상 원칙
- `/docs/ADR.md` — ADR-011(평탄화의 이유)
- `/src/types/dialectic.ts`, `thesis.ts`, `criticism.ts`
- `/web/src/lib/risk.ts` — `groupPointsByAxis`, `buildRiskProfile`, `indexById` (step 5)
- `/web/src/components/report/RiskRadar.tsx`, `RiskScoreBadge.tsx` (step 6)
- `/web/src/components/report/ThesisSection.tsx` — **이 step에서 삭제된다**
- `/web/src/components/report/CriticismSection.tsx` — **이 step에서 삭제된다**
- `/web/src/components/ui/` — `Card`, `Collapsible`, `SectionHeading`, `EmptyState`, `Badge`
- `/web/src/lib/richText.tsx` — `renderRichText` / `renderInline` 사용 규칙
- `/web/src/test/components/report.test.tsx`

## 배경

리포트 2단계(正)와 3단계(反)는 **같은 세 축**(`painPoint` / `bm` / `copycat`) 위에서 정면으로 대립한다.
사용자가 양립하는 주장을 한눈에 비교할 수 있도록 좌우 분할로 렌더링한다.

지금은 `ThesisSection`과 `CriticismSection`이 따로 존재하며, 필드가 서로 대응하지 않아 대립이
데이터에 존재하지 않았다. step 1이 두 타입에 공통 `axis`를 부여했으므로 이제 행 단위 정렬이 가능하다.

**`renderRichText`를 쓰지 않고 산출물 문자열을 그대로 JSX에 넣으면 `**볼드**`가 화면에 노출된다.**
UI_GUIDE의 규칙을 지켜라: `<p>`나 `<li>` 안의 문자열에는 블록 래퍼가 없는 `renderInline`을 쓴다.

## 작업

### `web/src/components/report/DialecticSplit.tsx` (신설)

```tsx
interface DialecticSplitProps {
  thesis?: Thesis;
  criticism?: Criticism;
}
export function DialecticSplit({ thesis, criticism }: DialecticSplitProps): JSX.Element;
```

구조:

```
<section id="dialectic">                       ← max-w-5xl (UI_GUIDE 예외)
  ┌── 컬럼 헤더 ────────────────────────────┐
  │ <h2 id="thesis">② 낙관적 가설 (正)</h2> │ <h2 id="antithesis">③ 냉정한 비판 (反)</h2>
  └──────────────────────────────────────────┘
  ┌── 리드 행 ──────────────────────────────┐
  │ thesis.winningThesis                     │ criticism.verdict (反의 소결론)
  │                                          │ + RiskRadar(buildRiskProfile(criticism))
  └──────────────────────────────────────────┘
  ┌── 축 행 × 3 (DIALECTIC_AXES 순서) ──────┐
  │ 축 라벨: DIALECTIC_AXIS_LABELS[axis]     │  ← 두 컬럼에 걸친 소제목
  │ ThesisPoint 카드들        │ CriticismPoint 카드들
  └──────────────────────────────────────────┘
  ┌── 正의 서사 보강 (아코디언) ─────────────┐
  │ 수익 모델 / 성장 지렛대 / 시장 순풍 / 최상 시나리오
  └──────────────────────────────────────────┘
</section>
```

카드 규격:

- **ThesisPoint 카드**: `claim`을 제목(`text-base font-semibold`)으로, `rationale`은 `Collapsible`
  "근거 보기" 안에. `data-thesis-id={point.id}`, `data-axis={point.axis}`.
- **CriticismPoint 카드**: `RiskScoreBadge`(severity + score + keyword)를 상단에, `claim`을 제목으로,
  `evidence`는 `Collapsible` "근거 보기" 안에. `data-criticism-id={point.id}`, `data-axis={point.axis}`.
- `rebuts`가 **유효한** `ThesisPoint.id`를 가리키면, 비판 카드에 "이 낙관을 반박: {thesis claim}" 칩을
  붙인다. `indexById(thesis.points)`로 조회하라. **끊어진 참조(존재하지 않는 id)는 칩을 렌더링하지
  않고 조용히 넘어간다.** throw하지 마라 — 스키마가 교차 참조를 검증하지 않는다.
  `thesis`가 `undefined`일 때도 마찬가지다. 테스트 훅: `data-rebuts={point.rebuts}`.

레이아웃:

- 데스크톱(`lg:`): `grid grid-cols-2`. 같은 축의 正/反이 좌우로 나란히 정렬된다.
- 모바일: 세로 스택. 축 단위로 `正 카드들 → 反 카드들` 순서를 유지한다.
  각 카드 묶음 앞에 `正`/`反` 라벨 칩을 붙여 어느 쪽 주장인지 알 수 있게 하라
  (데스크톱에서는 컬럼 헤더가 그 역할을 하므로 `lg:hidden`).
- 섹션 폭은 `max-w-5xl`. UI_GUIDE에 명시된 Split View 전용 예외다.
  `max-w-3xl`로 두면 컬럼당 약 360px가 되어 한국어 본문 가독 폭에 못 미친다.

빈 상태:

- `thesis`가 `undefined`면 좌측 컬럼에 `EmptyState`, `criticism`이 `undefined`면 우측에 `EmptyState`.
  둘 다 없으면 섹션 전체를 `EmptyState` 하나로 대체한다.
  이유: 구버전 run은 스키마 검증에 실패해 필드가 생략된다(ADR-011).

`RiskRadar`의 `maxSeverity`는 `criticism.points`의 최고 severity(`fatal` > `major` > `minor`)로 계산한다.
이 계산이 `web/src/lib/risk.ts`에 없으면 거기에 순수 함수로 추가하고 테스트를 써라
(`maxSeverity(criticism): CriticismSeverity`).

### 삭제

`web/src/components/report/ThesisSection.tsx`와 `CriticismSection.tsx`를 삭제한다.
`ReportView.tsx`가 이 둘을 import하고 있으므로 **`DialecticSplit` 하나로 교체**해 컴파일을 통과시켜라.
`ReportView`의 전체 5단계 재배치는 **step 10의 일**이다. 여기서는 import 교체와 배치만 최소로 하고,
`VerdictBanner`는 아직 건드리지 마라.

기존 `web/src/test/components/report.test.tsx`에서 두 컴포넌트를 검증하던 테스트는
`DialecticSplit` 테스트로 이관한다.

## 테스트 (TDD — 먼저 작성한다)

`web/src/test/components/dialectic.test.tsx` (신설). Tailwind 클래스가 아니라 **계약·동작·접근성·
`data-*` 훅**으로 검증하라:

- 세 축이 `DIALECTIC_AXES` 순서로 렌더링된다(`data-axis` 요소의 순서 단언).
- 각 축 안에서 `ThesisPoint`와 `CriticismPoint`가 모두 자기 축의 것만 나온다
  (`data-axis="bm"` 블록 안에 `axis: "painPoint"` point가 없다).
- `rebuts`가 유효한 id를 가리키면 대응하는 `thesis.points[].claim` 텍스트가 그 비판 카드 안에 있다.
- **`rebuts`가 존재하지 않는 id("t999")를 가리켜도 throw하지 않고**, 반박 칩 없이 카드가 렌더링된다.
- `thesis`가 `undefined`여도 throw하지 않고, 우측(反)은 정상 렌더링되며 좌측에 빈 상태가 보인다.
- `criticism`이 `undefined`여도 마찬가지로 좌측만 렌더링된다.
- 비판 카드가 `RiskScoreBadge`의 `data-risk-score`·`data-risk-keyword`를 노출한다.
- `evidence`와 `rationale`이 기본으로 **접혀 있다**(`<details>`가 열려 있지 않음). 클릭하면 열린다.
- `**볼드**` 마크다운이 포함된 `claim`이 화면에 `**` 문자 그대로 노출되지 않는다
  (`renderInline`/`renderRichText` 사용 검증).
- `id="thesis"`와 `id="antithesis"` 앵커가 존재한다(step 10의 목차 네비가 이 앵커를 가리킨다).
- 컬럼 헤더가 `<h2>` 시맨틱을 갖고 `aria-labelledby` 연결이 유효하다.

## Acceptance Criteria

```bash
npm run build
npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. UI_GUIDE 체크리스트를 확인한다:
   - Split View 섹션만 `max-w-5xl`이고 나머지 리포트 본문은 `max-w-3xl`을 유지하는가?
   - 새 색상을 도입하지 않았는가? severity 색만 쓰는가?
   - `**` 같은 마크다운 원문이 화면에 노출되지 않는가?
   - 모든 카드에 동일한 `rounded-2xl`을 쓰지 않았는가? (AI 슬롭 안티패턴)
3. 아키텍처 체크리스트를 확인한다:
   - 타입을 `@anvil/types`에서 import하는가? web에서 중복 정의하지 않았는가?
   - 축 라벨이 `DIALECTIC_AXIS_LABELS` 상수에서만 오는가?
   - `ThesisSection.tsx`와 `CriticismSection.tsx`가 삭제됐고, 참조가 남아 있지 않은가?
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 7을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (앵커 id와 삭제된 파일을 명시하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 끊어진 `rebuts` 참조에 대해 throw하거나 에러 UI를 띄우지 마라. 이유: 스키마가 교차 참조를
  검증하지 않으므로 LLM이 존재하지 않는 id를 쓸 수 있다. 리포트 전체가 그 때문에 죽으면 안 된다.
- `thesis`나 `criticism`이 `undefined`일 때 throw하지 마라. 이유: 구버전 run은 스키마 검증에 실패해
  필드가 생략된 채 도착한다(ADR-011). 빈 상태로 처리한다.
- 좌우 정렬을 `rebuts`로 하지 마라. 이유: `rebuts`는 optional이고 1:N일 수 있다. 행 정렬의 기준은
  `axis`다. `rebuts`는 칩 하나를 붙이는 부가 정보다.
- `criticism.verdict`를 "최종 판정"이라고 부르지 마라. 이유: 그건 反 섹션의 소결론이다.
  최종 판정은 `verdict.json`이고 step 9의 `VerdictSection`이 렌더링한다(ADR-010).
- `VerdictBanner`를 삭제하거나 `ReportView`의 섹션 순서를 재배치하지 마라. 이유: step 10의 범위다.
  이 step은 `ThesisSection`/`CriticismSection` → `DialecticSplit` 교체까지만 한다.
- Split View 섹션을 `max-w-3xl`로 두지 마라. 이유: 컬럼당 약 360px로 좁아져 한국어 본문이 깨진다.
  UI_GUIDE에 이 예외가 명시돼 있다.
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다.
- 기존 테스트를 깨뜨리지 마라. 단, 삭제된 컴포넌트를 검증하던 테스트는 이관하라.
