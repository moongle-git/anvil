import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CriticismSchema,
  MarketContextSchema,
  PIPELINE_STEPS,
  RunStateSchema,
  SolutionSchema,
  type Criticism,
  type InterviewAnswers,
  type InterviewQuestions,
  type MarketContext,
  type Opportunities,
  type OpportunitySelection,
  type ResearchEvidence,
  type RunState,
  type Solution,
} from "../types/index.js";
import { estimateCostUsd, type CallUsage } from "./cost.js";
import { openDb } from "./db.js";
import {
  RunNotFoundError,
  RunStore,
  SCOUT_FULL_SCOPE_IDEA,
  STEP_ARTIFACT_KINDS,
  deriveRunStatus,
} from "./runStore.js";

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
  researchCoverage: [],
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

const questions: InterviewQuestions = {
  questions: [
    { id: "q1", question: "핵심 타깃은 누구인가?", why: "UX가 달라진다" },
  ],
};
const answers: InterviewAnswers = {
  answers: [{ questionId: "q1", answer: "초보 식집사" }],
};

const evidence: ResearchEvidence = {
  voices: [
    {
      source: "youtube",
      title: "식물 키우기 실패담",
      url: "https://youtube.com/watch?v=abc",
      text: "물주기 타이밍을 늘 놓쳐요",
      authorName: "초보집사",
      score: 12,
    },
  ],
  coverage: [
    { source: "youtube", status: "collected", count: 1 },
    { source: "hackernews", status: "collected", count: 0 },
    { source: "naver", status: "unconfigured", count: 0 },
  ],
};

const opportunities: Opportunities = {
  scope: "기후 기술",
  searchedAt: "2026-07-19T00:00:00.000Z",
  candidates: [
    {
      id: "O1",
      title: "산업용 폐열 회수 최적화 에이전트",
      whatItIs: "공장 폐열 데이터를 읽어 회수 설비 운전을 자동 조정한다.",
      whyNow: "규제 시행일이 확정되면서 설비 투자가 앞당겨졌다.",
      whoPays: "중견 제조사의 설비 운영팀",
      horizon: "mid",
      signals: [
        {
          signalType: "funding",
          statement: "폐열 회수 스타트업이 시리즈B로 $42M을 조달했다.",
          observedAt: "2026-05-02",
          citation: {
            uri: "https://example.com/funding",
            kind: "origin",
          },
          figures: [
            {
              value: "$42M",
              citation: { uri: "https://example.com/funding", kind: "origin" },
            },
          ],
        },
        {
          signalType: "regulation",
          statement: "배출 규제가 2027년부터 시행된다.",
          observedAt: "2026-04-11",
          effectiveAt: "2027-01-01",
          citation: { uri: "https://example.com/reg", kind: "redirect" },
          figures: [],
        },
      ],
      counterSignal: {
        signalType: "incumbent",
        statement: "대형 설비사가 같은 기능을 번들로 무상 제공한다고 밝혔다.",
        observedAt: "2026-06-01",
        citation: { uri: "https://example.com/incumbent", kind: "origin" },
        figures: [],
      },
    },
  ],
};

const selection: OpportunitySelection = { candidateId: "O1" };

/** Gemini 호출 한 번의 사용량. label 외에는 전부 기본값을 쓴다 */
function usage(overrides: Partial<CallUsage> & { label: string }): CallUsage {
  return {
    model: "gemini-2.5-flash",
    grounded: false,
    attempt: 1,
    promptTokens: 1_000,
    cachedTokens: 0,
    outputTokens: 500,
    thoughtsTokens: 400,
    totalTokens: 1_900,
    ...overrides,
  };
}

