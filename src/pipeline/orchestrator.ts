import type { ZodType } from "zod";
import { runColdCritic } from "../agents/coldCritic.js";
import { runContextHunter } from "../agents/contextHunter.js";
import { runSolutionDesigner } from "../agents/solutionDesigner.js";
import { renderReport } from "../lib/report.js";
import type { RunStore } from "../lib/runStore.js";
import type { GeminiService } from "../services/gemini.js";
import type { YoutubeService } from "../services/youtube.js";
import {
  CriticismSchema,
  MarketContextSchema,
  SolutionSchema,
  type PipelineStepName,
  type RunState,
  type StepState,
} from "../types/index.js";

export interface PipelineDeps {
  store: RunStore;
  gemini: GeminiService;
  youtube: YoutubeService;
  log?: (msg: string) => void;
}

export interface PipelineParams {
  idea: string;
  resumeRunId?: string;
}

export interface PipelineResult {
  runId: string;
  reportPath: string;
  state: RunState;
}

/** step 실패를 runId와 함께 전달해 CLI가 --resume 안내를 할 수 있게 한다 */
export class PipelineStepError extends Error {
  constructor(
    readonly runId: string,
    readonly step: PipelineStepName,
    cause: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`step '${step}' 실행이 실패했다: ${message}`, { cause });
    this.name = "PipelineStepError";
  }
}

function getStepState(state: RunState, name: PipelineStepName): StepState {
  const existing = state.steps.find((s) => s.name === name);
  if (existing !== undefined) {
    return existing;
  }
  const created: StepState = { name, status: "pending" };
  state.steps.push(created);
  return created;
}

export async function runPipeline(
  deps: PipelineDeps,
  params: PipelineParams,
): Promise<PipelineResult> {
  const log = deps.log ?? ((msg: string) => console.error(msg));
  const state =
    params.resumeRunId !== undefined
      ? deps.store.loadRun(params.resumeRunId)
      : deps.store.createRun(params.idea);
  const { runId, idea } = state;

  // 하네스 패턴 (ADR-004): 순차 실행 + 전이마다 saveRun으로 즉시 persist.
  // 프로세스가 죽어도 state.json이 남아야 resume이 성립한다.
  async function executeStep<T>(
    name: PipelineStepName,
    schema: ZodType<T>,
    run: () => Promise<T>,
  ): Promise<T> {
    const step = getStepState(state, name);

    if (step.status === "completed") {
      const saved = deps.store.loadStepOutput(runId, name, schema);
      if (saved !== null) {
        log(`[pipeline] ${name}: completed — skip (resume)`);
        return saved;
      }
      log(`[pipeline] ${name}: 산출물이 없거나 손상됨 — 재실행한다`);
    }

    step.status = "pending";
    step.startedAt = new Date().toISOString();
    delete step.completedAt;
    delete step.failedAt;
    delete step.errorMessage;
    deps.store.saveRun(state);
    log(`[pipeline] ${name}: 실행 시작`);

    try {
      const output = await run();
      deps.store.saveStepOutput(runId, name, output);
      step.status = "completed";
      step.completedAt = new Date().toISOString();
      deps.store.saveRun(state);
      log(`[pipeline] ${name}: 완료`);
      return output;
    } catch (error) {
      step.status = "error";
      step.errorMessage = error instanceof Error ? error.message : String(error);
      step.failedAt = new Date().toISOString();
      deps.store.saveRun(state);
      throw new PipelineStepError(runId, name, error);
    }
  }

  const context = await executeStep("context-hunter", MarketContextSchema, () =>
    runContextHunter({ gemini: deps.gemini, youtube: deps.youtube }, idea),
  );
  const criticism = await executeStep("cold-critic", CriticismSchema, () =>
    runColdCritic({ gemini: deps.gemini }, idea, context),
  );
  const solution = await executeStep(
    "solution-designer",
    SolutionSchema,
    () => runSolutionDesigner({ gemini: deps.gemini }, idea, context, criticism),
  );

  const reportPath = deps.store.saveReport(
    runId,
    renderReport(idea, context, criticism, solution),
  );
  if (state.completedAt === undefined) {
    state.completedAt = new Date().toISOString();
  }
  deps.store.saveRun(state);
  log(`[pipeline] 리포트 생성 완료: ${reportPath}`);

  return { runId, reportPath, state };
}
