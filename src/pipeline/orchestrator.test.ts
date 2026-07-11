import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore, STEP_OUTPUT_FILES } from "../lib/runStore.js";
import type { ResearchSource } from "../research/types.js";
import type { GeminiService } from "../services/gemini.js";
import {
  CriticismSchema,
  InterviewQuestionsSchema,
  MarketContextDraftSchema,
  MarketContextSchema,
  RESEARCH_SOURCE_IDS,
  SearchQueriesSchema,
  SolutionSchema,
  SOURCE_LABELS,
  ThesisSchema,
  VerdictSchema,
  type Criticism,
  type InterviewQuestions,
  type MarketContext,
  type SearchQueries,
  type Solution,
  type Thesis,
  type Verdict,
} from "../types/index.js";
import {
  PipelineStepError,
  runPipeline,
  type PipelineDeps,
} from "./orchestrator.js";

const IDEA = "AI 반려식물 관리 서비스";

const marketContext: MarketContext = {
  ideaTitle: "AI 반려식물 관리 서비스",
  briefing: "홈가드닝 시장은 성장 중이나 무료 리마인더 앱이 이미 시장을 선점했다.",
  marketSizeIndicators: ["홈가드닝 시장 연 10% 성장"],
  competitorInsight: "리마인더는 평준화됐고 경쟁은 진단 정확도에서 벌어진다.",
  voicesInsight: "유저는 늦은 감지를 가장 큰 고통으로 말한다.",
  trends: ["홈가드닝 시장 성장"],
  competitors: [{ name: "Planta", description: "식물 관리 앱" }],
  communityVoices: [
    {
      source: "youtube",
      title: "식물 키우기 실패담",
      url: "https://youtube.com/watch?v=abc",
      text: "물주기 타이밍을 늘 놓쳐요",
    },
  ],
  painPointEvidence: ["물주기 실패로 식물을 죽인 경험"],
  sources: ["https://example.com/trend"],
  citations: [],
};

const thesis: Thesis = {
  points: [
    {
      id: "t1",
      axis: "painPoint",
      claim: "식물을 죽인 경험은 반복되는 고통이다",
      rationale: "댓글 '물주기 타이밍을 늘 놓쳐요'가 반복 등장한다",
    },
    {
      id: "t2",
      axis: "bm",
      claim: "실패 방지에는 지불 의사가 생긴다",
      rationale: "Planta가 유료 구독으로 시장을 검증했다",
    },
    {
      id: "t3",
      axis: "copycat",
      claim: "가정별 생육 데이터가 해자가 된다",
      rationale: "경쟁 앱은 개별 환경 데이터를 축적하지 않는다",
    },
  ],
  revenueModel: "무료 진단 후 케어 플랜 구독 전환",
  growthLevers: ["공유 바이럴 루프"],
  marketTailwinds: ["홈가드닝 시장 성장"],
  bestCaseScenario: "2년 내 구독 전환율 8% 달성",
  winningThesis: "실패 없는 케어 가치가 유료 전환을 이끈다",
};

const criticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      rebuts: "t1",
      claim: "페인포인트가 약하다",
      evidence: "댓글 근거",
      severity: "major",
      riskScore: 50,
      riskKeyword: "약한 페인포인트",
    },
    {
      id: "c2",
      axis: "bm",
      rebuts: "t2",
      claim: "지불 의사가 낮다",
      evidence: "무료 대체재 존재",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "무료 대체재",
    },
    {
      id: "c3",
      axis: "copycat",
      rebuts: "t3",
      claim: "진입장벽이 없다",
      evidence: "기존 앱이 기능 추가 가능",
      severity: "major",
      riskScore: 60,
      riskKeyword: "해자 부재",
    },
  ],
  verdict: "현재 형태로는 실패 확률이 높다",
};

