# Step 11: compare-view

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/web/CLAUDE.md` 와 `/web/AGENTS.md` — **이 Next.js는 학습 데이터의 Next.js가 아니다.**
- `/docs/PRD.md` — 비교 뷰(`/compare?a=&b=`) 스펙, 5단계 서사
- `/docs/UI_GUIDE.md` — 색상표, 뱃지 규격
- `/docs/ADR.md` — ADR-010(verdict 분리), ADR-011(평탄화)
- `/src/types/verdict.ts` — `Verdict`, `RECOMMENDATION_LABELS`
- `/web/src/components/compare/CompareMatrix.tsx` — 현재 구현
- `/web/src/components/compare/CompareGuard.tsx`, `CompareClient.tsx`, `CompareLoader.tsx`, `ComparePage.tsx`
- `/web/src/lib/server/runs.ts` — `RunDetail`(`verdict` 포함)
- `/web/src/lib/severity.ts` — `countSeverities`
- `/web/src/lib/risk.ts` — `buildRiskProfile` (step 5)
- `/web/src/components/report/SurvivalGauge.tsx` (step 9)
- `/web/src/test/components/compare.test.tsx`

## 배경

phase의 마지막 step이다. 비교 뷰가 아직 옛 모델을 쓴다.

현재 `CompareMatrix`의 "최종 판정" 행은 `criticism.verdict`를 렌더링한다. 그건 **反 에이전트의
소결론**이지 최종 판정이 아니다(ADR-010). 두 아이디어를 비교하는 사용자에게 가장 중요한 축은
**생존 점수(`survivalScore`)와 판정(`recommendation`)**이다.

## 작업

### `web/src/components/compare/CompareMatrix.tsx` (갱신)

`ROWS` 배열을 5단계 서사와 새 데이터 모델에 맞게 재정의한다. 순서는 위에서 아래로
"결론 → 근거"가 아니라 **비교 효용 순서**다. 비교 뷰는 리포트가 아니므로 ADR-008의 결론 후치
규칙이 적용되지 않는다 — 이미 두 리포트를 다 읽은 사용자가 오는 화면이다. 이 점을 코드 주석으로
남겨 다음 세션이 혼동하지 않게 하라.

새 행 구성:

| key | label | 렌더링 |
|-----|-------|--------|
| `survival` | 생존 점수 | `SurvivalGauge`(score + recommendation). `verdict` 없으면 `—` |
| `recommendation` | 판정 | `RECOMMENDATION_LABELS[recommendation]` 뱃지 |
| `headline` | 한 줄 결론 | `verdict.headline` |
| `severity` | 리스크 집계 | 기존 `countSeverities` 기반 severity 뱃지 3종 |
| `risk` | 축별 최고 위험도 | `buildRiskProfile(criticism)`의 세 축을 `{label} {score}/100 · {keyword}`로 |
| `concept` | 재설계된 컨셉 | `solution.revisedConcept` |
| `monetization` | 비즈니스 모델 | `solution.monetization` |

규칙:

- `criticism.verdict`를 "최종 판정" 행으로 쓰지 마라. 최종 판정의 유일한 출처는 `verdict.json`이다.
  (`criticism.verdict`를 "反의 소결론" 행으로 추가하고 싶다면 해도 좋으나, 라벨을 정확히 붙여라.)
- 각 셀은 `verdict`/`criticism`/`solution`이 `undefined`일 때 기존 `<Dash />`를 렌더링한다.
  구버전 run(스키마 검증 실패로 필드 생략)이 비교에 들어와도 throw하지 않아야 한다.
- 두 run이 **모두** `verdict`를 갖지 않으면 `survival`·`recommendation`·`headline` 행 자체를
  생략하는 것이 낫다(빈 행 3개는 노이즈다). 판단은 에이전트에게 맡기되, 어느 쪽이든 테스트로 고정하라.
- 기존 레이아웃(컬럼 헤더 = 실행 정보, 모바일 세로 스택, 행마다 두 셀 나란히)은 유지한다.
- `RECOMMENDATION_LABELS`는 `@anvil/types`에서 import한다. web에서 새로 정의하지 마라.
- `SurvivalGauge`를 재사용하라. 비교용 게이지를 새로 만들지 마라.

`CompareGuard`의 "미완료 run이 포함되면 안내 후 차단" 동작은 그대로 둔다.

## 테스트 (TDD — 먼저 작성한다)

`web/src/test/components/compare.test.tsx` 갱신. **계약·동작·접근성·`data-*` 훅**으로 검증하라:

- 두 run의 `survivalScore`가 각각 `data-survival-score`로 노출된다.
- `recommendation` 한국어 라벨이 노출된다(3종 exhaustive).
- `verdict.headline`이 렌더링되고, `criticism.verdict`가 "최종 판정" 라벨로 렌더링되지 **않는다**.
- `buildRiskProfile`의 세 축 라벨·점수·키워드가 모두 노출된다.
- 한쪽 run에 `verdict`가 없으면 그 셀에 `—`가 보이고 throw하지 않는다.
- 두 run 모두 `verdict`가 없을 때의 동작이 명세대로다(행 생략 또는 `—` — 구현에 맞춰 고정).
- 한쪽 run이 완전 구버전(모든 산출물 `undefined`)이어도 페이지가 렌더링된다.
- 행 순서가 정의된 `ROWS` 순서와 일치한다.
- 모바일 식별 라벨(각 셀 위의 run 아이디어 truncate)이 유지된다(기존 동작 회귀 방지).

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
```

