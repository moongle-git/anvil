import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CriticismSchema,
  MarketContextSchema,
  PIPELINE_STEPS,
  RunStateSchema,
  SolutionSchema,
  type Criticism,
  type MarketContext,
  type Solution,
} from "../types/index.js";
import { RunStore, STEP_OUTPUT_FILES } from "./runStore.js";

const validMarketContext: MarketContext = {
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

const validCriticism: Criticism = {
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

const validSolution: Solution = {
  minimalInput: "사진 한 장 입력",
  agenticWorkflow: "에이전트가 관리 일정 자동 생성",
  dataFlywheel: "식물 상태 데이터 축적",
  monetization: "구독 모델",
  revisedConcept: "제로 UI 식물 집사",
};

describe("RunStore", () => {
  let baseDir: string;
  let store: RunStore;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-runstore-"));
    store = new RunStore(baseDir);
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  describe("createRun", () => {
    it("creates runs/{id}/ with a valid initial state.json", () => {
      const state = store.createRun("AI 반려식물 관리 서비스");

      expect(RunStateSchema.parse(state)).toEqual(state);
      expect(state.idea).toBe("AI 반려식물 관리 서비스");

      const statePath = path.join(baseDir, state.runId, "state.json");
      expect(fs.existsSync(statePath)).toBe(true);

      const onDisk = RunStateSchema.parse(
        JSON.parse(fs.readFileSync(statePath, "utf-8")),
      );
      expect(onDisk).toEqual(state);
    });

    it("initializes every pipeline step as pending", () => {
      const state = store.createRun("아이디어");

      expect(state.steps.map((s) => s.name)).toEqual([...PIPELINE_STEPS]);
      expect(state.steps.every((s) => s.status === "pending")).toBe(true);
    });

    it("generates unique runIds for repeated calls", () => {
      const a = store.createRun("같은 아이디어");
      const b = store.createRun("같은 아이디어");

      expect(a.runId).not.toBe(b.runId);
    });
  });

  describe("loadRun", () => {
    it("round-trips the state created by createRun", () => {
      const created = store.createRun("아이디어");

      expect(store.loadRun(created.runId)).toEqual(created);
    });

    it("throws a clear error when the run does not exist", () => {
      expect(() => store.loadRun("no-such-run")).toThrow(/no-such-run/);
    });

    it("throws when state.json fails schema validation", () => {
      const created = store.createRun("아이디어");
      const statePath = path.join(baseDir, created.runId, "state.json");
      fs.writeFileSync(statePath, JSON.stringify({ runId: created.runId }));

      expect(() => store.loadRun(created.runId)).toThrow();
    });
  });

  describe("saveRun", () => {
    it("persists updates so loadRun reflects them", () => {
      const state = store.createRun("아이디어");
      const updated = {
        ...state,
        steps: state.steps.map((s, i) =>
          i === 0 ? { ...s, status: "completed" as const } : s,
        ),
      };

      store.saveRun(updated);

      expect(store.loadRun(state.runId)).toEqual(updated);
    });

    it("is idempotent — saving the same state twice yields the same result", () => {
      const state = store.createRun("아이디어");

      store.saveRun(state);
      store.saveRun(state);

      expect(store.loadRun(state.runId)).toEqual(state);
    });

    it("does not leave temp files behind (atomic write)", () => {
      const state = store.createRun("아이디어");
      store.saveRun(state);

      const files = fs.readdirSync(path.join(baseDir, state.runId));
      expect(files).toEqual(["state.json"]);
    });
  });

  describe("saveStepOutput / loadStepOutput", () => {
    it("maps each step to its output filename", () => {
      expect(STEP_OUTPUT_FILES).toEqual({
        "context-hunter": "context.json",
        "cold-critic": "criticism.json",
        "solution-designer": "solution.json",
      });
    });

    it("saves each step output under its mapped filename", () => {
      const { runId } = store.createRun("아이디어");

      store.saveStepOutput(runId, "context-hunter", validMarketContext);
      store.saveStepOutput(runId, "cold-critic", validCriticism);
      store.saveStepOutput(runId, "solution-designer", validSolution);

      const runDir = path.join(baseDir, runId);
      expect(fs.existsSync(path.join(runDir, "context.json"))).toBe(true);
      expect(fs.existsSync(path.join(runDir, "criticism.json"))).toBe(true);
      expect(fs.existsSync(path.join(runDir, "solution.json"))).toBe(true);
    });

    it("round-trips a step output through schema validation", () => {
      const { runId } = store.createRun("아이디어");
      store.saveStepOutput(runId, "context-hunter", validMarketContext);

      const loaded = store.loadStepOutput(
        runId,
        "context-hunter",
        MarketContextSchema,
      );
      expect(loaded).toEqual(validMarketContext);
    });

    it("is idempotent — saving the same output twice yields the same file", () => {
      const { runId } = store.createRun("아이디어");

      store.saveStepOutput(runId, "cold-critic", validCriticism);
      store.saveStepOutput(runId, "cold-critic", validCriticism);

      expect(store.loadStepOutput(runId, "cold-critic", CriticismSchema)).toEqual(
        validCriticism,
      );
    });

    it("returns null when the output file does not exist", () => {
      const { runId } = store.createRun("아이디어");

      expect(
        store.loadStepOutput(runId, "solution-designer", SolutionSchema),
      ).toBeNull();
    });

    it("returns null (not throw) when the file is corrupted JSON", () => {
      const { runId } = store.createRun("아이디어");
      fs.writeFileSync(path.join(baseDir, runId, "context.json"), "{ not json");

      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
    });

    it("returns null (not throw) when the file fails schema validation", () => {
      const { runId } = store.createRun("아이디어");
      fs.writeFileSync(
        path.join(baseDir, runId, "criticism.json"),
        JSON.stringify({ verdict: "근거 없는 낙관" }),
      );

      expect(
        store.loadStepOutput(runId, "cold-critic", CriticismSchema),
      ).toBeNull();
    });

    it("works with an arbitrary zod schema", () => {
      const { runId } = store.createRun("아이디어");
      const schema = z.object({ foo: z.string() });
      store.saveStepOutput(runId, "context-hunter", { foo: "bar" });

      expect(store.loadStepOutput(runId, "context-hunter", schema)).toEqual({
        foo: "bar",
      });
    });
  });

  describe("saveReport", () => {
    it("writes report.md and returns its absolute path", () => {
      const { runId } = store.createRun("아이디어");
      const markdown = "# [컨설팅 리포트] 아이디어\n";

      const reportPath = store.saveReport(runId, markdown);

      expect(path.isAbsolute(reportPath)).toBe(true);
      expect(reportPath).toBe(path.resolve(baseDir, runId, "report.md"));
      expect(fs.readFileSync(reportPath, "utf-8")).toBe(markdown);
    });

    it("is idempotent — saving the same report twice yields the same content", () => {
      const { runId } = store.createRun("아이디어");
      const markdown = "# 리포트\n";

      store.saveReport(runId, markdown);
      const reportPath = store.saveReport(runId, markdown);

      expect(fs.readFileSync(reportPath, "utf-8")).toBe(markdown);
    });
  });
});
