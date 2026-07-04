# Step 8: pipeline-cli

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` (데이터 흐름, 상태 관리 섹션)
- `/docs/PRD.md` (리포트 출력 규격 — 렌더러가 이 규격을 그대로 따라야 한다)
- `/docs/ADR.md` (ADR-004: 하네스 패턴 런타임)
- `/CLAUDE.md`
- `scripts/execute.py` (이 프로젝트 하네스 패턴의 원형 — 재시도·resume·상태 기록 방식을 참고하라)
- `src/types/` 전체, `src/lib/runStore.ts`, `src/services/`, `src/agents/` 전체 (step 1~7 산출물)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

파이프라인 오케스트레이터, 리포트 렌더러, CLI 엔트리포인트를 TDD로 작성해 시스템을 완성한다.

### 1. `src/pipeline/orchestrator.ts`

```ts
export interface PipelineDeps {
  store: RunStore;
  gemini: GeminiService;
  youtube: YoutubeService;
  log?: (msg: string) => void;  // 기본 console.error — 진행 상황 출력
}

export interface PipelineResult { runId: string; reportPath: string; state: RunState; }

export async function runPipeline(deps: PipelineDeps, params: { idea: string; resumeRunId?: string }): Promise<PipelineResult>;
```

동작 (execute.py의 하네스 패턴을 따른다):

1. `resumeRunId`가 있으면 `store.loadRun`으로 기존 run을 로드하고, 없으면 `store.createRun(idea)`.
2. PIPELINE_STEPS 순서대로 순차 실행. 각 step에 대해:
   - state.json상 completed이고 `store.loadStepOutput` 스키마 검증도 통과하면 **skip (resume)** — 저장된 산출물을 다음 step 입력으로 사용.
   - 실행 전 startedAt 기록, 성공 시 산출물 저장(`saveStepOutput`) → status completed + completedAt 기록. 각 전이마다 `store.saveRun`으로 즉시 persist (프로세스가 죽어도 state가 남아야 resume이 성립한다).
   - step 함수(runContextHunter 등)가 예외를 던지면 status error + errorMessage/failedAt 기록 후 예외를 다시 던진다. (에이전트 내부의 zod 검증 재시도는 GeminiService가 이미 담당 — 오케스트레이터는 step 단위 재시도를 하지 않는다.)
3. 세 step 완료 후 리포트 렌더링 → `store.saveReport` → RunState.completedAt 기록.

### 2. `src/lib/report.ts`

```ts
export function renderReport(idea: string, context: MarketContext, criticism: Criticism, solution: Solution): string;
```

PRD의 "리포트 출력 규격" 마크다운 구조를 **그대로** 따르라 (섹션 제목·순서 변경 금지). youtubeVoices는 인용 블록으로, CriticismPoint는 severity 표시와 함께 렌더링한다. 순수 함수로 작성하고, 고정 입력 → 고정 출력 스냅샷 테스트를 포함하라.

### 3. `src/cli/index.ts`

step 0의 임시 엔트리를 대체한다.

```
사용법: npm run consult -- "아이디어 텍스트" [--resume <run-id>]
```

1. `dotenv`로 `.env` 로드. `GEMINI_API_KEY` 없으면 발급 안내 메시지 출력 후 exit 1. `YOUTUBE_API_KEY` 없으면 경고만 출력하고 YouTube 수집 없이 진행 가능하게 하라(YoutubeService 주입을 조건부로 처리하거나 hunter의 실패 내성 활용 — 재량).
2. RunStore(baseDir: 리포 루트의 `runs/`), GeminiService, YoutubeService를 조립해 `runPipeline` 호출.
3. 완료 시 리포트 절대 경로를 stdout에 출력. 실패 시 에러 메시지와 함께 `--resume <run-id>`로 이어서 실행하는 방법을 안내.

인자 파싱은 `process.argv` 직접 처리(또는 Node 내장 `util.parseArgs`)로 하라.

### 테스트

- orchestrator: 모든 의존성 fake 주입. 시나리오 — (1) 신규 run 전체 성공 흐름과 state 전이, (2) 2번째 step 실패 시 state에 error 기록, (3) resume 시 completed step skip 및 저장된 산출물 재사용, (4) 산출물 파일이 손상된 completed step은 재실행.
- report: 스냅샷 테스트로 PRD 규격 섹션(`# [컨설팅 리포트]`, `## 1. 실시간 시장 맥락`, `## 2. 냉정한 현실 인식 및 비판`, `## 3. AI 네이티브 관점의 해결책`, `## 4. 지속 가능한 비즈니스 모델`)이 모두 존재함을 검증.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (실제 API 호출 없이)
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 데이터 흐름·상태 관리 규칙을 따르는가?
   - ADR-004 하네스 패턴(순차 step, persist, resume)이 구현됐는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- AC 검증을 위해 실제 API 키로 파이프라인을 실행하지 마라. 이유: AC는 mock 테스트로 충족된다. 실제 실행(smoke test)은 사용자가 .env를 준비한 뒤 직접 수행한다.
- 웹 서버/HTTP 엔드포인트를 만들지 마라. 이유: MVP는 CLI 전용 (PRD MVP 제외 사항).
- step 단위 재시도 루프를 오케스트레이터에 추가하지 마라. 이유: LLM 응답 검증 재시도는 GeminiService가 담당한다. 이중 재시도는 비용만 늘린다.
- 기존 테스트를 깨뜨리지 마라
