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
  type Criticism,
  type MarketContext,
  type RunState,
  type Solution,
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
  context?: MarketContext;
  criticism?: Criticism;
  solution?: Solution;
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

  const context = store.loadStepOutput(runId, "context-hunter", MarketContextSchema);
  const criticism = store.loadStepOutput(runId, "cold-critic", CriticismSchema);
  const solution = store.loadStepOutput(runId, "solution-designer", SolutionSchema);

  return {
    state,
    status: deriveRunStatus(state, stateFileMtimeMs),
    ...(context !== null ? { context } : {}),
    ...(criticism !== null ? { criticism } : {}),
    ...(solution !== null ? { solution } : {}),
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
