import path from "node:path";
import {
  RunStore,
  deriveRunStatus,
  type RunDisplayStatus,
  type RunSummary,
} from "@anvil/runStore";
import {
  CriticismSchema,
  MarketContextSchema,
  SolutionSchema,
  ThesisSchema,
  VerdictSchema,
  type Criticism,
  type InterviewQuestions,
  type MarketContext,
  type RunState,
  type Solution,
  type Thesis,
  type Verdict,
} from "@anvil/types";

/**
 * SQLite DB 파일의 경로 (ADR-014).
 *
 * 루트의 getDefaultDbPath()를 그대로 쓸 수 없다 — 그쪽 기본값은 <cwd>/data/anvil.db인데
 * 웹의 process.cwd()는 web/이라 web/data/anvil.db를 가리키게 된다. 환경변수 이름은 공유한다.
 */
export function getDbPath(): string {
  return (
    process.env.ANVIL_DB_PATH ??
    path.resolve(process.cwd(), "..", "data", "anvil.db")
  );
}

/** CLI를 spawn할 cwd (ADR-007) */
export function getRepoRoot(): string {
  return process.env.ANVIL_REPO_ROOT ?? path.resolve(process.cwd(), "..");
}

/**
 * 요청마다 DB 커넥션을 열고 닫는다 (ARCHITECTURE "웹 UI 데이터 흐름").
 *
 * 모듈 스코프 싱글턴으로 들고 있으면 Next dev 서버의 HMR이 모듈을 재평가하면서
 * 이미 닫힌(또는 죽은) 핸들을 재활용한다. 로컬 도구라 오픈 비용은 무시할 수 있다.
 */
export function withRunStore<T>(fn: (store: RunStore) => T): T {
  const store = new RunStore(getDbPath());
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export interface RunDetail {
  state: RunState;
  status: RunDisplayStatus;
  /** 재실행으로 생긴 run이면 원본 run_id. 원본이 삭제되면 끊긴다 (ADR-015) */
  rerunOf?: string;
  questions?: InterviewQuestions;
  context?: MarketContext;
  thesis?: Thesis;
  criticism?: Criticism;
  solution?: Solution;
  verdict?: Verdict;
  hasReport: boolean;
}

export function getRunDetail(runId: string): RunDetail | null {
  return withRunStore((store) => {
    // 없는 run·손상된 상태 행은 "없는 run"으로 취급한다 (throw 금지 — API가 404를 낸다)
    const record = store.loadRunRecord(runId);
    if (record === null) {
      return null;
    }
    const { state, updatedAtMs, rerunOf } = record;

    // loadStepOutput은 스키마 검증 실패 시 null을 반환한다. 구버전 run(평탄화 이전 criticism 등)은
    // 해당 필드만 생략되고 UI가 빈 상태를 보여준다 — run 하나가 목록·상세 전체를 죽이지 않는다 (ADR-011).
    const questions = store.loadInterviewQuestions(runId);
    const context = store.loadStepOutput(runId, "context-hunter", MarketContextSchema);
    const thesis = store.loadStepOutput(runId, "thesis", ThesisSchema);
    const criticism = store.loadStepOutput(runId, "cold-critic", CriticismSchema);
    const solution = store.loadStepOutput(runId, "solution-designer", SolutionSchema);
    const verdict = store.loadStepOutput(runId, "verdict", VerdictSchema);

    return {
      state,
      status: deriveRunStatus(state, updatedAtMs),
      ...(rerunOf !== undefined ? { rerunOf } : {}),
      ...(questions !== null ? { questions } : {}),
      ...(context !== null ? { context } : {}),
      ...(thesis !== null ? { thesis } : {}),
      ...(criticism !== null ? { criticism } : {}),
      ...(solution !== null ? { solution } : {}),
      ...(verdict !== null ? { verdict } : {}),
      hasReport: store.hasReport(runId),
    };
  });
}

export function searchRuns(q?: string, status?: RunDisplayStatus): RunSummary[] {
  return withRunStore((store) => {
    // 키워드는 SQL LIKE로 내리고(DB 도입의 실익), 상태는 메모리에서 거른다 —
    // 상태는 updated_at과 현재 시각의 비교로 파생되는 값이라 WHERE 절로 복제하면
    // deriveRunStatus와 반드시 갈라진다. 상태 판정의 권위는 deriveRunStatus 단독이다.
    const runs = store.listRuns({ q });
    return status === undefined
      ? runs
      : runs.filter((run) => run.status === status);
  });
}