const solution: Solution = {
  minimalInput: "사진 한 장 입력",
  agenticWorkflow: "에이전트가 관리 일정 자동 생성",
  dataFlywheel: "식물 상태 데이터 축적",
  monetization: "구독 모델",
  revisedConcept: "제로 UI 식물 집사",
  synthesis: "낙관과 비판을 종합하면 데이터 축적이 핵심 해자다",
};

const verdict: Verdict = {
  survivalScore: 55,
  recommendation: "pivot",
  headline: "원안으로는 죽고, 생존 보장 구독으로 피벗하면 산다",
  rationale: "무료 대체재 비판은 보장형 과금으로 우회했으나 해자는 여전히 얕다",
  residualRisks: [
    {
      keyword: "해자 부재",
      severity: "major",
      note: "기존 앱이 동일 기능을 추가하면 차별점이 사라진다",
    },
  ],
  conditions: ["출시 6개월 내 리텐션 D30 20% 확보"],
};

interface FakeGemini {
  gemini: GeminiService;
  generateStructured: ReturnType<typeof vi.fn>;
  generateGrounded: ReturnType<typeof vi.fn>;
}

/** researchPlanner 산출물 — pipeline step이 아니라 context-hunter 내부 호출이다 (ADR-012) */
const searchQueries: SearchQueries = {
  youtube: "식물 죽이는 이유",
  hackernews: "plant care app",
  naver: "화분 물주기 실패",
  web: ["홈가드닝 시장 규모"],
};

/**
 * schema 파라미터로 어떤 step의 호출인지 판별해 해당 산출물을 돌려주는 fake.
 * context-hunter만 generateGrounded를 쓰고, LLM이 채우는 draft(citations 제외)를 돌려받는다 (ADR-012).
 * failOn은 두 메서드 모두에 적용된다 — 어느 경로로 호출되든 그 step이 실패해야 한다.
 */
function fakeGemini(options?: {
  failOn?: unknown;
  questions?: InterviewQuestions;
}): FakeGemini {
  const generateStructured = vi.fn(
    ({ schema }: { schema: unknown }): Promise<unknown> => {
      if (schema === options?.failOn) {
        return Promise.reject(new Error("Gemini 호출 실패"));
      }
      if (schema === InterviewQuestionsSchema) {
        return Promise.resolve(options?.questions ?? { questions: [] });
      }
      if (schema === SearchQueriesSchema) return Promise.resolve(searchQueries);
      if (schema === ThesisSchema) return Promise.resolve(thesis);
      if (schema === CriticismSchema) return Promise.resolve(criticism);
      if (schema === SolutionSchema) return Promise.resolve(solution);
      if (schema === VerdictSchema) return Promise.resolve(verdict);
      return Promise.reject(new Error("예상하지 못한 스키마"));
    },
  );

  const generateGrounded = vi.fn(
    ({ schema }: { schema: unknown }): Promise<unknown> => {
      if (schema === options?.failOn) {
        return Promise.reject(new Error("Gemini 호출 실패"));
      }
      if (schema === MarketContextDraftSchema) {
        const { citations, ...draft } = marketContext;
        return Promise.resolve({
          data: draft,
          citations,
          webSearchQueries: [],
        });
      }
      return Promise.reject(new Error("예상하지 못한 스키마"));
    },
  );

  return {
    gemini: { generateStructured, generateGrounded } as unknown as GeminiService,
    generateStructured,
    generateGrounded,
  };
}

/** 자료조사 소스 3종. 수집 결과는 비어 있어도 파이프라인은 웹검색만으로 완주한다 */
function fakeSources(): ResearchSource[] {
  return RESEARCH_SOURCE_IDS.map((id) => ({
    id,
    label: SOURCE_LABELS[id],
    collect: vi.fn().mockResolvedValue([]),
  }));
}

function calledSchemas(generateStructured: ReturnType<typeof vi.fn>): unknown[] {
  return generateStructured.mock.calls.map(
    (call) => (call[0] as { schema: unknown }).schema,
  );
}

