import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore, STEP_OUTPUT_FILES } from "../lib/runStore.js";
import type { GeminiService } from "../services/gemini.js";
import type { YoutubeService } from "../services/youtube.js";
import {
  CriticismSchema,
  InterviewQuestionsSchema,
  MarketContextSchema,
  SolutionSchema,
  ThesisSchema,
  type Criticism,
  type InterviewQuestions,
  type MarketContext,
  type Solution,
  type Thesis,
} from "../types/index.js";
import {
  PipelineStepError,
  runPipeline,
  type PipelineDeps,
} from "./orchestrator.js";

const IDEA = "AI 반려식물 관리 서비스";

const marketContext: MarketContext = {
  ideaTitle: "AI 반려식물 관리 서비스",
  trends: ["홈가드닝 시장 성장"],
  competitors: [{ name: "Planta", description: "식물 관리 앱" }],
  youtubeVoices: [
    {
      videoTitle: "식물 키우기 실패담",
      videoUrl: "https://youtube.com/watch?v=abc",
      comment: "물주기 타이밍을 늘 놓쳐요",
    },
  ],
  painPointEvidence: ["물주기 실패로 식물을 죽인 경험"],
  sources: ["https://example.com/trend"],
};

const thesis: Thesis = {
  revenueModel: "무료 진단 후 케어 플랜 구독 전환",
  growthLevers: ["공유 바이럴 루프"],
  marketTailwinds: ["홈가드닝 시장 성장"],
  bestCaseScenario: "2년 내 구독 전환율 8% 달성",
  winningThesis: "실패 없는 케어 가치가 유료 전환을 이끈다",
};

const criticism: Criticism = {
  painPointReality: [
    { claim: "페인포인트가 약하다", evidence: "댓글 근거", severity: "major" },
  ],
  bmWeakness: [
    { claim: "지불 의사가 낮다", evidence: "무료 대체재 존재", severity: "fatal" },
  ],
  copycatRisk: [
    { claim: "진입장벽이 없다", evidence: "기존 앱이 기능 추가 가능", severity: "major" },
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

interface FakeGemini {
  gemini: GeminiService;
  generateStructured: ReturnType<typeof vi.fn>;
}

/** schema 파라미터로 어떤 step의 호출인지 판별해 해당 산출물을 돌려주는 fake */
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
      if (schema === MarketContextSchema) return Promise.resolve(marketContext);
      if (schema === ThesisSchema) return Promise.resolve(thesis);
      if (schema === CriticismSchema) return Promise.resolve(criticism);
      if (schema === SolutionSchema) return Promise.resolve(solution);
      return Promise.reject(new Error("예상하지 못한 스키마"));
    },
  );
  return {
    gemini: { generateStructured } as unknown as GeminiService,
    generateStructured,
  };
}

function fakeYoutube(): YoutubeService {
  return {
    collectVoices: vi.fn().mockResolvedValue([]),
  } as unknown as YoutubeService;
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
    return { store, gemini, youtube: fakeYoutube(), log: () => undefined };
  }

  it("신규 run(CLI): 인터뷰 없이 정반합 4개 step을 순서대로 실행하고 리포트를 생성한다", async () => {
    const { gemini, generateStructured } = fakeGemini();

    const result = await runPipeline(makeDeps(gemini), { idea: IDEA });

    expect(result.status).toBe("completed");

    // step 순서: context-hunter → thesis → cold-critic → solution-designer (interviewer는 CLI에서 미실행)
    expect(calledSchemas(generateStructured)).toEqual([
      MarketContextSchema,
      ThesisSchema,
      CriticismSchema,
      SolutionSchema,
    ]);

    // state 전이: 전 step completed + 타임스탬프, run 완료 시각 기록
    const saved = store.loadRun(result.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
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

    // 리포트 생성
    expect(result.reportPath).toBe(path.join(runDir, "report.md"));
    const report = fs.readFileSync(
      result.reportPath ?? "",
      "utf-8",
    );
    expect(report).toContain("# [컨설팅 리포트]");
    expect(report).toContain(solution.revisedConcept);
  });

  it("cold-critic step 실패: state에 error를 기록하고 PipelineStepError를 던진다", async () => {
    const { gemini } = fakeGemini({ failOn: CriticismSchema });

    const promise = runPipeline(makeDeps(gemini), { idea: IDEA });
    await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
    const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
    expect(error.step).toBe("cold-critic");

    // context-hunter·thesis는 완료, cold-critic 에러, solution-designer 대기
    const saved = store.loadRun(error.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
      "completed",
      "completed",
      "error",
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
    const youtube = fakeYoutube();
    const result = await runPipeline(
      { store, gemini: second.gemini, youtube, log: () => undefined },
      { idea: IDEA, resumeRunId: error.runId },
    );

    expect(result.runId).toBe(error.runId);
    // context-hunter·thesis는 1차에서 completed → skip, cold-critic·solution만 재실행
    expect(calledSchemas(second.generateStructured)).toEqual([
      CriticismSchema,
      SolutionSchema,
    ]);
    expect(youtube.collectVoices).not.toHaveBeenCalled();

    const saved = store.loadRun(result.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
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

    // context-hunter는 재실행, 산출물이 멀쩡한 나머지 step은 skip
    expect(calledSchemas(second.generateStructured)).toEqual([
      MarketContextSchema,
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
        MarketContextSchema,
        ThesisSchema,
        CriticismSchema,
        SolutionSchema,
      ]);

      // context-hunter 프롬프트에 답변이 반영된다
      const contextCall = second.generateStructured.mock.calls.find(
        (call) => (call[0] as { schema: unknown }).schema === MarketContextSchema,
      );
      const prompt = (contextCall?.[0] as { prompt: string }).prompt;
      expect(prompt).toContain("바쁜 1인 가구 직장인");

      const saved = store.loadRun(runId);
      expect(saved.steps.find((s) => s.name === "interviewer")?.status).toBe(
        "completed",
      );
      expect(saved.completedAt).toBeDefined();
    });

    it("명확한 아이디어: 질문이 없으면 pause 없이 바로 완료한다", async () => {
      // 기본 fakeGemini는 questions 미지정 → 빈 배열 반환
      const { gemini, generateStructured } = fakeGemini();
      const { runId } = store.createRun(IDEA, { interview: true });

      const result = await runPipeline(makeDeps(gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      expect(result.status).toBe("completed");
      expect(calledSchemas(generateStructured)).toEqual([
        InterviewQuestionsSchema,
        MarketContextSchema,
        ThesisSchema,
        CriticismSchema,
        SolutionSchema,
      ]);
      expect(store.loadRun(runId).completedAt).toBeDefined();
    });
  });
});
