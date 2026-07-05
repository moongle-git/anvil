# Step 2: api-routes

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` ("웹 UI 데이터 흐름" 섹션 — 이 step의 스펙이다)
- `/docs/ADR.md` (ADR-006, ADR-007 — 실행 트리거 패턴)
- `/docs/PRD.md` ("Phase 1-web-ui" 섹션)
- `/CLAUDE.md`
- `src/lib/runStore.ts` (step 1 산출물 — RunStore, listRuns, deriveRunStatus, RunSummary)
- `src/types/` 전체 (MarketContextSchema, CriticismSchema, SolutionSchema, RunState)
- `src/cli/index.ts` (`--resume` 인터페이스 확인)
- `web/` 설정 (step 0 산출물 — 타입 공유 메커니즘, vitest 설정)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

web의 API 레이어를 TDD로 작성한다. 로직은 서버 전용 lib 함수로 분리하고 route handler는 얇게 유지해, route 파일 없이도 로직을 테스트할 수 있게 하라.

1. **`web/src/lib/server/runs.ts`** — RunStore 접근 어댑터

```ts
export function getRunsDir(): string;   // process.env.ANVIL_RUNS_DIR ?? path.resolve(process.cwd(), "..", "runs")
export function getRepoRoot(): string;  // process.env.ANVIL_REPO_ROOT ?? path.resolve(process.cwd(), "..")
export function getRunStore(): RunStore; // getRunsDir() 기반

export interface RunDetail {
  state: RunState;
  status: RunDisplayStatus;
  context?: MarketContext;   // loadStepOutput 스키마 검증 실패/부재 시 필드 생략
  criticism?: Criticism;
  solution?: Solution;
  hasReport: boolean;        // report.md 존재 여부
}
export function getRunDetail(runId: string): RunDetail | null; // run 없으면 null
export function searchRuns(q?: string, status?: RunDisplayStatus): RunSummary[]; // q는 idea 부분 문자열(대소문자 무시)
```

2. **`web/src/lib/server/spawnConsult.ts`** — 파이프라인 실행 트리거 (ADR-007)

```ts
export function spawnConsult(
  runId: string,
  opts?: { spawnFn?: typeof spawn; cwd?: string }, // 테스트 주입용
): void;
// spawn("npm", ["run", "consult", "--", "--resume", runId],
//       { cwd: getRepoRoot(), detached: true, stdio: "ignore" }).unref()
```

3. **Route handlers** (`web/src/app/api/`)
   - `GET /api/runs?q=&status=` → `200 { runs: RunSummary[] }`
   - `POST /api/runs` body `{ idea: string }` → idea가 공백뿐이면 `400`; 성공 시 `RunStore.createRun(idea)` 후 `spawnConsult(runId)` → `201 { runId }`. **createRun이 먼저, spawn이 다음** — runId를 즉시 응답하기 위한 ADR-007의 핵심 순서다.
   - `GET /api/runs/[id]` → `200 RunDetail` | `404`
   - `GET /api/runs/[id]/report` → report.md 내용을 `text/markdown; charset=utf-8` + `Content-Disposition: attachment` 로 응답 | `404`
   - `POST /api/runs/[id]/resume` → run이 없으면 `404`; status가 `error`/`stalled`일 때만 `spawnConsult` 후 `202`; `running`/`completed`면 `409`

4. **테스트 fixture**: `web/src/test/fixtures/`에 fixture run 3종을 만들어라 — 이후 step(4~8)의 테스트가 재사용한다.
   - 완료 run: 유효한 state.json(completedAt 포함) + context.json + criticism.json + solution.json + report.md. 내용은 스키마를 통과하는 현실적인 축약 데이터(경쟁사 10개 이상, youtubeVoices 3개 이상, 3축 비판 각 2개·severity 혼합)로 작성하라.
   - 진행중 run: context-hunter만 completed인 state.json + context.json
   - 실패 run: cold-critic이 error(errorMessage 포함)인 state.json + context.json
   - 테스트는 fixture를 OS 임시 디렉토리에 복사하고 `ANVIL_RUNS_DIR`를 주입해 실행하라 (mtime 제어 포함).

## Acceptance Criteria

```bash
npm run build   # 루트 + web 컴파일/빌드 성공
npm test        # 검색/필터, RunDetail 조립(산출물 부재·손상 포함), createRun→spawn 순서, resume 상태 검증(404/409/202), report 다운로드 테스트 통과
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - web이 외부 API를 직접 호출하지 않는가? (파일 읽기와 spawn만)
   - zod 스키마를 src/types에서 import했는가? (중복 정의 없음)
   - CLAUDE.md CRITICAL 규칙(TDD, 테스트에서 실제 외부 API 금지)을 위반하지 않았는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (fixture 경로 포함)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `@google/genai`·YouTube 관련 코드를 web에서 import하지 마라. 이유: CRITICAL 규칙 — 외부 API는 루트 src/services/ 전용이며, 웹의 실행은 CLI spawn으로만 트리거한다 (ADR-007).
- 테스트에서 실제 child process를 spawn하지 마라. 이유: 테스트가 API 키 없이, 부수효과 없이 통과해야 한다. spawnFn 주입으로 mock하라.
- UI 컴포넌트·페이지를 작성하지 마라. 이유: step 3~8의 scope다.
- 파이프라인 실행 완료를 기다리는(블로킹) API를 만들지 마라. 이유: ADR-007 — 즉시 runId를 응답하고 진행 상태는 폴링으로 조회한다.
- 루트 `runs/`·실제 리포지토리 파일을 테스트에서 사용하지 마라. 이유: 테스트는 임시 디렉토리 + fixture만 사용한다.
- 기존 테스트를 깨뜨리지 마라
