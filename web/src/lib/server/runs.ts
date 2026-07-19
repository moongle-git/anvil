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
  type Opportunities,
  type Opportunity,
  type RunState,
  type ScoutOrigin,
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

/** 계보 표시에 필요한 원본 run의 최소 정보 (UI_GUIDE "계보 표시") */
export interface RunOrigin {
  runId: string;
  idea: string;
  /** 비교 바로가기는 원본과 이번 run이 둘 다 completed일 때만 뜬다 — 아니면 죽은 링크다 */
  status: RunDisplayStatus;
}

export interface RunDetail {
  state: RunState;
  status: RunDisplayStatus;
  /** 재실행으로 생긴 run이면 원본 run_id. 원본이 삭제되면 끊긴다 (ADR-015) */
  rerunOf?: string;
  /** rerunOf가 가리키는 원본을 조회한 결과. 계보 UI는 이것만 보면 된다 */
  origin?: RunOrigin;
  questions?: InterviewQuestions;
  /**
   * 스카우트 run의 후보 목록. waiting일 때는 선택 UI가, 완료된 뒤에는 리포트 뷰의
   * "이 주제가 어디서 왔는가"가 쓴다 — 그래서 상태로 조건 걸지 않는다.
   *
   * 이 엔드포인트는 2초마다 폴링되므로 실어 보내는 것마다 크기를 따져야 한다(hasReport가
   * 본문 대신 유무만 묻는 이유). 후보는 최대 5개이고 각각 신호 2~3건 + 짧은 산문이라
   * 수 KB 수준이다 — context(실측 52KB)와 같은 자리에 두면 과한 것이지만, 후보 목록은
   * 그 100분의 1이고 진행 뷰가 **선택을 렌더하려면 반드시 필요한 값**이다.
   * 별도 엔드포인트로 빼면 waiting 진입 순간을 클라이언트가 다시 감지해 한 번 더 왕복한다.
   */
  opportunities?: Opportunities;
  /**
   * 사람이 고른 주제 하나와 그것이 나온 탐색의 좌표. 리포트 뷰의 "이 주제가 어디서 왔는가"가 쓴다.
   *
   * opportunities와 겹쳐 보이지만 서로 다른 질문에 답한다 — opportunities는 "무엇을 고를 수
   * 있었나"(선택 화면), scoutOrigin은 "무엇을 골랐나"(리포트)다. 파생을 여기서 끝내는 것은
   * report.md와 같은 것을 보게 하기 위해서다(ScoutOrigin은 renderReport의 인자 타입 그대로다) —
   * 클라이언트가 selection과 candidates를 다시 맞춰보면 두 번째 진실이 된다.
   *
   * 선택 이전에는 자연히 없다. 상태로 조건 걸지 않는 이유가 그것이다.
   */
  scoutOrigin?: ScoutOrigin;
  context?: MarketContext;
  thesis?: Thesis;
  criticism?: Criticism;
  solution?: Solution;
  verdict?: Verdict;
  hasReport: boolean;
}

/**
 * 원본 run을 계보 표시용으로 조회한다. 같은 커넥션 안에서 처리한다 (요청당 커넥션 1개).
 *
 * FK가 살아 있으면 원본 행도 살아 있지만(ON DELETE SET NULL), 원본의 상태 행이 손상돼
 * 읽히지 않을 수는 있다. 그때는 계보를 그리지 않는다 — 죽은 링크보다 없는 편이 낫다.
 */
function loadOrigin(store: RunStore, rerunOf: string): RunOrigin | null {
  const record = store.loadRunRecord(rerunOf);
  if (record === null) {
    return null;
  }
  return {
    runId: rerunOf,
    idea: record.state.idea,
    status: deriveRunStatus(record.state, record.updatedAtMs),
  };
}

/**
 * 저장된 선택을 후보 목록과 맞춰 리포트용 뷰로 만든다. orchestrator가 report.md에 넘기는 것과
 * 같은 값이다 (ScoutOrigin — 파생이지 아티팩트가 아니다).
 *
 * 선택이 없거나(아직 안 골랐다) 그 id가 후보에 없으면(구 데이터·손상) 조용히 없는 것으로 둔다 —
 * 고르지 않은 후보를 "이 주제의 출처"라고 보여주는 것보다 아무것도 안 보여주는 편이 정직하다.
 */
function scoutOriginOf(
  store: RunStore,
  runId: string,
  opportunities: Opportunities | null,
): ScoutOrigin | null {
  if (opportunities === null) {
    return null;
  }
  const selection = store.loadOpportunitySelection(runId);
  if (selection === null) {
    return null;
  }
  const chosen: Opportunity | undefined = opportunities.candidates.find(
    (candidate) => candidate.id === selection.candidateId,
  );
  if (chosen === undefined) {
    return null;
  }
  return {
    scope: opportunities.scope,
    searchedAt: opportunities.searchedAt,
    opportunity: chosen,
  };
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
    const opportunities = store.loadOpportunities(runId);
    const context = store.loadStepOutput(runId, "context-hunter", MarketContextSchema);
    const thesis = store.loadStepOutput(runId, "thesis", ThesisSchema);
    const criticism = store.loadStepOutput(runId, "cold-critic", CriticismSchema);
    const solution = store.loadStepOutput(runId, "solution-designer", SolutionSchema);
    const verdict = store.loadStepOutput(runId, "verdict", VerdictSchema);

    const origin = rerunOf !== undefined ? loadOrigin(store, rerunOf) : null;
    const scoutOrigin = scoutOriginOf(store, runId, opportunities);

    return {
      state,
      status: deriveRunStatus(state, updatedAtMs),
      ...(rerunOf !== undefined ? { rerunOf } : {}),
      ...(origin !== null ? { origin } : {}),
      ...(questions !== null ? { questions } : {}),
      ...(opportunities !== null ? { opportunities } : {}),
      ...(scoutOrigin !== null ? { scoutOrigin } : {}),
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
