# Step 1: run-index

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` ("상태 관리", "웹 UI 데이터 흐름" 섹션)
- `/docs/PRD.md` ("run 상태 파생 규칙" 섹션 — 이 step의 스펙이다)
- `/docs/ADR.md` (ADR-002, ADR-007)
- `/CLAUDE.md`
- `src/lib/runStore.ts`, `src/lib/runStore.test.ts` (기존 패턴을 그대로 따라라)
- `src/types/run.ts` (RunState, StepState)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

루트 `src/lib/runStore.ts`에 run 목록 조회와 표시용 상태 파생을 TDD로 추가한다. 웹 UI의 run 이력 목록이 이 함수를 사용한다.

```ts
export type RunDisplayStatus = "completed" | "error" | "running" | "stalled";

export interface RunSummary {
  runId: string;
  idea: string;
  createdAt: string;
  completedAt?: string;
  status: RunDisplayStatus;
}

// 순수 함수 — 테스트에서 시간 주입 가능해야 한다
export function deriveRunStatus(
  state: RunState,
  stateFileMtimeMs: number,
  nowMs?: number, // 기본값 Date.now()
): RunDisplayStatus;

export class RunStore {
  // ...기존 메서드 유지...
  listRuns(nowMs?: number): RunSummary[];
}
```

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. **상태 파생 규칙** (PRD와 동일해야 한다):
   - `state.completedAt` 존재 → `"completed"`
   - 어느 step이든 `status === "error"` → `"error"`
   - 그 외: state.json mtime이 now 기준 10분 이내 → `"running"`, 10분 초과 → `"stalled"`
   - 10분 임계값은 이름 있는 상수로 한 곳에만 정의하라.
2. **listRuns의 내결함성**: baseDir가 없으면 빈 배열. state.json이 없거나 JSON 파싱/스키마 검증에 실패하는 디렉토리는 **예외를 던지지 말고 skip**하라. 이유: 손상된 run 하나가 목록 전체를 죽이면 안 된다.
3. **정렬**: `createdAt` 내림차순(최신 먼저).

테스트는 기존 `runStore.test.ts`처럼 fs mock 없이 OS 임시 디렉토리를 사용해 실제 파일 I/O로 검증하라. mtime 기반 시나리오는 `nowMs` 주입 또는 `fs.utimesSync`로 제어하라.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (완료/실패/진행중/중단됨 파생, 손상 run skip, 정렬, 빈 디렉토리 시나리오 포함)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 파일 I/O가 src/lib/에만 있는가?
   - 상태 파생 규칙이 PRD "run 상태 파생 규칙"과 일치하는가?
   - CLAUDE.md CRITICAL 규칙(TDD)을 위반하지 않았는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `web/` 하위에 코드를 작성하지 마라. 이유: 이 step은 루트 lib 레이어만 다룬다 (web은 step 2부터).
- 외부 API(Gemini/YouTube) 관련 코드를 작성하지 마라. 이유: services/ 레이어의 scope이며 이 step과 무관하다.
- 기존 RunStore 메서드의 시그니처·동작을 바꾸지 마라. 이유: CLI와 orchestrator가 의존한다.
- 루트 `runs/`에 테스트 산출물을 남기지 마라. 이유: 테스트는 임시 디렉토리를 사용해야 한다.
- 기존 테스트를 깨뜨리지 마라
