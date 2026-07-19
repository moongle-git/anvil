# Step 4: scout-pipeline

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "패턴"(하네스 패턴), "데이터 흐름", "상태 관리"
- `/docs/ADR.md` — **ADR-004**(하네스 패턴), **ADR-007**(createRun 선생성 + detached spawn), **ADR-014**(SQLite 저장소)
- `/docs/PRD.md` — "run 상태 파생 규칙"
- `src/pipeline/orchestrator.ts` — 전체. 특히 **인터뷰 단계의 pause/resume 블록**(`state.interview` 분기). 이 step이 복제할 선례다
- `src/pipeline/orchestrator.test.ts`, `src/pipeline/e2e.test.ts`
- `src/agents/trendScout.ts` — step 3 산출물
- `src/lib/runStore.ts` — step 1에서 확장됨
- `src/types/opportunity.ts` — step 0 산출물

## 이전 step에서 만들어진 것

- step 0: zod 스키마 + `opportunitiesSchemaFor`. `PIPELINE_STEPS` 맨 앞에 `trend-scout`, `RunState.scout`
- step 1: `createRun(idea, { scout })`이 `trend-scout`만 seed하고 `interviewer`는 seed하지 않는다. `saveOpportunities`/`loadOpportunities`, `saveOpportunitySelection`/`loadOpportunitySelection`. 스카우트 run의 초기 `idea`는 범위 힌트(없으면 `"전 범위 탐색"`)
- step 2·3: `runTrendScout(deps, scope, now)` → `Opportunities`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/pipeline/orchestrator.ts`에 스카우트 분기를 추가한다. **인터뷰 블록과 같은 모양**이다 — detached CLI에는 stdin이 없으므로 아티팩트로 pause/resume한다.

### 1. 분기 위치와 형태

`context-hunter` **앞**, 인터뷰 블록과 나란히 놓는다. 두 분기는 상호배타적이다(step 1의 seeding 규칙상 한 run이 둘 다 갖지 않는다).

```
if (state.scout) {
  selection = loadOpportunitySelection(runId)

  if (selection === null) {
    opportunities = loadOpportunities(runId)        // resume 시 재사용
    if (opportunities === null) {
      // 실행: runTrendScout → saveOpportunities
    }
    if (opportunities.candidates.length === 0) → error 종료
    step.status = "waiting"; return { status: "waiting" }
  }

  // 선택됨 → 후보 해소 → state.idea 확정 → step completed
}
```

핵심 규칙:

- **`opportunities`가 이미 저장돼 있으면 재사용하라.** grounded 호출은 비싸다. 사용자가 답을 늦게 주거나 프로세스가 죽어 resume돼도 다시 검색하면 안 된다. 인터뷰 블록이 `questions`를 재사용하는 것과 같다.
- **`waiting`은 에러가 아니다.** `completedAt`을 세팅하지 마라. 인터뷰 블록의 처리와 동일하다.
- 후보 생성 **실패**(throw)는 진짜 에러다 — `status: "error"`로 기록하고 `PipelineStepError`를 던져라. pause와 구분하라.

### 2. 후보 0개 처리 — waiting이 아니라 error

`candidates: []`는 `runTrendScout`의 **정당한 산출물**이지만(근거가 없으면 지어내지 않는다), 파이프라인 관점에서는 고를 것이 없어 진행할 수 없다.

- `status: "waiting"`으로 두지 마라. 사용자가 영원히 고를 수 없는 화면 앞에 놓인다.
- `status: "error"` + 사람이 읽을 수 있는 `errorMessage`로 종료하라. 예: `"자본 흐름 근거를 찾지 못해 후보를 만들지 않았다. 탐색 범위를 바꿔 다시 시도하라."`
- **"후보를 못 찾았다"를 실패로 취급하되, 그 원인을 모델 탓으로 돌리는 메시지를 쓰지 마라.** 근거 없이 후보를 만들지 않은 것은 설계된 동작이다. 메시지는 사용자가 다음에 무엇을 할지(범위 조정) 알려줘야 한다.

`error` 상태이므로 PRD의 run 상태 파생 규칙에 따라 웹에서 "이어서 실행"(resume)이 뜬다. resume하면 `opportunities`가 저장돼 있고 `candidates`가 0이라 같은 곳에서 다시 멈춘다 — 이는 정상이다. **재검색을 유도하려면 사용자가 새 run을 만들어야 한다.** 저장된 빈 결과를 자동으로 버리고 재검색하지 마라. 비싼 호출이 조용히 반복된다.

### 3. 주제 확정

선택된 `candidateId`로 `opportunities.candidates`에서 후보를 찾는다.

- **못 찾으면 error다.** 조용히 첫 후보로 폴백하지 마라 — 사용자가 고르지 않은 주제로 파이프라인이 완주해 리포트가 나온다.
- 찾으면 `state.idea`를 확정 주제로 갈아끼우고 `deps.store.saveRun(state)`를 호출한다. 새 메서드를 만들지 마라 — `saveRun`이 이미 `idea`를 UPDATE한다.
- 확정 주제 문자열은 후보의 `title`과 `whatItIs`를 합쳐 만들어라. 하류 에이전트 전부가 `idea`만 보고 판단하므로 제목만 넣으면 맥락이 날아간다.
- `trend-scout` step을 `completed`로 기록한다.

### 4. 선택된 후보를 하류로 전달

확정된 후보 객체(`Opportunity`)를 `runContextHunter` 호출부에 넘길 수 있도록 변수로 들고 있어라.

**단, `contextHunter`의 시그니처 변경은 step 5의 일이다.** 이 step에서는 orchestrator 안에 값을 준비만 해두고, 실제 인자 전달은 step 5가 한 줄로 배선한다. 이 step에서 `src/agents/contextHunter.ts`를 수정하지 마라.

### 5. resume 정합성

`executeStep`의 기존 규약(완료된 step은 산출물을 로드해 건너뛰고, 산출물이 없거나 손상됐으면 재실행)은 그대로 둔다. 스카우트 블록은 `executeStep` 바깥에서 인터뷰 블록처럼 직접 상태를 다룬다 — pause가 있어 `executeStep`의 성공/실패 이분법에 맞지 않기 때문이다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (GEMINI_API_KEY 없이)
npm run lint
```

