import fs from "node:fs";
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

export function getRunsDir(): string {
  return process.env.ANVIL_RUNS_DIR ?? path.resolve(process.cwd(), "..", "runs");
}

export function getRepoRoot(): string {
  return process.env.ANVIL_REPO_ROOT ?? path.resolve(process.cwd(), "..");
}

export function getRunStore(): RunStore {
  return new RunStore(getRunsDir());
}

export interface RunDetail {
  state: RunState;
  status: RunDisplayStatus;
  questions?: InterviewQuestions;
  context?: MarketContext;
  thesis?: Thesis;
  criticism?: Criticism;
  solution?: Solution;
  verdict?: Verdict;
  hasReport: boolean;
}

export function getRunDetail(runId: string): RunDetail | null {
  const store = getRunStore();
  const runDir = path.join(getRunsDir(), runId);

  let state: RunState;
  let stateFileMtimeMs: number;
  try {
    stateFileMtimeMs = fs.statSync(path.join(runDir, "state.json")).mtimeMs;
    state = store.loadRun(runId);
  } catch {
    // run 부재·state.json 손상은 "없는 run"으로 취급한다 (throw 금지)
    return null;
  }

  // loadStepOutput은 스키마 검증 실패 시 null을 반환한다. 구버전 run(평탄화 이전 criticism.json 등)은
  // 해당 필드만 생략되고 UI가 빈 상태를 보여준다 — run 하나가 목록·상세 전체를 죽이지 않는다 (ADR-011).
  const questions = store.loadInterviewQuestions(runId);
  const context = store.loadStepOutput(runId, "context-hunter", MarketContextSchema);
  const thesis = store.loadStepOutput(runId, "thesis", ThesisSchema);
  const criticism = store.loadStepOutput(runId, "cold-critic", CriticismSchema);
  const solution = store.loadStepOutput(runId, "solution-designer", SolutionSchema);
  const verdict = store.loadStepOutput(runId, "verdict", VerdictSchema);

  return {
    state,
    status: deriveRunStatus(state, stateFileMtimeMs),
    ...(questions !== null ? { questions } : {}),
    ...(context !== null ? { context } : {}),
    ...(thesis !== null ? { thesis } : {}),
    ...(criticism !== null ? { criticism } : {}),
    ...(solution !== null ? { solution } : {}),
    ...(verdict !== null ? { verdict } : {}),
    hasReport: fs.existsSync(path.join(runDir, "report.md")),
  };
}

export function searchRuns(q?: string, status?: RunDisplayStatus): RunSummary[] {
  let runs = getRunStore().listRuns();
  if (q !== undefined && q.trim() !== "") {
    const needle = q.toLowerCase();
    runs = runs.filter((run) => run.idea.toLowerCase().includes(needle));
  }
  if (status !== undefined) {
    runs = runs.filter((run) => run.status === status);
  }
  return runs;
}
