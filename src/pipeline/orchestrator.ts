import type { ZodType } from "zod";
import { runColdCritic } from "../agents/coldCritic.js";
import { runContextHunter } from "../agents/contextHunter.js";
import { runInterviewer } from "../agents/interviewer.js";
import { runSolutionDesigner } from "../agents/solutionDesigner.js";
import { runThesis } from "../agents/thesis.js";
import {
  runTrendScout,
  SCOUT_FULL_SCOPE_LABEL,
} from "../agents/trendScout.js";
import { runVerdict } from "../agents/verdict.js";
import { renderReport } from "../lib/report.js";
import type { RunStore } from "../lib/runStore.js";
import type { ResearchSource } from "../research/types.js";
import type { GeminiService } from "../services/gemini.js";
import {
  CriticismSchema,
  MarketContextSchema,
  ThesisSchema,
  solutionSchemaFor,
  verdictSchemaFor,
  type InterviewAnswers,
  type InterviewQuestions,
  type Opportunity,
  type PipelineStepName,
  type RunState,
  type StepState,
} from "../types/index.js";

export interface PipelineDeps {
  store: RunStore;
  gemini: GeminiService;
  /** 자료조사 소스. 키가 없는 소스는 애초에 배열에서 빠진다 (ADR-012) */
  sources: readonly ResearchSource[];
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
  // 리포트는 파일이 아니라 artifacts(kind='report')에 있다 (ADR-014) — 경로 대신 원문을 돌려준다
  report?: string;
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

/**
 * 후보가 0건일 때 trend-scout step에 남기는 에러 메시지.
 *
 * 근거 없이 후보를 만들지 않은 것은 **설계된 동작**이지 모델의 실패가 아니다 (침묵 게이트).
 * 그래서 메시지는 원인을 모델 탓으로 돌리지 않고, 사용자가 다음에 무엇을 할지를 말한다.
 */
export const SCOUT_NO_CANDIDATES_MESSAGE =
  "자본 흐름 근거를 찾지 못해 후보를 만들지 않았다. 탐색 범위를 바꿔 새 run으로 다시 시도하라.";

/**
 * 선택된 후보 → 하류가 볼 주제 문자열.
 * 하류 에이전트는 idea만 보고 판단하므로 제목만 넘기면 맥락이 통째로 날아간다.
 */
function scoutTopic(candidate: Opportunity): string {
  return `${candidate.title} — ${candidate.whatItIs}`;
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
  const { runId } = state;
  // 스카우트 run의 초기 idea는 주제가 아니라 **범위 힌트**다. 후보가 선택되면 확정 주제로
  // 갈아끼워지므로 재바인딩 가능해야 한다 (아래 주제 발굴 단계).
  let idea = state.idea;

  // 하네스 패턴 (ADR-004): 순차 실행 + 전이마다 saveRun으로 즉시 persist.
  // 프로세스가 죽어도 runs·steps 행이 남아야 resume이 성립한다 (ADR-014).
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

  // ── 주제 발굴 단계 (스카우트 run만; state.scout으로 구동) ──
  // 인터뷰 단계와 같은 모양이다 — detached CLI에는 stdin이 없으므로 opportunities·selection
  // 아티팩트로 pause/resume한다. executeStep으로 감싸지 않는 것도 같은 이유다: pause(waiting)는
  // 성공/실패 이분법에 맞지 않는다.
  //
  // 두 단계는 상호배타적이다 — createRun이 스카우트 run에 interviewer를 seed하지 않는다.
  let selectedOpportunity: Opportunity | undefined;
  if (state.scout) {
    const step = getStepState(state, "trend-scout");
    const selection = deps.store.loadOpportunitySelection(runId);

    /** step을 error로 못박고 올릴 에러를 만든다. throw는 호출부가 한다(제어 흐름을 숨기지 않는다) */
    const scoutFailure = (message: string): PipelineStepError => {
      step.status = "error";
      step.errorMessage = message;
      step.failedAt = new Date().toISOString();
      deps.store.saveRun(state);
      return new PipelineStepError(runId, "trend-scout", new Error(message));
    };

    if (selection === null) {
      // 저장된 후보가 있으면 재사용한다. grounded 검색은 이 파이프라인에서 가장 비싼 종류이고
      // (ADR-016), 사용자가 답을 늦게 주거나 프로세스가 죽어 resume돼도 다시 검색할 이유가
      // 없다 — 인터뷰가 questions를 재사용하는 것과 같다.
      let opportunities = deps.store.loadOpportunities(runId);
      if (opportunities === null) {
        step.status = "pending";
        step.startedAt = new Date().toISOString();
        delete step.completedAt;
        delete step.failedAt;
        delete step.errorMessage;
        deps.store.saveRun(state);
        log("[pipeline] trend-scout: 실행 시작");
        try {
          opportunities = await runTrendScout(
            { gemini: deps.gemini, log },
            // 힌트가 없는 run의 idea는 목록에 보이기 위한 자리표시자이지 범위가 아니다.
            // 그대로 넘기면 플래너가 "전 범위 탐색"이라는 산업을 검색하려 든다.
            idea === SCOUT_FULL_SCOPE_LABEL ? undefined : idea,
            new Date(),
          );
        } catch (error) {
          // 후보 생성 실패는 진짜 에러다 (pause와 구분)
          step.status = "error";
          step.errorMessage =
            error instanceof Error ? error.message : String(error);
          step.failedAt = new Date().toISOString();
          deps.store.saveRun(state);
          throw new PipelineStepError(runId, "trend-scout", error);
        }
        deps.store.saveOpportunities(runId, opportunities);
      }

      // candidates: []는 runTrendScout의 정당한 산출물이지만(근거가 없으면 지어내지 않는다),
      // 파이프라인 관점에서는 고를 것이 없어 진행할 수 없다. waiting으로 두면 사용자가 영원히
      // 고를 수 없는 화면 앞에 놓인다. 빈 결과도 저장된 채로 두므로 resume은 재검색 없이
      // 같은 곳에서 멈춘다 — 재검색을 원하면 새 run을 만드는 것이 맞다.
      if (opportunities.candidates.length === 0) {
        throw scoutFailure(SCOUT_NO_CANDIDATES_MESSAGE);
      }

      // 후보 선택 대기(waiting)로 일시 중지. 에러 아님, completedAt 세팅 안 함.
      step.status = "waiting";
      deps.store.saveRun(state);
      log(
        `[pipeline] trend-scout: 후보 ${opportunities.candidates.length}건 — 선택 대기로 일시 중지`,
      );
      return { runId, state, status: "waiting" };
    }

    const chosen = deps.store
      .loadOpportunities(runId)
      ?.candidates.find((candidate) => candidate.id === selection.candidateId);
    // 첫 후보로 조용히 폴백하지 않는다 — 사용자가 고르지 않은 주제로 파이프라인이 완주해
    // 리포트가 나온다. 조용한 오답이 명시적 실패보다 나쁘다.
    if (chosen === undefined) {
      throw scoutFailure(
        `선택된 후보 '${selection.candidateId}'가 저장된 후보 목록에 없다`,
      );
    }

    selectedOpportunity = chosen;
    // 범위 힌트를 확정 주제로 갈아끼운다. 새 메서드를 만들지 않는다 — saveRun이 이미 idea를
    // UPDATE한다. 같은 선택으로 여러 번 돌아도 같은 값이 되므로 멱등하다.
    idea = scoutTopic(chosen);
    state.idea = idea;
    step.status = "completed";
    step.completedAt ??= new Date().toISOString();
    deps.store.saveRun(state);
    log(`[pipeline] trend-scout: 주제 확정 — ${chosen.title}`);
  }

  // ── 인터뷰 단계 (웹에서 생성된 run만; state.interview로 구동) ──
  // detached CLI에는 stdin이 없으므로 questions·answers 아티팩트로 pause/resume한다.
  // 스카우트 run에서는 돌지 않는다: 한 run에서 사용자를 두 번(후보 선택 → 질문 답변) 멈춰
  // 세우게 되고, 후보는 이미 타깃·수익원이 구조화돼 있어 질문이 중복된다 (createRun의 seeding
  // 규칙과 같은 판단 — 여기서 걸러야 유령 interviewer step이 생기지 않는다).
  let clarifications = "";
  if (state.interview && !state.scout) {
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

  // 선택된 후보는 자료조사에 그대로 넘어간다 — 후보에는 이미 날짜·출처가 붙은 자본 신호가
  // 들어 있어, 그것을 버리고 idea 문자열만 넘기면 시장조사가 같은 사실을 다시 찾아 헤맨다.
  // 실제 인자 전달은 contextHunter의 시그니처가 바뀌는 다음 step의 몫이다.
  void selectedOpportunity;

  // executeStep은 반환값을 그대로 step 산출물로 저장하므로, 수집 증거는 여기서 벗겨내
  // research 아티팩트로 따로 영속화한다 — research는 step 산출물이 아니다 (ADR-013).
  // resume 시 context-hunter가 completed면 run()이 호출되지 않아 research는 재생성되지
  // 않는다. 이미 저장돼 있으므로 정상이다.
  const context = await executeStep(
    "context-hunter",
    MarketContextSchema,
    async () => {
      const { context: marketContext, evidence } = await runContextHunter(
        { gemini: deps.gemini, sources: deps.sources, log },
        idea,
        clarifications || undefined,
      );
      deps.store.saveResearchEvidence(runId, evidence);
      return marketContext;
    },
  );
  const thesis = await executeStep("thesis", ThesisSchema, () =>
    runThesis({ gemini: deps.gemini }, idea, context),
  );
  const criticism = await executeStep("cold-critic", CriticismSchema, () =>
    runColdCritic({ gemini: deps.gemini }, idea, context, thesis),
  );
  // 아래 두 step은 criticism을 아는 팩토리 스키마를 쓴다 (ADR-017). 하류가 상류를 알 뿐,
  // 의존은 파이프라인이 흐르는 방향으로만 흐른다. 그래서 resume이 교차 산출물 정합성까지
  // 재검증한다 — 원장 없이 저장된 구 solution은 loadStepOutput이 null로 돌려주고
  // "산출물이 없거나 손상됨 — 재실행한다" 경로로 자동 이송된다 (ADR-011).
  //
  // 웹 읽기 경로(web/src/lib/server/runs.ts)는 정적 SolutionSchema·VerdictSchema를 계속 쓴다.
  // 관대한 읽기 / 엄격한 쓰기 — 두 단계 엄격도는 설계이지 실수가 아니다. 웹은 criticism 없이도
  // solution을 렌더해야 하고, 웹을 "일관성"을 이유로 팩토리로 바꾸면 원장 이전에 저장된
  // 기존 run이 조용히 빈 화면이 된다.
  const solution = await executeStep(
    "solution-designer",
    solutionSchemaFor(criticism),
    () =>
      runSolutionDesigner(
        { gemini: deps.gemini },
        idea,
        context,
        criticism,
        thesis,
      ),
  );
  // 合을 설계한 당사자가 스스로 채점하면 낙관 편향이 들어간다 — 판정자는 분리한다 (ADR-010)
  const verdict = await executeStep("verdict", verdictSchemaFor(criticism), () =>
    runVerdict({ gemini: deps.gemini }, idea, context, thesis, criticism, solution),
  );

  const report = renderReport(idea, context, thesis, criticism, solution, verdict);
  deps.store.saveReport(runId, report);
  if (state.completedAt === undefined) {
    state.completedAt = new Date().toISOString();
  }
  deps.store.saveRun(state);
  log(`[pipeline] 리포트 생성 완료: run ${runId}`);

  return { runId, report, state, status: "completed" };
}
