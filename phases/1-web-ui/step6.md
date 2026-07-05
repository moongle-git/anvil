# Step 6: report-overview-context

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` ("Phase 1-web-ui" → "리포트 뷰" 섹션 — 이 step의 스펙이다. 역피라미드 원칙)
- `/docs/UI_GUIDE.md` (레이아웃 max-w-3xl 본문 폭, 인용 스타일, 목차 네비 규칙)
- `/CLAUDE.md`
- `src/types/marketContext.ts`, `src/types/criticism.ts` (렌더링할 데이터 구조)
- `web/src/components/report/ReportView.tsx` (step 5 산출물 — 교체할 placeholder)
- `web/src/components/ui/` (step 3), `web/src/test/fixtures/` (step 2 — 완료 run fixture)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

리포트 뷰의 골격과 "① 시장 맥락" 섹션을 TDD로 작성한다. step 5의 ReportView placeholder를 실제 구현으로 교체한다. 구성 요소는 `web/src/components/report/` 하위에 둔다.

1. **ReportView** (조립 컴포넌트) — RunDetail을 받아 아래를 순서대로 렌더링:
   - ReportHeader → VerdictBanner → SectionNav → 4개 섹션. 이 step에서는 ② 비판 / ③ 재설계 / ④ BM 섹션 자리에 임시 스텁(SectionHeading + "다음 step에서 구현")을 두고, step 7이 교체한다.

2. **ReportHeader**: 아이디어 제목(페이지 제목 타이포), 실행 일시, "report.md 다운로드" Secondary 버튼(`/api/runs/{id}/report`).

3. **VerdictBanner** — 역피라미드의 핵심. 스크롤 없이 결론이 보여야 한다:
   - criticism.verdict 전문 + severity 집계 뱃지(치명적 N · 중대 N · 경미 N).
   - 집계는 순수 함수로 분리하라: `countSeverities(criticism: Criticism): { fatal: number; major: number; minor: number }` (`web/src/lib/severity.ts`, 3축 배열 전체 합산, TDD).

4. **SectionNav**: 앵커 목차 — ① 시장 맥락(#market) ② 냉정한 비판(#criticism) ③ AI 네이티브 재설계(#solution) ④ 비즈니스 모델(#monetization). 데스크톱은 좌측 sticky, 모바일은 본문 위 가로 배치. SectionHeading의 id 앵커와 연결.

5. **MarketContextSection** (#market) — MarketContext를 렌더링:
   - **트렌드**: 불릿 리스트
   - **경쟁 서비스**: 테이블(이름/설명/가격힌트/링크). 가격힌트가 있으면 작은 뱃지, url이 있으면 새 탭 외부 링크(`rel="noopener noreferrer"`). **초기 8개 표시 + "N개 더보기" 버튼**으로 전체 확장.
   - **YouTube 실제 목소리**: 인용 카드 — 댓글 원문(UI_GUIDE 인용 스타일: 좌측 보더), 작성자, 좋아요 수, 영상 제목 링크(새 탭)
   - **페인포인트 근거**: 불릿 리스트
   - **출처**: Collapsible(기본 접힘)에 sources URL 목록. grounding redirect URL이라 길다 — 줄바꿈 잘림(truncate/break-all) 처리하라.
   - context가 없으면(RunDetail.context 부재) 섹션에 "데이터 없음" EmptyState.

핵심 규칙: 장문 본문은 `max-w-3xl` 문서 폭을 유지하라(UI_GUIDE). 리포트의 섹션 순서(근거→진단→처방→수익화)를 바꾸지 마라 — PRD가 정한 내러티브다.

테스트(@testing-library/react, fixture 데이터): countSeverities 집계, 경쟁사 테이블 더보기(8개→전체), YouTube 인용 카드 렌더링(링크·좋아요), context 부재 시 EmptyState.

## Acceptance Criteria

```bash
npm run build
npm test        # severity 집계, 시장 맥락 섹션 테스트 통과
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - PRD 리포트 뷰 스펙(헤더/배너/목차/① 섹션)의 요소가 모두 있는가?
   - VerdictBanner가 최상단(헤더 바로 아래)인가? (역피라미드)
   - UI_GUIDE 안티패턴이 없는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (남은 스텁 섹션 명시)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- ② 비판 / ③ 재설계 / ④ BM 섹션의 실제 내용을 구현하지 마라. 이유: step 7의 scope다. 스텁까지만.
- 마크다운 파서·차트 라이브러리를 설치하지 마라. 이유: 구조화 JSON을 직접 렌더링하는 것이 이 phase의 방식이며 의존성을 최소화한다.
- YouTube 영상을 임베드(iframe)하지 마라. 이유: PRD 제외 사항 — 링크만 제공한다.
- report.md를 파싱해 렌더링하지 마라. 이유: 데이터 소스는 구조화 JSON이다(다운로드 링크만 md 사용).
- 기존 테스트를 깨뜨리지 마라