`src/pipeline/orchestrator.test.ts`에 테스트를 **먼저** 추가하라(TDD). Gemini·에이전트는 mock한다. 최소한 아래를 덮어라:

- 스카우트 run, 선택 없음 → `trend-scout`이 실행되고 `opportunities`가 저장되며 `status: "waiting"`으로 반환된다. `completedAt`이 세팅되지 않는다
- `waiting` 상태에서 resume(선택 여전히 없음) → **`runTrendScout`이 다시 호출되지 않고** 저장된 `opportunities`를 재사용한다
- 선택 제출 후 resume → `state.idea`가 확정 주제로 바뀌고 `context-hunter` 이후가 진행된다
- 확정된 `idea`가 후보의 `title`과 `whatItIs`를 모두 포함한다
- `candidates: []` → `status: "error"` + 사람이 읽을 수 있는 `errorMessage`. `waiting`이 아니다
- 존재하지 않는 `candidateId` 선택 → error. 첫 후보로 폴백하지 않는다
- 스카우트 run에서 `interviewer`가 실행되지 않는다
- 비-스카우트 run은 기존 동작 그대로다 (회귀 없음)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - 파이프라인 상태 쓰기가 전이마다 즉시 persist되는가? (하네스 패턴 — 프로세스가 죽어도 resume이 성립해야 한다)
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **저장된 `opportunities`를 무시하고 재검색하지 마라.** 이유: grounded 호출은 이 파이프라인에서 가장 비싼 종류다(ADR-016). resume마다 재검색하면 비용이 조용히 배로 뛴다.
- **`candidates: []`를 `waiting`으로 두지 마라.** 이유: 사용자가 영원히 고를 수 없는 화면 앞에 놓인다.
- **존재하지 않는 `candidateId`를 첫 후보로 폴백하지 마라.** 이유: 사용자가 고르지 않은 주제로 리포트가 완주해 나온다. 조용한 오답이 명시적 실패보다 나쁘다.
- **`src/agents/contextHunter.ts`를 수정하지 마라.** 이유: step 5의 scope다. 이 step은 orchestrator만 다룬다.
- **스카우트 블록을 `executeStep`으로 감싸지 마라.** 이유: pause(`waiting`)가 성공/실패 이분법에 맞지 않는다. 인터뷰 블록이 바깥에 있는 것과 같은 이유다.
- **스카우트 run에서 `interviewer`를 실행하지 마라.** 이유: 한 run에서 사용자를 두 번 멈춰 세우게 되고, 범위 힌트를 이미 받았으므로 질문이 중복된다.
- 기존 테스트를 깨뜨리지 마라.
