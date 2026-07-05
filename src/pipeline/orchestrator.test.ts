import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore, STEP_OUTPUT_FILES } from "../lib/runStore.js";
import type { GeminiService } from "../services/gemini.js";
import type { YoutubeService } from "../services/youtube.js";
import {
  CriticismSchema,
  MarketContextSchema,
  SolutionSchema,
  type Criticism,
  type MarketContext,
  type Solution,
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
};

interface FakeGemini {
  gemini: GeminiService;
  generateStructured: ReturnType<typeof vi.fn>;
}

/** schema 파라미터로 어떤 step의 호출인지 판별해 해당 산출물을 돌려주는 fake */
function fakeGemini(options?: { failOn?: unknown }): FakeGemini {
  const generateStructured = vi.fn(
    ({ schema }: { schema: unknown }): Promise<unknown> => {
      if (schema === options?.failOn) {
        return Promise.reject(new Error("Gemini 호출 실패"));
      }
      if (schema === MarketContextSchema) return Promise.resolve(marketContext);
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

  it("신규 run: 세 step을 순서대로 실행하고 산출물·상태를 persist한 뒤 리포트를 생성한다", async () => {
    const { gemini, generateStructured } = fakeGemini();

    const result = await runPipeline(makeDeps(gemini), { idea: IDEA });

    // step 순서: context-hunter → cold-critic → solution-designer
    expect(calledSchemas(generateStructured)).toEqual([
      MarketContextSchema,
      CriticismSchema,
      SolutionSchema,
    ]);

    // state 전이: 전 step completed + 타임스탬프, run 완료 시각 기록
    const saved = store.loadRun(result.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
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
    const report = fs.readFileSync(result.reportPath, "utf-8");
    expect(report).toContain("# [컨설팅 리포트]");
    expect(report).toContain(solution.revisedConcept);
  });

  it("2번째 step 실패: state에 error를 기록하고 PipelineStepError를 던진다", async () => {
    const { gemini } = fakeGemini({ failOn: CriticismSchema });

    const promise = runPipeline(makeDeps(gemini), { idea: IDEA });
    await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
    const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
    expect(error.step).toBe("cold-critic");

    const saved = store.loadRun(error.runId);
    expect(saved.steps.map((s) => s.status)).toEqual([
      "completed",
      "error",
      "pending",
    ]);
    expect(saved.steps[1].errorMessage).toContain("Gemini 호출 실패");
    expect(saved.steps[1].failedAt).toBeDefined();
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
    ]);
    expect(saved.steps[1].errorMessage).toBeUndefined();

    // 리포트는 1차 실행에서 저장된 context 산출물을 재사용해 렌더링된다
    const report = fs.readFileSync(result.reportPath, "utf-8");
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
});