이 step은 phase의 마지막이므로 `lint`까지 통과해야 한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `npm run web`으로 개발 서버를 띄우고 완료된 fixture run 2개를 `/compare?a=&b=`로 비교해
   생존 점수와 판정이 나란히 보이는지 확인한다. 확인 후 서버를 종료한다.
3. 전체 phase 통합 확인 (이 step이 마지막이다):
   - 리포트 뷰의 섹션 순서가 `시장 맥락 → 正 → 反 → 合 → 최종 판정`인가?
   - 리포트 상단에 결론 스포일러가 없는가? (ADR-008)
   - `report.md`의 섹션 순서도 동일한가? (`src/lib/report.ts`)
   - 원시 데이터(경쟁사·댓글·출처)가 아코디언 안에 있는가?
   - 리스크 점수·키워드가 뱃지로 분리 노출되고 레이더가 렌더링되는가?
   - `package.json`에 차트 라이브러리가 추가되지 않았는가? (ADR-009)
4. 아키텍처 체크리스트를 확인한다:
   - web이 외부 API를 직접 호출하지 않는가?
   - 타입·스키마가 `src/types` 단일 소스에서 오는가? (ADR-005/006)
   - CLAUDE.md CRITICAL 규칙(services 격리, zod 검증, mock 테스트, state.json 단일 진실 공급원)을
     하나도 위반하지 않았는가?
5. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 11을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `criticism.verdict`를 "최종 판정" 라벨로 렌더링하지 마라. 이유: 그건 反의 소결론이다.
  최종 판정은 `verdict.json`에서만 온다(ADR-010). 이름이 같다고 같은 것이 아니다.
- 비교 뷰에 ADR-008의 결론 후치를 적용하지 마라. 이유: 비교 뷰는 논증을 전개하는 화면이 아니라
  이미 읽은 두 리포트를 나란히 놓는 화면이다. 여기서는 생존 점수가 맨 위에 와야 유용하다.
  **다만 이 예외의 근거를 코드 주석에 남겨라** — 다음 세션이 ADR-008 위반으로 오해한다.
- 비교용 게이지·뱃지를 새로 만들지 마라. 이유: `SurvivalGauge`·`SeverityBadge`·`Badge`가 이미 있다.
  중복 구현은 UI_GUIDE 규격이 두 곳에서 갈라지는 원인이다.
- 구버전 run이 비교에 들어왔을 때 throw하지 마라. 이유: `loadStepOutput`이 검증 실패 시 `null`을
  반환하므로 필드가 없는 `RunDetail`이 정상적으로 도착한다(ADR-011).
- `CompareGuard`의 미완료 run 차단 로직을 제거하지 마라. 이유: PRD 스펙이다.
- `RECOMMENDATION_LABELS`를 web에서 새로 정의하지 마라. 이유: `src/types`가 단일 소스다(ADR-006).
- 리포트 뷰(`ReportView`·섹션 컴포넌트)를 수정하지 마라. 이유: step 7~10이 확정했다.
- Tailwind 클래스 문자열을 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다.
- 기존 테스트를 깨뜨리지 마라.
