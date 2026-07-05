# 아키텍처

## 디렉토리 구조
```
src/
├── cli/               # CLI 엔트리포인트 (아이디어 입력 → 파이프라인 실행 → 리포트 경로 출력)
├── pipeline/          # 오케스트레이터 (step 순차 실행, 상태 관리, 재시도, resume)
├── agents/            # contextHunter / coldCritic / solutionDesigner (프롬프트 + 호출 로직)
├── services/          # 외부 API 래퍼 — gemini.ts (@google/genai), youtube.ts (YouTube Data API)
├── lib/               # runStore (runs/ 파일 I/O + listRuns), report (Markdown 렌더러)
└── types/             # zod 스키마 + TypeScript 타입 (RunState, MarketContext, Criticism, Solution)

web/                   # Next.js App Router 웹 UI (npm workspace) — 1-web-ui phase
├── src/app/           # 라우트: / (홈), /runs/[id] (진행/리포트), /compare, /api/*
├── src/components/    # ui/ (UI_GUIDE 기반 공통 컴포넌트), report/ (리포트 섹션)
├── src/lib/server/    # 서버 전용: RunStore 어댑터, CLI spawn, 상태 파생
└── src/test/          # vitest 설정, fixture run 데이터

runs/{run-id}/         # 실행 산출물 (git 미추적)
├── state.json         # step별 status/timestamp — resume 판정의 단일 진실 공급원
├── context.json       # Context Hunter 산출물 (MarketContext)
├── criticism.json     # Cold Critic 산출물 (Criticism)
├── solution.json      # Solution Designer 산출물 (Solution)
└── report.md          # 최종 컨설팅 리포트
```

## 패턴
- **하네스 패턴 런타임** (scripts/execute.py와 동형): 각 에이전트는 순차 실행되는 step. 산출물은 파일로 persist하고, 이전 step 산출물을 다음 프롬프트에 컨텍스트로 주입한다. 실패 시 에러 메시지를 피드백하며 최대 3회 자가 교정 재시도한다.
- **구조화 출력 + 스키마 검증**: 모든 에이전트 산출물은 Gemini 구조화 출력(JSON)으로 받고 zod 스키마로 검증한다. 검증 실패는 재시도 대상이다.
- **서비스 레이어 격리**: 외부 API(Gemini, YouTube) 호출은 services/에서만 일어난다. agents/는 services/를 통해서만 외부와 통신한다.

## 데이터 흐름
```
사용자 입력(아이디어) → cli → pipeline/orchestrator
  → step: context-hunter  (gemini grounding + youtube API) → runs/{id}/context.json
  → step: cold-critic     (gemini, context.json 주입)      → runs/{id}/criticism.json
  → step: solution-designer (gemini, context+criticism 주입) → runs/{id}/solution.json
  → lib/report 렌더러 → runs/{id}/report.md → CLI가 경로 출력
```

## 웹 UI 데이터 흐름 (1-web-ui)
```
브라우저 → Next.js API route (web/src/app/api/*)
  읽기:  RunStore(src/lib/runStore)로 runs/ 파일 읽기 → JSON 응답 (zod 스키마 재사용)
  실행:  POST /api/runs → RunStore.createRun(idea)로 runId 선(先)생성
         → CLI를 detached child process로 spawn: npm run consult -- --resume {runId}
         → 즉시 runId 응답 (Gemini/YouTube 호출은 CLI 프로세스의 services/ 안에서만 발생)
  진행:  브라우저가 GET /api/runs/{id}를 2초 폴링 — state.json이 진행 상태의 단일 진실 공급원
  재개:  POST /api/runs/{id}/resume → 동일한 spawn 패턴
```
- web은 외부 API(Gemini/YouTube)를 직접 호출하지 않는다. 파일 읽기와 CLI spawn만 한다.
- 타입·스키마는 src/types를 단일 소스로 import한다(중복 정의 금지) — ADR-005/ADR-006.
- run 상태 파생 규칙(완료/실패/진행중/중단됨)은 PRD "run 상태 파생 규칙"을 따른다.

## 상태 관리
- `runs/{run-id}/state.json`이 실행 상태의 단일 진실 공급원. step별 `status`(pending | completed | error)와 타임스탬프를 기록한다.
- 같은 run-id로 재실행하면 `completed`인 step은 건너뛰고 이어서 실행한다(resume). step 산출물 파일이 존재하고 스키마 검증을 통과해야 completed로 인정한다.
- 상태 파일 쓰기는 멱등적이어야 한다: 같은 입력으로 여러 번 실행해도 결과가 달라지지 않는다.
