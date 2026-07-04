# 아키텍처

## 디렉토리 구조
```
src/
├── cli/               # CLI 엔트리포인트 (아이디어 입력 → 파이프라인 실행 → 리포트 경로 출력)
├── pipeline/          # 오케스트레이터 (step 순차 실행, 상태 관리, 재시도, resume)
├── agents/            # contextHunter / coldCritic / solutionDesigner (프롬프트 + 호출 로직)
├── services/          # 외부 API 래퍼 — gemini.ts (@google/genai), youtube.ts (YouTube Data API)
├── lib/               # runStore (runs/ 파일 I/O), report (Markdown 렌더러)
└── types/             # zod 스키마 + TypeScript 타입 (RunState, MarketContext, Criticism, Solution)

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

## 상태 관리
- `runs/{run-id}/state.json`이 실행 상태의 단일 진실 공급원. step별 `status`(pending | completed | error)와 타임스탬프를 기록한다.
- 같은 run-id로 재실행하면 `completed`인 step은 건너뛰고 이어서 실행한다(resume). step 산출물 파일이 존재하고 스키마 검증을 통과해야 completed로 인정한다.
- 상태 파일 쓰기는 멱등적이어야 한다: 같은 입력으로 여러 번 실행해도 결과가 달라지지 않는다.
