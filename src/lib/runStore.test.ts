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
  type RunState,
  type Solution,
} from "../types/index.js";
import { RunStore, STEP_OUTPUT_FILES, deriveRunStatus } from "./runStore.js";

const validMarketContext: MarketContext = {
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

const validCriticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      claim: "페인포인트가 약하다",
      evidence: "댓글 근거",
      severity: "major",
      riskScore: 50,
      riskKeyword: "약한 페인포인트",
    },
    {
      id: "c2",
      axis: "bm",
      claim: "지불 의사가 낮다",
      evidence: "무료 대체재 존재",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "무료 대체재",
    },
    {
      id: "c3",
      axis: "copycat",
      claim: "진입장벽이 없다",
      evidence: "기존 앱이 기능 추가 가능",
      severity: "major",
      riskScore: 60,
      riskKeyword: "해자 부재",
    },
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

    it("CLI 기본(interview 미지정)은 interviewer를 제외한 스텝만 pending으로 seed한다", () => {
      const state = store.createRun("아이디어");

      expect(state.steps.map((s) => s.name)).toEqual([
        "context-hunter",
        "thesis",
        "cold-critic",
        "solution-designer",
        "verdict",
      ]);
      expect(state.steps.every((s) => s.status === "pending")).toBe(true);
      expect(state.interview).toBe(false);
    });

    it("interview:true면 interviewer 스텝까지 seed하고 interview=true를 기록한다", () => {
      const state = store.createRun("아이디어", { interview: true });

      expect(state.steps.map((s) => s.name)).toEqual([...PIPELINE_STEPS]);
      expect(state.steps.every((s) => s.status === "pending")).toBe(true);
      expect(state.interview).toBe(true);
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
        interviewer: "questions.json",
        "context-hunter": "context.json",
        thesis: "thesis.json",
        "cold-critic": "criticism.json",
        "solution-designer": "solution.json",
        verdict: "verdict.json",
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

  describe("interview questions / answers", () => {
    const questions = {
      questions: [
        { id: "q1", question: "핵심 타깃은 누구인가?", why: "UX가 달라진다" },
      ],
    };
    const answers = {
      answers: [{ questionId: "q1", answer: "초보 식집사" }],
    };

    it("saveInterviewQuestions는 questions.json에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      store.saveInterviewQuestions(runId, questions);

      expect(fs.existsSync(path.join(baseDir, runId, "questions.json"))).toBe(
        true,
      );
      expect(store.loadInterviewQuestions(runId)).toEqual(questions);
    });

    it("빈 질문 목록도 왕복한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      store.saveInterviewQuestions(runId, { questions: [] });

      expect(store.loadInterviewQuestions(runId)).toEqual({ questions: [] });
    });

    it("saveInterviewAnswers는 answers.json에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      store.saveInterviewAnswers(runId, answers);

      expect(fs.existsSync(path.join(baseDir, runId, "answers.json"))).toBe(
        true,
      );
      expect(store.loadInterviewAnswers(runId)).toEqual(answers);
    });

    it("loadInterviewAnswers는 파일이 없으면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      expect(store.loadInterviewAnswers(runId)).toBeNull();
    });

    it("loadInterviewAnswers는 손상된 JSON이면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });
      fs.writeFileSync(
        path.join(baseDir, runId, "answers.json"),
        "{ not json",
      );

      expect(store.loadInterviewAnswers(runId)).toBeNull();
    });
  });

  describe("listRuns", () => {
    const MINUTE_MS = 60 * 1000;

    it("returns an empty array when baseDir does not exist", () => {
      const missing = new RunStore(path.join(baseDir, "does-not-exist"));

      expect(missing.listRuns()).toEqual([]);
    });

    it("returns an empty array when baseDir has no runs", () => {
      expect(store.listRuns()).toEqual([]);
    });

    it("summarizes a run with its runId, idea, createdAt and derived status", () => {
      const state = store.createRun("AI 반려식물 관리 서비스");

      const runs = store.listRuns();

      expect(runs).toEqual([
        {
          runId: state.runId,
          idea: "AI 반려식물 관리 서비스",
          createdAt: state.createdAt,
          completedAt: undefined,
          status: "running",
        },
      ]);
    });

    it("derives completed status and exposes completedAt", () => {
      const state = store.createRun("아이디어");
      const completedAt = new Date().toISOString();
      store.saveRun({ ...state, completedAt });

      const runs = store.listRuns();

      expect(runs[0]?.status).toBe("completed");
      expect(runs[0]?.completedAt).toBe(completedAt);
    });

    it("derives error status when any step has errored", () => {
      const state = store.createRun("아이디어");
      store.saveRun({
        ...state,
        steps: state.steps.map((s, i) =>
          i === 1 ? { ...s, status: "error" as const, errorMessage: "boom" } : s,
        ),
      });

      expect(store.listRuns()[0]?.status).toBe("error");
    });

    it("derives stalled status when state.json mtime is older than 15 minutes", () => {
      const state = store.createRun("아이디어");
      const statePath = path.join(baseDir, state.runId, "state.json");
      const old = new Date(Date.now() - 16 * MINUTE_MS);
      fs.utimesSync(statePath, old, old);

      expect(store.listRuns()[0]?.status).toBe("stalled");
    });

    it("derives stalled via injected nowMs without touching the file", () => {
      store.createRun("아이디어");

      expect(store.listRuns(Date.now() + 16 * MINUTE_MS)[0]?.status).toBe(
        "stalled",
      );
    });

    it("skips directories without state.json instead of throwing", () => {
      const state = store.createRun("아이디어");
      fs.mkdirSync(path.join(baseDir, "not-a-run"));

      const runs = store.listRuns();

      expect(runs.map((r) => r.runId)).toEqual([state.runId]);
    });

    it("skips runs whose state.json is corrupted JSON", () => {
      const state = store.createRun("아이디어");
      const broken = store.createRun("깨진 run");
      fs.writeFileSync(
        path.join(baseDir, broken.runId, "state.json"),
        "{ not json",
      );

      const runs = store.listRuns();

      expect(runs.map((r) => r.runId)).toEqual([state.runId]);
    });

    it("skips runs whose state.json fails schema validation", () => {
      const state = store.createRun("아이디어");
      const invalid = store.createRun("스키마 위반 run");
      fs.writeFileSync(
        path.join(baseDir, invalid.runId, "state.json"),
        JSON.stringify({ runId: invalid.runId }),
      );

      const runs = store.listRuns();

      expect(runs.map((r) => r.runId)).toEqual([state.runId]);
    });

    it("ignores plain files in baseDir", () => {
      const state = store.createRun("아이디어");
      fs.writeFileSync(path.join(baseDir, "stray.txt"), "noise");

      expect(store.listRuns().map((r) => r.runId)).toEqual([state.runId]);
    });

    it("sorts runs by createdAt descending (newest first)", () => {
      const a = store.createRun("첫 번째");
      const b = store.createRun("두 번째");
      const c = store.createRun("세 번째");
      store.saveRun({ ...a, createdAt: "2026-07-01T00:00:00.000Z" });
      store.saveRun({ ...b, createdAt: "2026-07-03T00:00:00.000Z" });
      store.saveRun({ ...c, createdAt: "2026-07-02T00:00:00.000Z" });

      expect(store.listRuns().map((r) => r.runId)).toEqual([
        b.runId,
        c.runId,
        a.runId,
      ]);
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

describe("deriveRunStatus", () => {
  const MINUTE_MS = 60 * 1000;
  const NOW_MS = Date.parse("2026-07-06T12:00:00.000Z");

  function makeState(overrides: Partial<RunState> = {}): RunState {
    return {
      runId: "run-1",
      idea: "아이디어",
      createdAt: "2026-07-06T00:00:00.000Z",
      steps: PIPELINE_STEPS.map((name) => ({
        name,
        status: "pending" as const,
      })),
      interview: false,
      ...overrides,
    };
  }

  it("returns completed when completedAt is set, regardless of mtime", () => {
    const state = makeState({ completedAt: "2026-07-06T01:00:00.000Z" });

    expect(deriveRunStatus(state, NOW_MS - 60 * MINUTE_MS, NOW_MS)).toBe(
      "completed",
    );
  });

  it("prefers completed over error when both apply", () => {
    const state = makeState({
      completedAt: "2026-07-06T01:00:00.000Z",
      steps: PIPELINE_STEPS.map((name) => ({
        name,
        status: "error" as const,
      })),
    });

    expect(deriveRunStatus(state, NOW_MS - 60 * MINUTE_MS, NOW_MS)).toBe(
      "completed",
    );
  });

  it("returns error when any step has status error, regardless of mtime", () => {
    const state = makeState({
      steps: PIPELINE_STEPS.map((name, i) => ({
        name,
        status: i === 2 ? ("error" as const) : ("completed" as const),
      })),
    });

    expect(deriveRunStatus(state, NOW_MS, NOW_MS)).toBe("error");
    expect(deriveRunStatus(state, NOW_MS - 60 * MINUTE_MS, NOW_MS)).toBe(
      "error",
    );
  });

  it("returns waiting when a step is waiting, even if mtime is old (stalled 오판 방지)", () => {
    const state = makeState({
      steps: [{ name: "interviewer", status: "waiting" as const }],
    });

    expect(deriveRunStatus(state, NOW_MS - 60 * MINUTE_MS, NOW_MS)).toBe(
      "waiting",
    );
  });

  it("prefers error over waiting when both apply", () => {
    const state = makeState({
      steps: [
        { name: "interviewer", status: "waiting" as const },
        { name: "context-hunter", status: "error" as const },
      ],
    });

    expect(deriveRunStatus(state, NOW_MS, NOW_MS)).toBe("error");
  });

  it("returns running when mtime is within 15 minutes of now", () => {
    expect(deriveRunStatus(makeState(), NOW_MS - 9 * MINUTE_MS, NOW_MS)).toBe(
      "running",
    );
  });

  // context-hunter는 grounding·urlContext 왕복으로 최악 6분이 걸리고, executeStep은 실행 중
  // state.json을 건드리지 않는다. 임계값이 10분이면 정상 실행 중인 run이 stalled로 오탐된다 (ADR-012).
  it("treats a 12-minute-old run as still running (10분 임계값이면 오탐한다)", () => {
    expect(deriveRunStatus(makeState(), NOW_MS - 12 * MINUTE_MS, NOW_MS)).toBe(
      "running",
    );
  });

  it("treats exactly 15 minutes as still running (15분 이내)", () => {
    expect(deriveRunStatus(makeState(), NOW_MS - 15 * MINUTE_MS, NOW_MS)).toBe(
      "running",
    );
  });

  it("returns stalled when mtime is older than 15 minutes", () => {
    expect(
      deriveRunStatus(makeState(), NOW_MS - 15 * MINUTE_MS - 1, NOW_MS),
    ).toBe("stalled");
    expect(deriveRunStatus(makeState(), NOW_MS - 16 * MINUTE_MS, NOW_MS)).toBe(
      "stalled",
    );
  });

  it("defaults nowMs to Date.now()", () => {
    expect(deriveRunStatus(makeState(), Date.now())).toBe("running");
    expect(deriveRunStatus(makeState(), Date.now() - 16 * MINUTE_MS)).toBe(
      "stalled",
    );
  });
});
