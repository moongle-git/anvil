# Step 7: report-criticism-solution

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` ("Phase 1-web-ui" → "리포트 뷰" 5~7항 — 이 step의 스펙이다)
- `/docs/UI_GUIDE.md` (severity 뱃지 색, 콜아웃 배경, 본문 폭)
- `/CLAUDE.md`
- `src/types/criticism.ts`, `src/types/solution.ts` (렌더링할 데이터 구조)
- `web/src/components/report/` (step 6 산출물 — ReportView 골격, 교체할 스텁)
- `web/src/components/ui/` (step 3 — SeverityBadge, Collapsible), `web/src/test/fixtures/` (step 2)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

리포트 뷰의 나머지 섹션(② 냉정한 비판, ③ AI 네이티브 재설계, ④ 비즈니스 모델)을 TDD로 작성해 step 6의 스텁을 교체한다.

1. **장문 텍스트 렌더 유틸** `web/src/lib/richText.tsx` (TDD 먼저)
   - 에이전트 산출물 텍스트에는 개행과 `**볼드**` 마크가 섞여 있다 (예: solution.revisedConcept의 "**Fatal BM Weakness 비판**").
   - `renderRichText(text: string): ReactNode` — 빈 줄(`\n\n`) 또는 단일 개행 기준 문단(`<p>`) 분리 + `**…**` → `<strong>` 변환. **그 외 마크다운 문법은 처리하지 마라** — 일반 텍스트로 둔다.

2. **CriticismSection** (#criticism)
   - 3축 서브섹션, 순서·한국어 제목 고정: painPointReality → "페인포인트의 허구성", bmWeakness → "수익 모델(BM)의 취약성", copycatRisk → "카피캣 리스크".
   - 각 CriticismPoint = 카드: SeverityBadge + claim(카드 제목, 강조 타이포) + evidence는 Collapsible **기본 접힘**(summary: "근거 보기"). 이유: 주장을 먼저 훑고 근거는 필요할 때 펼치는 스캔 동선(PRD).
   - 마지막에 **VerdictCallout**: verdict 전문을 강조 콜아웃(bg-neutral-50 + 좌측 보더, "최종 판정" 라벨)으로.
   - criticism 부재 시 EmptyState.

3. **SolutionSection** (#solution)
   - **revisedConcept를 리드 블록으로 먼저, 크게**: 테두리 강조 카드 + "재설계된 컨셉" 라벨. 이유: 처방의 결론이 먼저다(역피라미드).
   - 이어서 서브섹션 3개, 순서 고정: minimalInput → "① 데이터 수집 및 최소 입력 구조", agenticWorkflow → "② 에이전틱 워크플로우", dataFlywheel → "③ 독점적 데이터 플라이휠" (PRD 리포트 규격의 제목과 일치).
   - solution 부재 시 EmptyState.

4. **MonetizationSection** (#monetization): "지속 가능한 비즈니스 모델" — monetization 본문.

모든 장문 본문은 renderRichText로 렌더링하고 `max-w-3xl` 폭을 유지하라.

테스트(@testing-library/react, fixture 데이터): renderRichText(문단 분리·볼드 변환·볼드 미종결 등 엣지), severity별 카드 렌더링, evidence 기본 접힘, verdict 콜아웃, revisedConcept가 서브섹션보다 먼저 렌더링되는 순서.

## Acceptance Criteria

```bash
npm run build
npm test        # richText 유틸, 비판/재설계/BM 섹션 테스트 통과
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - PRD 리포트 뷰 5~7항의 요소가 모두 있는가? 스텁이 남아있지 않은가?
   - SectionNav 앵커(#criticism/#solution/#monetization)가 실제 섹션과 연결되는가?
   - UI_GUIDE 안티패턴이 없는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 마크다운 파서 라이브러리를 설치하지 마라. 이유: 필요한 변환은 문단 분리와 볼드뿐이다 — renderRichText로 충분하며 의존성을 최소화한다.
- 비판·솔루션 텍스트를 요약·가공하지 마라. 이유: 에이전트 산출물 원문이 리포트의 콘텐츠다. 표시 형식만 다듬는다.
- 섹션 순서(비판 → 재설계 → BM)를 바꾸지 마라. 이유: PRD가 정한 리포트 내러티브다.
- 홈·진행 뷰·비교 뷰를 수정하지 마라. 이유: 다른 step의 scope다.
- 기존 테스트를 깨뜨리지 마라
