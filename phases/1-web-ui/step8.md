# Step 8: compare-view

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` ("Phase 1-web-ui" → "비교 뷰" 섹션 — 이 step의 스펙이다)
- `/docs/UI_GUIDE.md`
- `/CLAUDE.md`
- `web/src/app/api/` (step 2 — RunDetail 계약), `web/src/lib/severity.ts` (step 6 — countSeverities)
- `web/src/lib/richText.tsx` (step 7), `web/src/components/ui/` (step 3), `web/src/test/fixtures/` (step 2)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

두 run 비교 화면(`web/src/app/compare/page.tsx`)을 TDD로 작성한다. 구성 요소는 `web/src/components/compare/` 하위에 둔다.

1. **입력**: 쿼리 파라미터 `?a={runId}&b={runId}`. 홈(step 4)의 "비교하기" 버튼이 이 형식으로 이동해 온다.

2. **가드**: 다음 경우 비교를 렌더링하지 말고 EmptyState 안내 + 홈 링크를 보여라:
   - a 또는 b 파라미터 누락 / a === b
   - 어느 한쪽 run이 존재하지 않음(404)
   - 어느 한쪽이 `completed`가 아님 → "완료된 run만 비교할 수 있습니다"

3. **비교 레이아웃**: 두 run을 컬럼으로, 항목을 행으로 정렬한 매트릭스. 행 순서 고정(PRD):
   1. 실행 정보 — 아이디어 제목(→ 각 리포트 링크), 실행 일시
   2. severity 집계 — countSeverities 재사용, SeverityBadge 스타일 카운트
   3. 최종 판정 — criticism.verdict
   4. 재설계된 컨셉 — solution.revisedConcept (renderRichText)
   5. 비즈니스 모델 — solution.monetization (renderRichText)
   - 데스크톱: 2컬럼 grid, 행 라벨이 왼쪽 또는 행 상단에 일관되게. 모바일: run별 세로 스택.
   - 같은 행의 두 셀이 시각적으로 정렬되어 나란히 읽히는 것이 이 화면의 목적이다 — 행 단위 정렬을 유지하라.

4. 두 run 데이터는 `GET /api/runs/{id}` 병렬 fetch로 가져와라.

테스트(@testing-library/react, fetch mock + fixture): 정상 비교 렌더링(행 순서), 미완료 run 차단, 파라미터 누락/동일 id 차단, 404 처리.

## Acceptance Criteria

```bash
npm run build
npm test        # 비교 뷰 테스트 통과 (정상/차단/404 시나리오)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - PRD 비교 뷰 스펙(행 순서, 미완료 차단)과 일치하는가?
   - step 6~7의 유틸(countSeverities, renderRichText)을 재사용했는가? (중복 구현 없음)
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 3개 이상 run 비교를 구현하지 마라. 이유: PRD 스펙은 2개 비교다. scope를 늘리지 않는다.
- 리포트 전체 섹션(시장 맥락 등)을 비교 뷰에 넣지 마라. 이유: PRD가 정한 5개 행만 — 비교는 요약 대조가 목적이다.
- diff·하이라이트 라이브러리를 설치하지 마라. 이유: 나란히 배치가 스펙의 전부이며 의존성을 최소화한다.
- 홈·리포트 뷰의 기존 동작을 수정하지 마라. 이유: 다른 step의 scope다 (비교 진입 링크는 step 4에 이미 있다).
- 기존 테스트를 깨뜨리지 마라