describe("runPipeline", () => {
  let baseDir: string;
  let store: RunStore;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-pipeline-"));
    store = new RunStore(baseDir);
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeDeps(gemini: GeminiService): PipelineDeps {
    return { store, gemini, sources: fakeSources(), log: () => undefined };
  }

  it("신규 run(CLI): 인터뷰 없이 정반합·판정 5개 step을 순서대로 실행하고 리포트를 생성한다", async () => {
    const { gemini, generateStructured, generateGrounded } = fakeGemini();

    const result = await runPipeline(makeDeps(gemini), { idea: IDEA });

    expect(result.status).toBe("completed");

    // step 순서: context-hunter → thesis → cold-critic → solution-designer → verdict
    // (interviewer는 CLI에서 미실행). verdict는 合을 채점하므로 반드시 solution-designer 다음이다 (ADR-010).
    // SearchQueriesSchema는 step이 아니라 context-hunter 내부의 researchPlanner 호출이다 (ADR-012) —
    // PIPELINE_STEPS는 여전히 6개다.
    expect(calledSchemas(generateStructured)).toEqual([
      SearchQueriesSchema,
      ThesisSchema,
      CriticismSchema,
      SolutionSchema,
      VerdictSchema,
    ]);
    // context-hunter만 grounding 경로다 (인용을 코드가 추출해야 하므로)
    expect(calledSchemas(generateGrounded)).toEqual([MarketContextDraftSchema]);

    // state 전이: 실행된 step은 completed + 타임스탬프, run 완료 시각 기록
    const saved = store.loadRun(result.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    for (const step of saved.steps) {
      expect(step.startedAt).toBeDefined();
      expect(step.completedAt).toBeDefined();
    }
    expect(saved.completedAt).toBeDefined();

    // 산출물 파일 persist
    const runDir = path.join(baseDir, result.runId);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(runDir, STEP_OUTPUT_FILES["context-hunter"]),
          "utf-8",
        ),
      ),
    ).toEqual(marketContext);
    expect(STEP_OUTPUT_FILES.verdict).toBe("verdict.json");
    expect(
      JSON.parse(
        fs.readFileSync(path.join(runDir, STEP_OUTPUT_FILES.verdict), "utf-8"),
      ),
    ).toEqual(verdict);

    // 리포트 생성
    expect(result.reportPath).toBe(path.join(runDir, "report.md"));
    const report = fs.readFileSync(
      result.reportPath ?? "",
      "utf-8",
    );
    expect(report).toContain("# [컨설팅 리포트]");
    expect(report).toContain(solution.revisedConcept);
    expect(report).toContain(verdict.headline);
  });

  it("verdict step 실패: state에 error를 기록하고 리포트도 completedAt도 남기지 않는다", async () => {
    const { gemini } = fakeGemini({ failOn: VerdictSchema });

    const promise = runPipeline(makeDeps(gemini), { idea: IDEA });
    await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
    const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
    expect(error.step).toBe("verdict");

    const saved = store.loadRun(error.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "error",
    ]);
    expect(saved.steps[4].errorMessage).toContain("Gemini 호출 실패");
    expect(saved.steps[4].failedAt).toBeDefined();
    // 판정 없이 완료로 표시되면 안 된다 — 리포트의 결론이 비어 버린다
    expect(saved.completedAt).toBeUndefined();
    expect(fs.existsSync(path.join(baseDir, error.runId, "report.md"))).toBe(
      false,
    );
  });

  it("resume: completed인 verdict step은 저장된 verdict.json을 재사용하고 재실행하지 않는다", async () => {
    const first = fakeGemini();
    const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

    const second = fakeGemini();
    await runPipeline(makeDeps(second.gemini), {
      idea: IDEA,
      resumeRunId: runId,
    });

    expect(calledSchemas(second.generateStructured)).toEqual([]);
    expect(second.generateGrounded).not.toHaveBeenCalled();
    expect(store.loadStepOutput(runId, "verdict", VerdictSchema)).toEqual(
      verdict,
    );
  });

  it("verdict.json이 손상되면 completed 상태여도 verdict step만 재실행한다", async () => {
    const first = fakeGemini();
    const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

    // 스키마 검증에 실패하는 산출물 (survivalScore가 recommendation 밴드와 모순)
    fs.writeFileSync(
      path.join(baseDir, runId, STEP_OUTPUT_FILES.verdict),
      JSON.stringify({ ...verdict, survivalScore: 5 }),
      "utf-8",
    );

    const second = fakeGemini();
    await runPipeline(makeDeps(second.gemini), {
      idea: IDEA,
      resumeRunId: runId,
    });

    expect(calledSchemas(second.generateStructured)).toEqual([VerdictSchema]);
    expect(store.loadStepOutput(runId, "verdict", VerdictSchema)).toEqual(
      verdict,
    );
  });

  it("cold-critic step 실패: state에 error를 기록하고 PipelineStepError를 던진다", async () => {
    const { gemini } = fakeGemini({ failOn: CriticismSchema });

    const promise = runPipeline(makeDeps(gemini), { idea: IDEA });
    await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
    const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
    expect(error.step).toBe("cold-critic");

    // context-hunter·thesis는 완료, cold-critic 에러, solution-designer·verdict 미실행
    const saved = store.loadRun(error.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
      "completed",
      "completed",
      "error",
      "pending",
      "pending",
    ]);
    expect(saved.steps[2].errorMessage).toContain("Gemini 호출 실패");
    expect(saved.steps[2].failedAt).toBeDefined();
    expect(saved.completedAt).toBeUndefined();
  });

  it("resume: completed step은 건너뛰고 저장된 산출물을 재사용한다", async () => {
    // 1차 실행 — cold-critic에서 실패
    const first = fakeGemini({ failOn: CriticismSchema });
    const error = (await runPipeline(makeDeps(first.gemini), {
      idea: IDEA,
    }).catch((e: unknown) => e)) as PipelineStepError;

    // 2차 실행 (resume) — context-hunter는 skip, 나머지만 실행
    const second = fakeGemini();
    const sources = fakeSources();
    const result = await runPipeline(
      { store, gemini: second.gemini, sources, log: () => undefined },
      { idea: IDEA, resumeRunId: error.runId },
    );

    expect(result.runId).toBe(error.runId);
    // context-hunter·thesis는 1차에서 completed → skip, cold-critic 이후만 재실행
    expect(calledSchemas(second.generateStructured)).toEqual([
      CriticismSchema,
      SolutionSchema,
      VerdictSchema,
    ]);
    // skip된 step은 어떤 소스도 수집하지 않는다
    for (const source of sources) {
      expect(source.collect).not.toHaveBeenCalled();
    }

    const saved = store.loadRun(result.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(saved.steps[2].errorMessage).toBeUndefined();

    // 리포트는 1차 실행에서 저장된 context 산출물을 재사용해 렌더링된다
    const report = fs.readFileSync(result.reportPath ?? "", "utf-8");
    expect(report).toContain(marketContext.ideaTitle);
  });

  it("산출물 파일이 손상된 completed step은 재실행한다", async () => {
    const first = fakeGemini();
    const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

    // context.json을 손상시킨다 (state.json상 status는 여전히 completed)
    fs.writeFileSync(
      path.join(baseDir, runId, STEP_OUTPUT_FILES["context-hunter"]),
      "깨진 JSON{{{",
      "utf-8",
    );

    const second = fakeGemini();
    await runPipeline(makeDeps(second.gemini), {
      idea: IDEA,
      resumeRunId: runId,
    });

    // context-hunter는 재실행(그 안에서 planner도 다시 돈다), 산출물이 멀쩡한 나머지 step은 skip
    expect(calledSchemas(second.generateStructured)).toEqual([
      SearchQueriesSchema,
    ]);
    expect(calledSchemas(second.generateGrounded)).toEqual([
      MarketContextDraftSchema,
    ]);

    // 재실행으로 산출물이 복구된다
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(baseDir, runId, STEP_OUTPUT_FILES["context-hunter"]),
          "utf-8",
        ),
      ),
    ).toEqual(marketContext);
  });

  describe("인터뷰 (웹 흐름)", () => {
    const QUESTIONS: InterviewQuestions = {
      questions: [
        { id: "q1", question: "핵심 타깃은 누구인가?", why: "검증 방향" },
      ],
    };

    it("모호한 아이디어: 질문을 생성하고 waiting으로 일시 중지한다 (하류 미실행)", async () => {
      const { gemini, generateStructured } = fakeGemini({
        questions: QUESTIONS,
      });
      const { runId } = store.createRun(IDEA, { interview: true });

      const result = await runPipeline(makeDeps(gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      expect(result.status).toBe("waiting");
      expect(result.reportPath).toBeUndefined();

      // 질문만 생성되고 하류 에이전트는 호출되지 않는다
      expect(calledSchemas(generateStructured)).toEqual([
        InterviewQuestionsSchema,
      ]);
      expect(store.loadInterviewQuestions(runId)).toEqual(QUESTIONS);

      const saved = store.loadRun(runId);
      const interviewer = saved.steps.find((s) => s.name === "interviewer");
      expect(interviewer?.status).toBe("waiting");
      expect(saved.completedAt).toBeUndefined();
      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
    });

    it("답변 제출 후 resume: 답변을 반영해 파이프라인을 끝까지 완료한다", async () => {
      // 1차: 질문 생성 → waiting
      const first = fakeGemini({ questions: QUESTIONS });
      const { runId } = store.createRun(IDEA, { interview: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      // 사용자가 답변 제출
      store.saveInterviewAnswers(runId, {
        answers: [{ questionId: "q1", answer: "바쁜 1인 가구 직장인" }],
      });

      // 2차: resume → 인터뷰 완료 처리 후 정반합 실행
      const second = fakeGemini();
      const result = await runPipeline(makeDeps(second.gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      expect(result.status).toBe("completed");
      expect(calledSchemas(second.generateStructured)).toEqual([
        SearchQueriesSchema,
        ThesisSchema,
        CriticismSchema,
        SolutionSchema,
        VerdictSchema,
      ]);

      // context-hunter 프롬프트에 답변이 반영된다
      const contextCall = second.generateGrounded.mock.calls[0];
      const prompt = (contextCall[0] as { prompt: string }).prompt;
      expect(prompt).toContain("바쁜 1인 가구 직장인");

      // 답변은 검색어에도 반영된다 — planner 프롬프트까지 흘러야 한다
      const plannerCall = second.generateStructured.mock.calls[0];
      expect((plannerCall[0] as { prompt: string }).prompt).toContain(
        "바쁜 1인 가구 직장인",
      );

      const saved = store.loadRun(runId);
      expect(saved.steps.find((s) => s.name === "interviewer")?.status).toBe(
        "completed",
      );
      expect(saved.completedAt).toBeDefined();
    });

    it("명확한 아이디어: 질문이 없으면 pause 없이 바로 완료한다", async () => {
      // 기본 fakeGemini는 questions 미지정 → 빈 배열 반환
      const { gemini, generateStructured, generateGrounded } = fakeGemini();
      const { runId } = store.createRun(IDEA, { interview: true });

      const result = await runPipeline(makeDeps(gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      expect(result.status).toBe("completed");
      expect(calledSchemas(generateStructured)).toEqual([
        InterviewQuestionsSchema,
        SearchQueriesSchema,
        ThesisSchema,
        CriticismSchema,
        SolutionSchema,
        VerdictSchema,
      ]);
      expect(calledSchemas(generateGrounded)).toEqual([MarketContextDraftSchema]);
      expect(store.loadRun(runId).completedAt).toBeDefined();
    });
  });
});
