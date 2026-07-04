# Step 2: run-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` (특히 "상태 관리" 섹션)
- `/docs/ADR.md` (ADR-002, ADR-004)
- `/CLAUDE.md`
- `src/types/` 전체 (step 1 산출물 — RunState, PIPELINE_STEPS 등)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

`src/lib/runStore.ts`에 `runs/{run-id}/` 파일 I/O를 담당하는 RunStore를 TDD로 작성한다. 파이프라인 상태의 단일 진실 공급원이다.

```ts
export class RunStore {
  constructor(baseDir: string) // 기본값 없이 명시적으로 받는다 — 테스트에서 임시 디렉토리 주입
  createRun(idea: string): RunState           // runId 생성(타임스탬프+slug 등 재량), runs/{id}/ 생성, state.json 초기화(모든 step pending)
  loadRun(runId: string): RunState            // state.json 읽기 + RunStateSchema 검증. 없으면 명확한 에러
  saveRun(state: RunState): void              // state.json 저장 (atomic write: 임시 파일 → rename)
  saveStepOutput(runId: string, step: PipelineStepName, data: unknown): void  // context.json / criticism.json / solution.json 저장
  loadStepOutput<T>(runId: string, step: PipelineStepName, schema: ZodType<T>): T | null  // 파일 없으면 null, 있으면 스키마 검증 후 반환
  saveReport(runId: string, markdown: string): string  // report.md 저장, 절대 경로 반환
}
```

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. **멱등성**: `createRun`을 제외한 모든 쓰기는 같은 입력으로 여러 번 호출해도 결과가 같아야 한다.
2. **resume 판정의 근거**: step이 completed로 인정되려면 state.json의 status와 산출물 파일 존재+스키마 검증이 모두 성립해야 한다. 이를 위해 `loadStepOutput`은 검증 실패 시 null을 반환한다(예외를 던지지 않는다). 파일이 손상됐으면 해당 step을 다시 실행하는 것이 올바른 동작이다.
3. **step 이름 → 파일명 매핑**: `context-hunter` → `context.json`, `cold-critic` → `criticism.json`, `solution-designer` → `solution.json`. 매핑은 상수로 한 곳에만 정의하라.

테스트는 `fs`를 mock하지 말고 OS 임시 디렉토리(`fs.mkdtempSync(os.tmpdir())`)를 사용해 실제 파일 I/O로 검증하라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (createRun/load/save/resume 판정/손상 파일 시나리오 포함)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (파일 I/O는 src/lib/에만)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙(TDD, 상태 단일 진실 공급원)을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 외부 API(Gemini/YouTube) 관련 코드를 작성하지 마라. 이유: services/ 레이어의 scope다 (step 3, 4).
- 리포지토리 루트의 `runs/`에 테스트 산출물을 남기지 마라. 이유: 테스트는 임시 디렉토리를 사용해야 하며, runs/는 .gitignore 대상이지만 로컬을 더럽히면 안 된다.
- DB나 외부 저장소를 도입하지 마라. 이유: ADR-002에서 파일 기반으로 확정했다.
- 기존 테스트를 깨뜨리지 마라
