# Step 5: progress-view

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` ("Phase 1-web-ui" → "진행 뷰" 섹션 — 이 step의 스펙이다. step명 번역 표 포함)
- `/docs/ADR.md` (ADR-007 — 폴링이 채택된 이유)
- `/docs/UI_GUIDE.md` (허용 애니메이션: 스피너)
- `/CLAUDE.md`
- `web/src/app/api/` (step 2 산출물 — RunDetail 계약), `web/src/components/ui/` (step 3), `web/src/test/fixtures/` (step 2)
- `src/types/run.ts` (PIPELINE_STEPS, StepState)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

run 상세 페이지(`web/src/app/runs/[id]/page.tsx`)와 진행 뷰를 TDD로 작성한다. 구성 요소는 `web/src/components/progress/` 하위에 둔다.

1. **폴링 훅** `useRunDetail(runId, intervalMs = 2000)`
   - `GET /api/runs/{id}`를 주기 폴링. run의 status가 `completed`가 되면 폴링을 중단한다.
   - 404면 폴링 중단 + not-found 상태 반환.

2. **페이지 분기**: status가 `completed`면 리포트 뷰, 그 외(running/error/stalled)면 진행 뷰를 렌더링한다. 같은 URL에서 폴링에 의해 자동 전환된다.
   - **리포트 뷰는 이 step에서는 placeholder다**: 아이디어 제목 + "리포트 준비 완료" + `GET /api/runs/{id}/report` 다운로드 링크만. step 6~7이 실제 리포트로 교체한다. placeholder 컴포넌트는 `web/src/components/report/ReportView.tsx`에 만들어 교체 지점을 명확히 하라.

3. **진행 뷰** (ProgressView)
   - 3단계 스테퍼. 내부 step명을 사용자 언어로 번역: `context-hunter` → "시장 조사", `cold-critic` → "냉정한 비판", `solution-designer` → "AI 네이티브 재설계".
   - step별 상태 표현: 완료 체크 / 진행중 스피너(animate-spin) / 대기 빈 원 / 실패 X. 진행중 판정: `startedAt` 존재 && `completedAt`·`error` 없음.
   - step별 경과 시간: 완료 step은 `completedAt - startedAt`, 진행중 step은 현재 시각 기준 1초 간격 갱신.
   - step `error` 시: errorMessage를 카드로 표시 + "이어서 실행" 버튼(`POST /api/runs/{id}/resume` → 성공 시 폴링 재개).
   - run status `stalled`일 때: "실행이 중단된 것 같습니다" 안내 + "이어서 실행" 버튼.

테스트(@testing-library/react, fetch mock + fake timers): 진행중/에러/중단 상태별 렌더링, step 번역 라벨, 폴링 중단 조건(completed·404), resume 버튼 → POST 호출.

## Acceptance Criteria

```bash
npm run build
npm test        # 진행 뷰 테스트 통과 (상태별 렌더/폴링 중단/resume)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 진행 상태의 근거가 API(state.json 파생)뿐인가? (클라이언트에서 별도 상태 추정 로직을 만들지 않았는가)
   - 폴링 간격이 2초인가? SSE/WebSocket을 쓰지 않았는가? (ADR-007)
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (ReportView placeholder 경로 명시)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 리포트 섹션(시장 맥락/비판/솔루션)을 구현하지 마라. 이유: step 6~7의 scope다. placeholder까지만.
- SSE·WebSocket·실시간 로그 표시를 구현하지 마라. 이유: ADR-007에서 기각했다.
- 폴링 간격을 임의로 바꾸지 마라(2초). 이유: PRD·ADR-007 확정값이다. 단, 테스트를 위한 intervalMs 주입은 허용.
- 테스트에서 실제 타이머로 폴링을 기다리지 마라. 이유: fake timers로 결정적으로 검증해야 한다.
- 기존 테스트를 깨뜨리지 마라
