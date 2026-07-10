import type { ZodType } from "zod";
import { runColdCritic } from "../agents/coldCritic.js";
import { runContextHunter } from "../agents/contextHunter.js";
import { runInterviewer } from "../agents/interviewer.js";
import { runSolutionDesigner } from "../agents/solutionDesigner.js";
import { runThesis } from "../agents/thesis.js";
import { renderReport } from "../lib/report.js";
import type { RunStore } from "../lib/runStore.js";
import type { GeminiService } from "../services/gemini.js";
import type { YoutubeService } from "../services/youtube.js";
import {
  CriticismSchema,
  MarketContextSchema,
  SolutionSchema,
  ThesisSchema,
  type InterviewAnswers,
  type InterviewQuestions,
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
  state: RunState;
  // waiting: 인터뷰 답변을 기다리며 일시 중지됨. completed: 리포트까지 생성 완료.
  status: "completed" | "waiting";
  reportPath?: string;
}

/** 답변을 질문 텍스트와 짝지어 Context Hunter 프롬프트에 넣을 문자열로 만든다. 유효한 답변이 없으면 "" */
function formatClarifications(
  questions: InterviewQuestions | null,
  answers: InterviewAnswers,
): string {
  const questionById = new Map(
    (questions?.questions ?? []).map((q) => [q.id, q.question]),
  );
  const blocks = answers.answers
    .filter((a) => a.answer.trim().length > 0)
    .map((a) => {
      const question = questionById.get(a.questionId) ?? a.questionId;
      return `Q: ${question}\nA: ${a.answer}`;
    });
  return blocks.join("\n\n");
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

  // ── 인터뷰 단계 (웹에서 생성된 run만; state.interview로 구동) ──
  // detached CLI에는 stdin이 없으므로 questions.json/answers.json 파일로 pause/resume한다.
  let clarifications = "";
  if (state.interview) {
    const step = getStepState(state, "interviewer");
    const answers = deps.store.loadInterviewAnswers(runId);

    if (answers === null) {
      // 아직 답변 없음 — 질문을 생성(또는 재사용)하고, 물어볼 게 있으면 일시 중지한다
      let questions = deps.store.loadInterviewQuestions(runId);
      if (questions === null) {
        step.status = "pending";
        step.startedAt = new Date().toISOString();
        delete step.completedAt;
        delete step.failedAt;
        delete step.errorMessage;
        deps.store.saveRun(state);
        log("[pipeline] interviewer: 실행 시작");
        try {
          questions = await runInterviewer({ gemini: deps.gemini }, idea);
        } catch (error) {
          // 질문 생성 실패는 진짜 에러다 (pause와 구분)
          step.status = "error";
          step.errorMessage =
            error instanceof Error ? error.message : String(error);
          step.failedAt = new Date().toISOString();
          deps.store.saveRun(state);
          throw new PipelineStepError(runId, "interviewer", error);
        }
        deps.store.saveInterviewQuestions(runId, questions);
      }

      if (questions.questions.length > 0) {
        // 모호 & 미답변 → 답변 대기(waiting)로 일시 중지. 에러 아님, completedAt 세팅 안 함.
        step.status = "waiting";
        deps.store.saveRun(state);
        log("[pipeline] interviewer: 답변 대기 — 일시 중지");
        return { runId, state, status: "waiting" };
      }

      // 물어볼 게 없음(명확한 아이디어) → 그대로 진행
      step.status = "completed";
      step.completedAt = new Date().toISOString();
      deps.store.saveRun(state);
      log("[pipeline] interviewer: 질문 없음 — 진행");
    } else {
      // 답변 제출됨 → interviewer 완료 처리하고 답변을 맥락으로 반영
      if (step.status !== "completed") {
        step.status = "completed";
        step.completedAt = new Date().toISOString();
        deps.store.saveRun(state);
      }
      clarifications = formatClarifications(
        deps.store.loadInterviewQuestions(runId),
        answers,
      );
    }
  }

  const context = await executeStep("context-hunter", MarketContextSchema, () =>
    runContextHunter(
      { gemini: deps.gemini, youtube: deps.youtube },
      idea,
      clarifications || undefined,
    ),
  );
  const thesis = await executeStep("thesis", ThesisSchema, () =>
    runThesis({ gemini: deps.gemini }, idea, context),
  );
  const criticism = await executeStep("cold-critic", CriticismSchema, () =>
    runColdCritic({ gemini: deps.gemini }, idea, context, thesis),
  );
  const solution = await executeStep("solution-designer", SolutionSchema, () =>
    runSolutionDesigner({ gemini: deps.gemini }, idea, context, criticism, thesis),
  );

  const reportPath = deps.store.saveReport(
    runId,
    renderReport(idea, context, thesis, criticism, solution),
  );
  if (state.completedAt === undefined) {
    state.completedAt = new Date().toISOString();
  }
  deps.store.saveRun(state);
  log(`[pipeline] 리포트 생성 완료: ${reportPath}`);

  return { runId, reportPath, state, status: "completed" };
}