describe("RunStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: RunStore;
  /** 저장소 바깥에서 DB를 들여다보거나 데이터를 손상시키는 용도 (CLI와 웹이 그러하듯 별도 커넥션이다) */
  let raw: DatabaseSync;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-runstore-"));
    dbPath = path.join(tmpDir, "anvil.db");
    store = new RunStore(dbPath);
    raw = openDb(dbPath);
  });

  afterEach(() => {
    vi.useRealTimers();
    store.close();
    if (raw.isOpen) {
      raw.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function artifactKinds(runId: string): string[] {
    const rows = raw
      .prepare("SELECT kind FROM artifacts WHERE run_id = ? ORDER BY kind")
      .all(runId) as { kind: string }[];
    return rows.map((row) => row.kind);
  }

  function artifactContent(runId: string, kind: string): string | undefined {
    const row = raw
      .prepare("SELECT content FROM artifacts WHERE run_id = ? AND kind = ?")
      .get(runId, kind) as { content: string } | undefined;
    return row?.content;
  }

  function writeRawArtifact(runId: string, kind: string, content: string): void {
    raw
      .prepare(
        `INSERT INTO artifacts (run_id, kind, content, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (run_id, kind) DO UPDATE SET content = excluded.content`,
      )
      .run(runId, kind, content, new Date().toISOString());
  }

  function countRows(table: string, runId: string): number {
    const row = raw
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE run_id = ?`)
      .get(runId) as { n: number };
    return row.n;
  }

  describe("createRun", () => {
    it("runs 행과 초기 state를 만든다", () => {
      const state = store.createRun("AI 반려식물 관리 서비스");

      expect(RunStateSchema.parse(state)).toEqual(state);
      expect(state.idea).toBe("AI 반려식물 관리 서비스");
      expect(countRows("runs", state.runId)).toBe(1);
      expect(store.loadRun(state.runId)).toEqual(state);
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
      expect(countRows("steps", state.runId)).toBe(5);
    });

    it("interview:true면 interviewer 스텝까지 seed하고 interview=true를 기록한다", () => {
      const state = store.createRun("아이디어", { interview: true });

      // 직접 입력 run은 주제가 이미 확정돼 있다 — trend-scout을 seed하면 유령 step이 된다
      expect(state.steps.map((s) => s.name)).toEqual([
        "interviewer",
        "context-hunter",
        "thesis",
        "cold-critic",
        "solution-designer",
        "verdict",
      ]);
      expect(state.steps.every((s) => s.status === "pending")).toBe(true);
      expect(state.interview).toBe(true);
      expect(store.loadRun(state.runId).interview).toBe(true);
    });

    it("아무 옵션도 없으면 trend-scout도 interviewer도 seed하지 않는다", () => {
      const state = store.createRun("아이디어");

      expect(state.steps.map((s) => s.name)).not.toContain("trend-scout");
      expect(state.steps.map((s) => s.name)).not.toContain("interviewer");
      expect(state.scout).toBe(false);
      expect(store.loadRun(state.runId).scout).toBe(false);
    });

    // 한 run에서 사용자를 두 번(후보 선택 → 질문 답변) 멈춰 세우지 않는다.
    // 스카우트 후보는 이미 타깃·페인포인트·수익원이 구조화돼 있어 인터뷰가 메울 공백이 없다.
    it("scout:true면 trend-scout을 seed하고 interviewer는 seed하지 않는다", () => {
      const state = store.createRun("기후 기술", { scout: true });

      expect(state.steps.map((s) => s.name)).toEqual([
        "trend-scout",
        "context-hunter",
        "thesis",
        "cold-critic",
        "solution-designer",
        "verdict",
      ]);
      expect(state.steps.every((s) => s.status === "pending")).toBe(true);
    });

    it("scout:true는 interview:true와 함께 와도 interviewer를 seed하지 않는다", () => {
      const state = store.createRun("기후 기술", {
        scout: true,
        interview: true,
      });

      expect(state.steps.map((s) => s.name)).not.toContain("interviewer");
    });

    // scout은 컬럼이 아니라 steps에서 파생된다 (ADR-014 — 기존 DB에 컬럼을 추가할 수 없다)
    it("로드한 state.scout이 trend-scout step 유무와 일치한다", () => {
      const scouted = store.createRun("기후 기술", { scout: true });
      const direct = store.createRun("확정된 아이디어");

      expect(scouted.scout).toBe(true);
      expect(store.loadRun(scouted.runId).scout).toBe(true);
      expect(store.loadRunRecord(scouted.runId)?.state.scout).toBe(true);
      expect(store.loadRun(direct.runId).scout).toBe(false);
    });

    it("스카우트 run의 idea는 사용자가 준 범위 힌트다", () => {
      const state = store.createRun("기후 기술", { scout: true });

      expect(state.idea).toBe("기후 기술");
      expect(store.loadRun(state.runId).idea).toBe("기후 기술");
    });

    // 힌트가 없어도 목록에 뜨는 값이므로 의미 없는 sentinel을 넣지 않는다
    it("범위 힌트가 비어 있으면 idea가 '전 범위 탐색'이다", () => {
      const state = store.createRun("", { scout: true });

      expect(state.idea).toBe(SCOUT_FULL_SCOPE_IDEA);
      expect(state.idea).toBe("전 범위 탐색");
      expect(store.loadRun(state.runId).idea).toBe(SCOUT_FULL_SCOPE_IDEA);
    });

    it("공백뿐인 범위 힌트도 '전 범위 탐색'이다", () => {
      expect(store.createRun("   ", { scout: true }).idea).toBe(
        SCOUT_FULL_SCOPE_IDEA,
      );
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

    it("throws RunNotFoundError when the run does not exist", () => {
      expect(() => store.loadRun("no-such-run")).toThrow(RunNotFoundError);
      expect(() => store.loadRun("no-such-run")).toThrow(/no-such-run/);
    });

    it("throws when the stored rows fail schema validation", () => {
      const created = store.createRun("아이디어");
      raw
        .prepare("UPDATE steps SET status = 'bogus' WHERE run_id = ?")
        .run(created.runId);

      expect(() => store.loadRun(created.runId)).toThrow();
    });
  });

  describe("saveRun", () => {
    it("persists updates so loadRun reflects them", () => {
      const state = store.createRun("아이디어");
      const updated = {
        ...state,
        steps: state.steps.map((s, i) =>
          i === 0
            ? {
                ...s,
                status: "completed" as const,
                startedAt: "2026-07-12T00:00:00.000Z",
                completedAt: "2026-07-12T00:01:00.000Z",
              }
            : s,
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
      expect(countRows("steps", state.runId)).toBe(state.steps.length);
    });

    it("persists step 에러 메시지와 타임스탬프", () => {
      const state = store.createRun("아이디어");
      const failed: RunState = {
        ...state,
        steps: state.steps.map((s, i) =>
          i === 1
            ? {
                ...s,
                status: "error" as const,
                failedAt: "2026-07-12T00:02:00.000Z",
                errorMessage: "boom",
              }
            : s,
        ),
      };

      store.saveRun(failed);

      expect(store.loadRun(state.runId).steps[1]).toEqual({
        name: "thesis",
        status: "error",
        failedAt: "2026-07-12T00:02:00.000Z",
        errorMessage: "boom",
      });
    });

    it("is UPDATE-only — 존재하지 않는 run에 대한 쓰기는 RunNotFoundError다 (ADR-014)", () => {
      const ghost: RunState = {
        runId: "never-created",
        idea: "아이디어",
        createdAt: "2026-07-12T00:00:00.000Z",
        steps: [{ name: "thesis", status: "pending" }],
        interview: false,
      };

      expect(() => store.saveRun(ghost)).toThrow(RunNotFoundError);
      expect(countRows("runs", "never-created")).toBe(0);
    });

    it("삭제된 run을 되살리지 못한다 — 좀비 CLI 프로세스의 쓰기는 실패한다 (ADR-015)", () => {
      const state = store.createRun("아이디어");
      store.deleteRun(state.runId);

      expect(() => store.saveRun(state)).toThrow(RunNotFoundError);
      expect(countRows("runs", state.runId)).toBe(0);
      expect(countRows("steps", state.runId)).toBe(0);
    });
  });

  describe("saveStepOutput / loadStepOutput", () => {
    it("maps each step to its artifact kind", () => {
      expect(STEP_ARTIFACT_KINDS).toEqual({
        "trend-scout": "opportunities",
        interviewer: "questions",
        "context-hunter": "context",
        thesis: "thesis",
        "cold-critic": "criticism",
        "solution-designer": "solution",
        verdict: "verdict",
      });
    });

    it("saves each step output under its mapped kind", () => {
      const { runId } = store.createRun("아이디어");

      store.saveStepOutput(runId, "context-hunter", validMarketContext);
      store.saveStepOutput(runId, "cold-critic", validCriticism);
      store.saveStepOutput(runId, "solution-designer", validSolution);

      expect(artifactKinds(runId)).toEqual([
        "context",
        "criticism",
        "solution",
      ]);
    });

    it("산출물을 컬럼으로 쪼개지 않고 JSON 문자열 한 덩어리로 저장한다 (ADR-014)", () => {
      const { runId } = store.createRun("아이디어");

      store.saveStepOutput(runId, "context-hunter", validMarketContext);

      const content = artifactContent(runId, "context");
      expect(typeof content).toBe("string");
      expect(JSON.parse(content as string)).toEqual(validMarketContext);
    });

    it("round-trips a step output through schema validation", () => {
      const { runId } = store.createRun("아이디어");
      store.saveStepOutput(runId, "context-hunter", validMarketContext);

      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toEqual(validMarketContext);
    });

    it("is idempotent — saving the same output twice yields the same content", () => {
      const { runId } = store.createRun("아이디어");

      store.saveStepOutput(runId, "cold-critic", validCriticism);
      store.saveStepOutput(runId, "cold-critic", validCriticism);

      expect(
        store.loadStepOutput(runId, "cold-critic", CriticismSchema),
      ).toEqual(validCriticism);
      expect(artifactKinds(runId)).toEqual(["criticism"]);
    });

    it("returns null when the artifact does not exist", () => {
      const { runId } = store.createRun("아이디어");

      expect(
        store.loadStepOutput(runId, "solution-designer", SolutionSchema),
      ).toBeNull();
    });

    it("returns null (not throw) when the content is corrupted JSON", () => {
      const { runId } = store.createRun("아이디어");
      writeRawArtifact(runId, "context", "{ not json");

      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
    });

    it("returns null (not throw) when the content fails schema validation", () => {
      const { runId } = store.createRun("아이디어");
      writeRawArtifact(
        runId,
        "criticism",
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
    it("saveInterviewQuestions는 questions 아티팩트에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      store.saveInterviewQuestions(runId, questions);

      expect(artifactKinds(runId)).toEqual(["questions"]);
      expect(store.loadInterviewQuestions(runId)).toEqual(questions);
    });

    it("빈 질문 목록도 왕복한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      store.saveInterviewQuestions(runId, { questions: [] });

      expect(store.loadInterviewQuestions(runId)).toEqual({ questions: [] });
    });

    it("saveInterviewAnswers는 answers 아티팩트에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      store.saveInterviewAnswers(runId, answers);

      expect(artifactKinds(runId)).toEqual(["answers"]);
      expect(store.loadInterviewAnswers(runId)).toEqual(answers);
    });

    it("answers는 step 산출물이 아니다 (STEP_ARTIFACT_KINDS에 없다)", () => {
      expect(Object.values(STEP_ARTIFACT_KINDS)).not.toContain("answers");
    });

    it("loadInterviewAnswers는 아티팩트가 없으면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });

      expect(store.loadInterviewAnswers(runId)).toBeNull();
    });

    it("loadInterviewAnswers는 손상된 JSON이면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어", { interview: true });
      writeRawArtifact(runId, "answers", "{ not json");

      expect(store.loadInterviewAnswers(runId)).toBeNull();
    });
  });

  describe("opportunities / selection (주제 발굴 — ADR-014)", () => {
    it("saveOpportunities는 opportunities 아티팩트에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });

      store.saveOpportunities(runId, opportunities);

      expect(artifactKinds(runId)).toEqual(["opportunities"]);
      expect(store.loadOpportunities(runId)).toEqual(opportunities);
    });

    it("opportunities는 trend-scout의 step 산출물이다", () => {
      expect(STEP_ARTIFACT_KINDS["trend-scout"]).toBe("opportunities");
    });

    it("후보가 없는 산출물도 왕복한다 (침묵할 수 있어야 지어내지 않는다)", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });
      const empty: Opportunities = { ...opportunities, candidates: [] };

      store.saveOpportunities(runId, empty);

      expect(store.loadOpportunities(runId)).toEqual(empty);
    });

    it("loadOpportunities는 아티팩트가 없으면 null을 반환한다", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });

      expect(store.loadOpportunities(runId)).toBeNull();
    });

    it("loadOpportunities는 손상된 JSON이면 null을 반환한다 (throw 아님)", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });
      writeRawArtifact(runId, "opportunities", "{ not json");

      expect(store.loadOpportunities(runId)).toBeNull();
    });

    it("saveOpportunitySelection은 selection 아티팩트에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });

      store.saveOpportunitySelection(runId, selection);

      expect(artifactKinds(runId)).toEqual(["selection"]);
      expect(store.loadOpportunitySelection(runId)).toEqual(selection);
    });

    // answers와 같은 취급이다 — 사람이 제출하는 아티팩트이지 step 산출물이 아니다
    it("selection은 step 산출물이 아니다 (STEP_ARTIFACT_KINDS에 없다)", () => {
      expect(Object.values(STEP_ARTIFACT_KINDS)).not.toContain("selection");
    });

    it("loadOpportunitySelection은 아티팩트가 없으면 null을 반환한다", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });

      expect(store.loadOpportunitySelection(runId)).toBeNull();
    });

    it("loadOpportunitySelection은 손상된 JSON이면 null을 반환한다 (throw 아님)", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });
      writeRawArtifact(runId, "selection", "{ not json");

      expect(store.loadOpportunitySelection(runId)).toBeNull();
    });

    it("loadOpportunitySelection은 스키마 검증에 실패하면 null을 반환한다", () => {
      const { runId } = store.createRun("기후 기술", { scout: true });
      writeRawArtifact(runId, "selection", JSON.stringify({ candidateId: "" }));

      expect(store.loadOpportunitySelection(runId)).toBeNull();
    });

    // 주제 확정에 전용 메서드를 만들지 않는다 — saveRun이 이미 idea를 UPDATE한다.
    // 쓰기 경로가 둘이 되면 updated_at 갱신 규약이 갈라진다
    it("saveRun으로 idea를 갈아끼우면 확정된 주제가 저장된다", () => {
      const state = store.createRun("기후 기술", { scout: true });

      store.saveRun({ ...state, idea: "산업용 폐열 회수 최적화 에이전트" });

      expect(store.loadRun(state.runId).idea).toBe(
        "산업용 폐열 회수 최적화 에이전트",
      );
      expect(store.listRuns()[0]?.idea).toBe("산업용 폐열 회수 최적화 에이전트");
    });
  });

  describe("research evidence", () => {
    it("saveResearchEvidence는 research 아티팩트에 저장하고 왕복한다", () => {
      const { runId } = store.createRun("아이디어");

      store.saveResearchEvidence(runId, evidence);

      expect(artifactKinds(runId)).toEqual(["research"]);
      expect(store.loadResearchEvidence(runId)).toEqual(evidence);
    });

    it("research는 step 산출물이 아니다 (STEP_ARTIFACT_KINDS에 없다)", () => {
      // PipelineStepName과 1:1 대응하는 맵이다. 넣으면 resume 판정·웹 진행 뷰까지 파급된다
      expect(Object.values(STEP_ARTIFACT_KINDS)).not.toContain("research");
    });

    it("loadResearchEvidence는 아티팩트가 없으면 null을 반환한다 (구 run에는 없다)", () => {
      const { runId } = store.createRun("아이디어");

      expect(store.loadResearchEvidence(runId)).toBeNull();
    });

    it("loadResearchEvidence는 손상된 JSON이면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어");
      writeRawArtifact(runId, "research", "{ not json");

      expect(store.loadResearchEvidence(runId)).toBeNull();
    });

    it("loadResearchEvidence는 스키마 검증에 실패하면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어");
      writeRawArtifact(
        runId,
        "research",
        JSON.stringify({
          voices: [],
          coverage: [{ source: "reddit", status: "collected", count: 1 }],
        }),
      );

      expect(store.loadResearchEvidence(runId)).toBeNull();
    });
  });

  describe("saveReport / loadReport", () => {
    it("리포트를 마크다운 원문 그대로 저장하고 왕복한다", () => {
      const { runId } = store.createRun("아이디어");
      const markdown = "# [컨설팅 리포트] 아이디어\n";

      store.saveReport(runId, markdown);

      expect(artifactContent(runId, "report")).toBe(markdown);
      expect(store.loadReport(runId)).toBe(markdown);
    });

    it("is idempotent — saving the same report twice yields the same content", () => {
      const { runId } = store.createRun("아이디어");
      const markdown = "# 리포트\n";

      store.saveReport(runId, markdown);
      store.saveReport(runId, markdown);

      expect(store.loadReport(runId)).toBe(markdown);
      expect(artifactKinds(runId)).toEqual(["report"]);
    });

    it("report는 step 산출물이 아니다 (STEP_ARTIFACT_KINDS에 없다)", () => {
      expect(Object.values(STEP_ARTIFACT_KINDS)).not.toContain("report");
    });

    it("loadReport는 리포트가 없으면 null을 반환한다", () => {
      const { runId } = store.createRun("아이디어");

      expect(store.loadReport(runId)).toBeNull();
    });

    it("hasReport는 본문을 읽지 않고 존재 여부만 답한다", () => {
      const { runId } = store.createRun("아이디어");
      expect(store.hasReport(runId)).toBe(false);

      store.saveReport(runId, "# 리포트");

      expect(store.hasReport(runId)).toBe(true);
    });

    it("hasReport는 없는 run이면 false다 (throw하지 않는다)", () => {
      expect(store.hasReport("no-such-run")).toBe(false);
    });
  });

  describe("updated_at (stalled 판정의 유일한 근거 — ADR-014)", () => {
    const T0 = "2026-07-12T00:00:00.000Z";
    const T1 = "2026-07-12T00:05:00.000Z";

    it("saveStepOutput이 runs.updated_at을 민다", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(T0));
      const { runId } = store.createRun("아이디어");
      expect(store.loadRunRecord(runId)?.updatedAtMs).toBe(Date.parse(T0));

      vi.setSystemTime(new Date(T1));
      store.saveStepOutput(runId, "context-hunter", validMarketContext);

      expect(store.loadRunRecord(runId)?.updatedAtMs).toBe(Date.parse(T1));
    });

    it("saveRun·saveReport·saveResearchEvidence·인터뷰 쓰기도 updated_at을 민다", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(T0));
      const state = store.createRun("아이디어", { interview: true });

      const writes: Array<() => void> = [
        () => store.saveRun(state),
        () => store.saveReport(state.runId, "# 리포트"),
        () => store.saveResearchEvidence(state.runId, evidence),
        () => store.saveInterviewQuestions(state.runId, questions),
        () => store.saveInterviewAnswers(state.runId, answers),
      ];

      for (const [i, write] of writes.entries()) {
        const at = Date.parse(T0) + (i + 1) * 60_000;
        vi.setSystemTime(new Date(at));
        write();
        expect(store.loadRunRecord(state.runId)?.updatedAtMs).toBe(at);
      }
    });
  });

  describe("loadRunRecord", () => {
    it("state와 updated_at을 함께 돌려준다", () => {
      const state = store.createRun("아이디어");

      const record = store.loadRunRecord(state.runId);

      expect(record?.state).toEqual(state);
      expect(record?.updatedAtMs).toBeGreaterThan(0);
    });

    it("재실행 run이면 rerunOf로 원본을 가리킨다 (계보 표시용)", () => {
      const source = store.createRun("아이디어");
      const fork = store.createRerun(source.runId);

      expect(store.loadRunRecord(fork.runId)?.rerunOf).toBe(source.runId);
      expect(store.loadRunRecord(source.runId)?.rerunOf).toBeUndefined();
    });

    it("없는 run이면 null이다 (loadRun과 달리 throw하지 않는다 — 웹이 404를 낸다)", () => {
      expect(store.loadRunRecord("no-such-run")).toBeNull();
    });

    it("손상된 run이면 null이다", () => {
      const state = store.createRun("아이디어");
      raw
        .prepare("UPDATE steps SET status = 'bogus' WHERE run_id = ?")
        .run(state.runId);

      expect(store.loadRunRecord(state.runId)).toBeNull();
    });
  });

  describe("listRuns", () => {
    const MINUTE_MS = 60 * 1000;

    it("returns an empty array when there are no runs", () => {
      expect(store.listRuns()).toEqual([]);
    });

    it("summarizes a run with its runId, idea, createdAt and derived status", () => {
      const state = store.createRun("AI 반려식물 관리 서비스");

      expect(store.listRuns()).toEqual([
        {
          runId: state.runId,
          idea: "AI 반려식물 관리 서비스",
          createdAt: state.createdAt,
          completedAt: undefined,
          status: "running",
          rerunOf: undefined,
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

    it("derives stalled status when updated_at is older than 15 minutes", () => {
      const state = store.createRun("아이디어");
      const old = new Date(Date.now() - 16 * MINUTE_MS).toISOString();
      raw
        .prepare("UPDATE runs SET updated_at = ? WHERE run_id = ?")
        .run(old, state.runId);

      expect(store.listRuns()[0]?.status).toBe("stalled");
    });

    it("derives stalled via injected nowMs without touching the row", () => {
      store.createRun("아이디어");

      expect(
        store.listRuns({ nowMs: Date.now() + 16 * MINUTE_MS })[0]?.status,
      ).toBe("stalled");
    });

    it("skips runs whose rows fail schema validation", () => {
      const state = store.createRun("아이디어");
      const invalid = store.createRun("스키마 위반 run");
      raw
        .prepare("UPDATE steps SET status = 'bogus' WHERE run_id = ?")
        .run(invalid.runId);

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

    it("재실행 run은 rerunOf로 원본을 가리킨다", () => {
      const source = store.createRun("아이디어");
      const fork = store.createRerun(source.runId);

      const summary = store.listRuns().find((r) => r.runId === fork.runId);

      expect(summary?.rerunOf).toBe(source.runId);
    });
  });

  describe("listRuns의 q 필터 (키워드 검색은 SQL이 한다)", () => {
    const MINUTE_MS = 60 * 1000;

    beforeEach(() => {
      store.createRun("AI 회의록 요약 서비스");
      store.createRun("반려식물 케어 구독");
    });

    it("idea의 부분 문자열로 거른다", () => {
      expect(store.listRuns({ q: "회의록" }).map((r) => r.idea)).toEqual([
        "AI 회의록 요약 서비스",
      ]);
    });

    it("대소문자를 무시한다 (SQLite LIKE의 ASCII 기본 동작)", () => {
      expect(store.listRuns({ q: "ai" }).map((r) => r.idea)).toEqual([
        "AI 회의록 요약 서비스",
      ]);
      expect(store.listRuns({ q: "AI" }).map((r) => r.idea)).toEqual([
        "AI 회의록 요약 서비스",
      ]);
    });

    it("매칭이 없으면 빈 배열이다", () => {
      expect(store.listRuns({ q: "존재하지 않는 키워드" })).toEqual([]);
    });

    it("q가 없거나 공백뿐이면 거르지 않는다", () => {
      expect(store.listRuns().length).toBe(2);
      expect(store.listRuns({ q: "  " }).length).toBe(2);
    });

    it("LIKE 와일드카드(%·_)는 리터럴로 취급한다", () => {
      store.createRun("전환율 100% 보장");

      // 이스케이프하지 않으면 %가 "아무거나"가 되어 전체 run이 매칭된다
      expect(store.listRuns({ q: "100%" }).map((r) => r.idea)).toEqual([
        "전환율 100% 보장",
      ]);
      expect(store.listRuns({ q: "_" })).toEqual([]);
    });

    it("q와 nowMs를 함께 넘길 수 있다", () => {
      const runs = store.listRuns({
        q: "회의록",
        nowMs: Date.now() + 16 * MINUTE_MS,
      });

      expect(runs.map((r) => r.status)).toEqual(["stalled"]);
    });
  });

  describe("saveUsage / loadRunUsage (비용은 관측된다 — ADR-016)", () => {
    it("usage 한 행을 왕복하고 cost_usd는 estimateCostUsd와 일치한다", () => {
      const { runId } = store.createRun("아이디어");
      const call = usage({ label: "thesis" });

      store.saveUsage(runId, call);

      const summary = store.loadRunUsage(runId);
      expect(summary.runId).toBe(runId);
      expect(summary.totalCalls).toBe(1);
      expect(summary.totalCostUsd).toBeCloseTo(estimateCostUsd(call), 10);
      expect(summary.totalTokens).toBe(call.totalTokens);
      expect(summary.promptTokens).toBe(call.promptTokens);
      expect(summary.cachedTokens).toBe(call.cachedTokens);
      expect(summary.outputTokens).toBe(call.outputTokens);
      expect(summary.thoughtsTokens).toBe(call.thoughtsTokens);
    });

    // ★ 재시도가 장부에서 사라지면 "재시도를 줄이는 것이 이득인가"에 영영 답할 수 없다.
    // UPSERT였다면 행이 1개로 뭉개지고 비용이 1/3로 보인다.
    it("같은 label로 3번 저장하면 행이 3개 남고 비용이 3배다 (append-only)", () => {
      const { runId } = store.createRun("아이디어");
      const call = usage({ label: "cold-critic" });

      store.saveUsage(runId, { ...call, attempt: 1 });
      store.saveUsage(runId, { ...call, attempt: 2 });
      store.saveUsage(runId, { ...call, attempt: 3 });

      const summary = store.loadRunUsage(runId);
      expect(countRows("usage", runId)).toBe(3);
      expect(summary.totalCalls).toBe(3);
      expect(summary.byLabel).toEqual([
        expect.objectContaining({ label: "cold-critic", calls: 3 }),
      ]);
      expect(summary.totalCostUsd).toBeCloseTo(estimateCostUsd(call) * 3, 10);
    });

    it("재시도 없이 한 번씩만 성공한 run은 retryCalls가 0이다", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(runId, usage({ label: "thesis" }));
      store.saveUsage(runId, usage({ label: "cold-critic" }));

      const summary = store.loadRunUsage(runId);
      expect(summary.totalCalls).toBe(2);
      expect(summary.retryCalls).toBe(0);
    });

    it("retryCalls는 label당 첫 시도를 제외한 나머지 호출 수다", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(runId, usage({ label: "thesis", attempt: 1 }));
      store.saveUsage(runId, usage({ label: "thesis", attempt: 2 }));
      store.saveUsage(runId, usage({ label: "thesis", attempt: 3 }));
      store.saveUsage(runId, usage({ label: "verdict", attempt: 1 }));

      const summary = store.loadRunUsage(runId);
      expect(summary.totalCalls).toBe(4);
      expect(summary.retryCalls).toBe(2);
    });

    it("usage 행이 없는 구 run은 0으로 채운 요약이다 (null이 아니다)", () => {
      const { runId } = store.createRun("아이디어");

      expect(store.loadRunUsage(runId)).toEqual({
        runId,
        totalCostUsd: 0,
        totalTokens: 0,
        promptTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        thoughtsTokens: 0,
        thoughtsRatio: 0,
        groundedCalls: 0,
        totalCalls: 0,
        retryCalls: 0,
        byLabel: [],
      });
    });

    it("없는 run도 0으로 채운 요약이다 (throw하지 않는다)", () => {
      expect(store.loadRunUsage("no-such-run").totalCalls).toBe(0);
    });

    it("thoughtsRatio는 thinking이 과금 출력에서 차지하는 비중이다", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(
        runId,
        usage({ label: "verdict", outputTokens: 250, thoughtsTokens: 750 }),
      );

      expect(store.loadRunUsage(runId).thoughtsRatio).toBeCloseTo(0.75, 10);
    });

    it("출력이 0이면 thoughtsRatio는 0이다 (0으로 나누지 않는다)", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(
        runId,
        usage({ label: "thesis", outputTokens: 0, thoughtsTokens: 0 }),
      );

      expect(store.loadRunUsage(runId).thoughtsRatio).toBe(0);
    });

    it("groundedCalls는 grounded 호출만 센다 — 요청당 정액 과금이라 따로 본다", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(runId, usage({ label: "context-hunter", grounded: true }));
      store.saveUsage(runId, usage({ label: "context-hunter", grounded: true }));
      store.saveUsage(runId, usage({ label: "thesis" }));

      const summary = store.loadRunUsage(runId);
      expect(summary.groundedCalls).toBe(2);
      expect(summary.totalCalls).toBe(3);
    });

    it("byLabel은 비용 내림차순이다 — 어느 에이전트가 비싼지가 요점이다", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(runId, usage({ label: "interviewer", outputTokens: 10 }));
      store.saveUsage(runId, usage({ label: "verdict", outputTokens: 5_000 }));
      store.saveUsage(runId, usage({ label: "thesis", outputTokens: 500 }));

      const byLabel = store.loadRunUsage(runId).byLabel;

      expect(byLabel.map((row) => row.label)).toEqual([
        "verdict",
        "thesis",
        "interviewer",
      ]);
      expect(byLabel[0]).toEqual({
        label: "verdict",
        calls: 1,
        costUsd: estimateCostUsd(usage({ label: "verdict", outputTokens: 5_000 })),
        promptTokens: 1_000,
        outputTokens: 5_000,
        thoughtsTokens: 400,
      });
    });

    it("saveUsage가 runs.updated_at을 민다", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-12T00:00:00.000Z"));
      const { runId } = store.createRun("아이디어");

      const at = Date.parse("2026-07-12T00:07:00.000Z");
      vi.setSystemTime(new Date(at));
      store.saveUsage(runId, usage({ label: "thesis" }));

      expect(store.loadRunRecord(runId)?.updatedAtMs).toBe(at);
    });

    // saveRun의 UPDATE-only 에러(ADR-014/015)는 **상태**를 지키기 위한 것이다. usage는 관측치다 —
    // 계측 실패가 파이프라인을 죽이면 안 되므로, 삭제된 run에 대한 쓰기는 조용히 사라진다.
    it("삭제된 run에 저장해도 throw하지 않고 조용히 무시한다", () => {
      const { runId } = store.createRun("아이디어");
      store.deleteRun(runId);

      expect(() => store.saveUsage(runId, usage({ label: "thesis" }))).not.toThrow();
      expect(countRows("usage", runId)).toBe(0);
      expect(countRows("runs", runId)).toBe(0);
    });

    it("run을 지우면 usage도 CASCADE로 사라진다", () => {
      const { runId } = store.createRun("아이디어");
      store.saveUsage(runId, usage({ label: "thesis" }));
      store.saveUsage(runId, usage({ label: "verdict" }));

      store.deleteRun(runId);

      expect(countRows("usage", runId)).toBe(0);
      expect(store.loadRunUsage(runId).totalCalls).toBe(0);
    });
  });

  // 이 phase 이전에 만들어진 DB 파일이 그대로 열리고 기존 run이 정상 로드되어야 한다.
  // DDL이 전부 CREATE TABLE IF NOT EXISTS라 기존 DB에는 새 컬럼이 생기지 않는다 (ADR-014)
  describe("구 DB 호환 (scout은 컬럼이 아니라 파생값이다)", () => {
    it("runs 테이블에 scout 컬럼을 추가하지 않는다", () => {
      const columns = (
        raw.prepare("PRAGMA table_info(runs)").all() as { name: string }[]
      ).map((row) => row.name);

      expect(columns).toEqual([
        "run_id",
        "idea",
        "created_at",
        "updated_at",
        "completed_at",
        "interview",
        "rerun_of",
      ]);
    });

    it("scout을 모르고 쓰인 구 run 행이 그대로 로드되고 scout=false다", () => {
      const nowIso = new Date().toISOString();
      raw
        .prepare(
          `INSERT INTO runs (run_id, idea, created_at, updated_at, interview)
           VALUES (?, ?, ?, ?, 0)`,
        )
        .run("legacy-run", "구버전 아이디어", nowIso, nowIso);
      raw
        .prepare(
          `INSERT INTO steps (run_id, name, ordinal, status)
           VALUES ('legacy-run', 'context-hunter', 0, 'completed')`,
        )
        .run();

      const state = store.loadRun("legacy-run");

      expect(state.idea).toBe("구버전 아이디어");
      expect(state.scout).toBe(false);
      expect(state.steps.map((s) => s.name)).toEqual(["context-hunter"]);
      expect(store.listRuns().map((r) => r.runId)).toContain("legacy-run");
    });
  });

  describe("deleteRun", () => {
    it("run·steps·artifacts를 CASCADE로 함께 지운다 (ADR-015)", () => {
      const { runId } = store.createRun("아이디어");
      store.saveStepOutput(runId, "context-hunter", validMarketContext);
      store.saveResearchEvidence(runId, evidence);
      store.saveReport(runId, "# 리포트");

      expect(store.deleteRun(runId)).toBe(true);

      expect(() => store.loadRun(runId)).toThrow(RunNotFoundError);
      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
      expect(store.loadResearchEvidence(runId)).toBeNull();
      expect(store.loadReport(runId)).toBeNull();
      expect(countRows("runs", runId)).toBe(0);
      expect(countRows("steps", runId)).toBe(0);
      expect(countRows("artifacts", runId)).toBe(0);
    });

    it("없는 run이면 false를 반환한다 (throw하지 않는다)", () => {
      expect(store.deleteRun("no-such-run")).toBe(false);
    });

    it("다른 run은 건드리지 않는다", () => {
      const kept = store.createRun("남길 run");
      const doomed = store.createRun("지울 run");

      store.deleteRun(doomed.runId);

      expect(store.listRuns().map((r) => r.runId)).toEqual([kept.runId]);
    });

    it("원본을 지워도 재실행 run은 살아남고 rerunOf만 끊긴다 (ON DELETE SET NULL)", () => {
      const source = store.createRun("아이디어");
      const fork = store.createRerun(source.runId);

      expect(store.deleteRun(source.runId)).toBe(true);

      expect(store.loadRun(fork.runId).runId).toBe(fork.runId);
      expect(
        store.listRuns().find((r) => r.runId === fork.runId)?.rerunOf,
      ).toBeUndefined();
    });
  });

  describe("createRerun (재실행은 포크다 — ADR-015)", () => {
    /** 완료된 인터뷰 run 하나를 통째로 만든다 */
    function completedInterviewRun(): RunState {
      const state = store.createRun("AI 반려식물 관리 서비스", {
        interview: true,
      });
      store.saveInterviewQuestions(state.runId, questions);
      store.saveInterviewAnswers(state.runId, answers);
      store.saveResearchEvidence(state.runId, evidence);
      store.saveStepOutput(state.runId, "context-hunter", validMarketContext);
      store.saveStepOutput(state.runId, "cold-critic", validCriticism);
      store.saveStepOutput(state.runId, "solution-designer", validSolution);
      store.saveReport(state.runId, "# 리포트");
      const completed: RunState = {
        ...state,
        steps: state.steps.map((s) => ({ ...s, status: "completed" as const })),
        completedAt: new Date().toISOString(),
      };
      store.saveRun(completed);
      return completed;
    }

    it("원본이 없으면 RunNotFoundError다", () => {
      expect(() => store.createRerun("no-such-run")).toThrow(RunNotFoundError);
    });

    it("새 run_id로 아이디어·interview를 복사하고 rerun_of에 계보를 남긴다", () => {
      const source = completedInterviewRun();

      const fork = store.createRerun(source.runId);

      expect(fork.runId).not.toBe(source.runId);
      expect(fork.idea).toBe(source.idea);
      expect(fork.interview).toBe(true);
      expect(fork.completedAt).toBeUndefined();
      expect(
        store.listRuns().find((r) => r.runId === fork.runId)?.rerunOf,
      ).toBe(source.runId);
    });

    it("원본을 덮어쓰지 않는다 — 원본 리포트는 그대로 남는다", () => {
      const source = completedInterviewRun();

      store.createRerun(source.runId);

      expect(store.loadRun(source.runId)).toEqual(source);
      expect(store.loadReport(source.runId)).toBe("# 리포트");
    });

    it("questions·answers만 복사한다 — research·context·report는 복사하지 않는다", () => {
      const source = completedInterviewRun();

      const fork = store.createRerun(source.runId);

      expect(store.loadInterviewQuestions(fork.runId)).toEqual(questions);
      expect(store.loadInterviewAnswers(fork.runId)).toEqual(answers);
      expect(artifactKinds(fork.runId)).toEqual(["answers", "questions"]);
      expect(store.loadResearchEvidence(fork.runId)).toBeNull();
      expect(
        store.loadStepOutput(fork.runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
      expect(
        store.loadStepOutput(fork.runId, "cold-critic", CriticismSchema),
      ).toBeNull();
      expect(store.loadReport(fork.runId)).toBeNull();
    });

    it("interviewer는 completed로, 나머지 step은 pending으로 seed한다 (인터뷰를 다시 묻지 않는다)", () => {
      const source = completedInterviewRun();

      const fork = store.createRerun(source.runId);

      expect(fork.steps.map((s) => [s.name, s.status])).toEqual([
        ["interviewer", "completed"],
        ["context-hunter", "pending"],
        ["thesis", "pending"],
        ["cold-critic", "pending"],
        ["solution-designer", "pending"],
        ["verdict", "pending"],
      ]);
      expect(
        fork.steps.find((s) => s.name === "interviewer")?.completedAt,
      ).toBeDefined();
      expect(store.loadRun(fork.runId)).toEqual(fork);
    });

    it("원본에 questions가 없으면 interviewer는 pending이다 (답변 없이 진행하면 안 된다)", () => {
      const source = store.createRun("아이디어", { interview: true });

      const fork = store.createRerun(source.runId);

      expect(
        fork.steps.find((s) => s.name === "interviewer")?.status,
      ).toBe("pending");
    });

    // 완료된 스카우트 run은 주제가 이미 확정돼 있다. 포크는 평범한 run이고 자료조사부터 돈다
    it("스카우트 run을 포크하면 trend-scout이 없고 발굴 아티팩트도 복사되지 않는다", () => {
      const source = store.createRun("기후 기술", { scout: true });
      store.saveOpportunities(source.runId, opportunities);
      store.saveOpportunitySelection(source.runId, selection);
      store.saveRun({ ...source, idea: "산업용 폐열 회수 최적화 에이전트" });

      const fork = store.createRerun(source.runId);

      expect(fork.steps.map((s) => s.name)).toEqual([
        "context-hunter",
        "thesis",
        "cold-critic",
        "solution-designer",
        "verdict",
      ]);
      expect(fork.scout).toBe(false);
      expect(store.loadRun(fork.runId).scout).toBe(false);
      expect(artifactKinds(fork.runId)).toEqual([]);
      expect(store.loadOpportunities(fork.runId)).toBeNull();
      expect(store.loadOpportunitySelection(fork.runId)).toBeNull();
      // 확정된 주제는 그대로 이어받는다
      expect(fork.idea).toBe("산업용 폐열 회수 최적화 에이전트");
    });

    it("CLI run(interview=false)은 interviewer 없이 포크된다", () => {
      const source = store.createRun("아이디어");

      const fork = store.createRerun(source.runId);

      expect(fork.interview).toBe(false);
      expect(fork.steps.map((s) => s.name)).toEqual([
        "context-hunter",
        "thesis",
        "cold-critic",
        "solution-designer",
        "verdict",
      ]);
      expect(fork.steps.every((s) => s.status === "pending")).toBe(true);
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

  it("returns completed when completedAt is set, regardless of updated_at", () => {
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

  it("returns error when any step has status error, regardless of updated_at", () => {
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

  it("returns waiting when a step is waiting, even if updated_at is old (stalled 오판 방지)", () => {
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

  it("returns running when updated_at is within 15 minutes of now", () => {
    expect(deriveRunStatus(makeState(), NOW_MS - 9 * MINUTE_MS, NOW_MS)).toBe(
      "running",
    );
  });

  // context-hunter는 grounding·urlContext 왕복으로 최악 6분이 걸리고, executeStep은 실행 중
  // updated_at을 건드리지 않는다. 임계값이 10분이면 정상 실행 중인 run이 stalled로 오탐된다 (ADR-012).
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

  it("returns stalled when updated_at is older than 15 minutes", () => {
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
