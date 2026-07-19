import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import {
  RunStore,
  SCOUT_FULL_SCOPE_IDEA,
  STEP_ARTIFACT_KINDS,
} from "../lib/runStore.js";
import type { ResearchSource } from "../research/types.js";
import type { GeminiService } from "../services/gemini.js";
import { COLD_CRITIC_USAGE_LABEL } from "../agents/coldCritic.js";
import {
  CONTEXT_HUNTER_SCOUT_HEADING,
  CONTEXT_HUNTER_USAGE_LABEL,
} from "../agents/contextHunter.js";
import { INTERVIEWER_USAGE_LABEL } from "../agents/interviewer.js";
import { RESEARCH_PLANNER_USAGE_LABEL } from "../agents/researchPlanner.js";
import { SCOUT_PLANNER_USAGE_LABEL } from "../agents/scoutPlanner.js";
import {
  SCOUT_SEARCH_USAGE_LABEL,
  SCOUT_STRUCTURE_USAGE_LABEL,
} from "../agents/scoutSearch.js";
import { SOLUTION_DESIGNER_USAGE_LABEL } from "../agents/solutionDesigner.js";
import { THESIS_USAGE_LABEL } from "../agents/thesis.js";
import {
  SCOUT_FULL_SCOPE_LABEL,
  TREND_SCOUT_USAGE_LABEL,
} from "../agents/trendScout.js";
import { VERDICT_USAGE_LABEL } from "../agents/verdict.js";
import {
  MarketContextSchema,
  OpportunitiesSchema,
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  SolutionSchema,
  VerdictSchema,
  solutionSchemaFor,
  verdictSchemaFor,
  type Citation,
  type CommunityVoice,
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

/**
 * 수집된 목소리. context.json의 communityVoices는 LLM이 받아적은 것이 아니라
 * 코드가 이 배열에서 ID로 복원한 것이다 (ADR-013).
 */
const collectedVoice: CommunityVoice = {
  source: "youtube",
  title: "식물 키우기 실패담",
  url: "https://youtube.com/watch?v=abc",
  text: "물주기 타이밍을 늘 놓쳐요",
};

const marketContext: MarketContext = {
  ideaTitle: "AI 반려식물 관리 서비스",
  briefing: "홈가드닝 시장은 성장 중이나 무료 리마인더 앱이 이미 시장을 선점했다.",
  marketSizeIndicators: ["홈가드닝 시장 연 10% 성장"],
  competitorInsight: "리마인더는 평준화됐고 경쟁은 진단 정확도에서 벌어진다.",
  voicesInsight: "유저는 늦은 감지를 가장 큰 고통으로 말한다.",
  trends: ["홈가드닝 시장 성장"],
  competitors: [{ name: "Planta", description: "식물 관리 앱" }],
  communityVoices: [collectedVoice],
  painPointEvidence: ["물주기 실패로 식물을 죽인 경험"],
  sources: ["https://example.com/trend"],
  citations: [],
  // fakeSources()가 3종 모두 등록하고 YouTube만 1건을 돌려주므로, 코드가 주입하는 커버리지는 이 모양이다
  researchCoverage: [
    { source: "youtube", status: "collected", count: 1 },
    { source: "hackernews", status: "collected", count: 0 },
    { source: "naver", status: "collected", count: 0 },
  ],
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
  // c2가 fatal이다 — 원장이 비면 solutionSchemaFor가 거부하므로 실제 파이프라인을
  // 통과할 수 없는 산출물이 된다 (ADR-017)
  remedies: [
    {
      respondsTo: "c2",
      strategy: "defend",
      remedy: "무료 대체재가 못 주는 생존 보장 과금으로 지불 의사를 구조적으로 만든다",
    },
  ],
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
  // c2가 fatal이다 — 감사가 비면 verdictSchemaFor가 거부하므로 실제 파이프라인을
  // 통과할 수 없는 판정이 된다 (ADR-017)
  remedyAudits: [
    {
      criticismId: "c2",
      assessment: "solid",
      note: "생존 보장 과금은 무료 대체재가 구조적으로 흉내낼 수 없는 약속이다",
    },
  ],
};

// ── 주제 발굴(trend-scout) 픽스처 ──
// 날짜창은 now 기준 18개월이라 고정 날짜를 박으면 시간이 지나면서 테스트가 썩는다.
// opportunitiesSchemaFor가 observedAt을 실제로 검증하므로 상대 날짜로 만든다.
const OBSERVED_AT = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/** 코드가 grounding 응답에서 추출한 인용. C1·C2 번호는 trendScout이 인덱스로 붙인다 (ADR-013) */
const scoutCitations: Citation[] = [
  {
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/A1",
    title: "EU 배터리 여권 시행 규칙 확정",
    domain: "europa.eu",
    kind: "redirect",
  },
  {
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/A2",
    title: "배터리 이력 추적 스타트업 시리즈B",
    domain: "techcrunch.com",
    kind: "redirect",
  },
];

const scoutDossier = {
  findings: [
    {
      signalType: "regulation",
      statement: "EU가 배터리 여권 제출을 의무화하는 시행 규칙을 확정했다",
      observedAt: OBSERVED_AT,
    },
  ],
};

/** LLM이 채우는 draft — 인용은 ID로만 지목한다. 코드가 실체(Citation)로 치환한다 */
const scoutDraft = {
  candidates: [
    {
      id: "O1",
      title: "배터리 여권 대응 이력 수집 SaaS",
      whatItIs:
        "EU 배터리 여권 의무화에 맞춰 셀 단위 공급망 이력을 자동 수집·제출하는 서비스",
      signals: [
        {
          signalType: "regulation",
          statement: "EU가 배터리 여권 제출을 의무화하는 시행 규칙을 확정했다",
          observedAt: OBSERVED_AT,
          effectiveAt: "2027-02-18",
          citationRef: "C1",
          figures: [],
        },
        {
          signalType: "funding",
          statement: "배터리 이력 추적 스타트업이 시리즈B를 유치했다",
          observedAt: OBSERVED_AT,
          citationRef: "C2",
          figures: [],
        },
      ],
      counterSignal: {
        signalType: "incumbent",
        statement: "기존 ERP 벤더가 같은 기능을 로드맵에 올렸다",
        observedAt: OBSERVED_AT,
        citationRef: "C2",
        figures: [],
      },
      whyNow: "시행일까지 남은 준비 기간이 짧다",
      whoPays: "EU에 배터리를 파는 제조사",
      horizon: "mid",
    },
    {
      id: "O2",
      title: "폐배터리 잔존가치 평가 API",
      whatItIs: "회수된 셀의 잔존 수명을 진단해 재사용 등급을 매기는 평가 API",
      signals: [
        {
          signalType: "funding",
          statement: "폐배터리 재활용 설비에 신규 투자가 집행됐다",
          observedAt: OBSERVED_AT,
          citationRef: "C2",
          figures: [],
        },
        {
          signalType: "regulation",
          statement: "회수 의무 비율이 상향되는 규칙이 확정됐다",
          observedAt: OBSERVED_AT,
          citationRef: "C1",
          figures: [],
        },
      ],
      counterSignal: {
        signalType: "incumbent",
        statement: "대형 재활용사가 자체 진단 설비를 이미 갖췄다",
        observedAt: OBSERVED_AT,
        citationRef: "C1",
        figures: [],
      },
      whyNow: "회수량이 임계점을 넘기 시작했다",
      whoPays: "재활용 사업자",
      horizon: "long",
    },
  ],
};

/** trend-scout이 실제로 던지는 세 호출의 라벨 (planner → search → 합성) */
// non-grounded 호출 세 개다 — 검색어 설계, 산문 dossier의 구조화, 후보 합성.
// grounded 호출(scout-search)은 산문 경로라 여기 없다.
const SCOUT_LABELS = [
  SCOUT_PLANNER_USAGE_LABEL,
  SCOUT_STRUCTURE_USAGE_LABEL,
  TREND_SCOUT_USAGE_LABEL,
];

const scoutQueries = {
  funding: ["battery recycling series B"],
  incumbent: ["battery capex guidance"],
  regulation: ["EU battery passport effective date"],
  costCurve: ["battery pack cost per kWh"],
};

interface FakeGemini {
  gemini: GeminiService;
  generateStructured: ReturnType<typeof vi.fn>;
  generateGrounded: ReturnType<typeof vi.fn>;
  generateGroundedText: ReturnType<typeof vi.fn>;
}

/** researchPlanner 산출물 — pipeline step이 아니라 context-hunter 내부 호출이다 (ADR-012) */
const searchQueries: SearchQueries = {
  youtube: "식물 죽이는 이유",
  hackernews: "plant care app",
  naver: "화분 물주기 실패",
  web: ["홈가드닝 시장 규모"],
};

/**
 * usageLabel로 어떤 에이전트의 호출인지 판별해 해당 산출물을 돌려주는 fake.
 * context-hunter만 generateGrounded를 쓰고, LLM이 채우는 draft(citations 제외)를 돌려받는다 (ADR-012).
 * failOn은 두 메서드 모두에 적용된다 — 어느 경로로 호출되든 그 step이 실패해야 한다.
 *
 * 스키마 객체 동일성(schema === XSchema)으로 판별하지 않는다 — solutionSchemaFor처럼
 * criticism을 아는 팩토리는 호출마다 새 객체를 만든다 (ADR-017). usageLabel은 에이전트가
 * usage 테이블에 적는 것과 같은 이름이라 파이프라인이 실제로 쓰는 계약이다 (ADR-016).
 *
 * 실제 generateStructured는 넘겨받은 schema로 응답을 검증한 뒤에야 반환한다 (ADR-004) —
 * fake도 그 계약을 지켜야 원장 없는 산출물이 step error가 되는 것이 관측된다.
 */
function fakeGemini(options?: {
  failOn?: string;
  questions?: InterviewQuestions;
  /** 원장 없는 응답 등, 스키마가 거부해야 할 solution을 주입한다 */
  solution?: unknown;
  /** []로 주면 침묵 게이트가 작동해 후보 0건이 된다 (trendScout) */
  scoutCitations?: Citation[];
}): FakeGemini {
  const generateStructured = vi.fn(
    ({
      usageLabel,
      schema,
    }: {
      usageLabel: string;
      schema: ZodType<unknown>;
    }): Promise<unknown> => {
      if (usageLabel === options?.failOn) {
        return Promise.reject(new Error("Gemini 호출 실패"));
      }
      const respond = (response: unknown): Promise<unknown> => {
        // 검증 실패는 재시도 끝에 throw된다 — fake는 그 종착지만 모델링한다
        try {
          return Promise.resolve(schema.parse(response));
        } catch (error) {
          return Promise.reject(error);
        }
      };
      if (usageLabel === INTERVIEWER_USAGE_LABEL) {
        return respond(options?.questions ?? { questions: [] });
      }
      if (usageLabel === RESEARCH_PLANNER_USAGE_LABEL)
        return respond(searchQueries);
      if (usageLabel === SCOUT_PLANNER_USAGE_LABEL) return respond(scoutQueries);
      // 검색은 산문으로 받고, 구조화만 non-grounded로 따로 돈다 (인용 귀속 보존)
      if (usageLabel === SCOUT_STRUCTURE_USAGE_LABEL)
        return respond(scoutDossier);
      // 합성 호출의 schema는 opportunitiesSchemaFor다 — 인용 화이트리스트·삼각측량·날짜창을
      // 실제로 검증하므로, draft가 grounded 인용과 어긋나면 여기서 거부된다 (ADR-017)
      if (usageLabel === TREND_SCOUT_USAGE_LABEL) return respond(scoutDraft);
      if (usageLabel === THESIS_USAGE_LABEL) return respond(thesis);
      if (usageLabel === COLD_CRITIC_USAGE_LABEL) return respond(criticism);
      if (usageLabel === SOLUTION_DESIGNER_USAGE_LABEL)
        return respond(options?.solution ?? solution);
      if (usageLabel === VERDICT_USAGE_LABEL) return respond(verdict);
      return Promise.reject(new Error(`예상하지 못한 usageLabel: ${usageLabel}`));
    },
  );

  const generateGrounded = vi.fn(
    ({ usageLabel }: { usageLabel: string }): Promise<unknown> => {
      if (usageLabel === options?.failOn) {
        return Promise.reject(new Error("Gemini 호출 실패"));
      }
      if (usageLabel === CONTEXT_HUNTER_USAGE_LABEL) {
        // LLM은 draft만 채운다 — citations·researchCoverage·communityVoices는 코드가 주입하는
        // 사실이고, 목소리 선별은 수집 증거의 ID 참조로만 표현된다 (ADR-013)
        const { citations, researchCoverage, communityVoices, ...draft } =
          marketContext;
        void researchCoverage;
        void communityVoices;
        return Promise.resolve({
          data: { ...draft, communityVoiceRefs: ["V1"] },
          citations,
          webSearchQueries: [],
        });
      }
      return Promise.reject(
        new Error(`예상하지 못한 usageLabel: ${usageLabel}`),
      );
    },
  );

  const generateGroundedText = vi.fn(
    ({ usageLabel }: { usageLabel: string }): Promise<unknown> => {
      if (usageLabel === options?.failOn) {
        return Promise.reject(new Error("Gemini 호출 실패"));
      }
      if (usageLabel === SCOUT_SEARCH_USAGE_LABEL) {
        return Promise.resolve({
          text: "관측된 사실 산문",
          citations: options?.scoutCitations ?? scoutCitations,
          webSearchQueries: [],
        });
      }
      return Promise.reject(
        new Error(`예상하지 못한 usageLabel: ${usageLabel}`),
      );
    },
  );

  return {
    gemini: {
      generateStructured,
      generateGrounded,
      generateGroundedText,
    } as unknown as GeminiService,
    generateStructured,
    generateGrounded,
    generateGroundedText,
  };
}

/** 자료조사 소스 3종. YouTube만 1건을 돌려주고 나머지는 0건이어도 파이프라인은 완주한다 */
function fakeSources(): ResearchSource[] {
  return RESEARCH_SOURCE_IDS.map((id) => ({
    id,
    label: SOURCE_LABELS[id],
    collect: vi
      .fn()
      .mockResolvedValue(id === "youtube" ? [collectedVoice] : []),
  }));
}

/** 어느 에이전트가 어떤 순서로 호출됐는가 — step 실행 순서·resume skip의 관측 지점 */
function calledLabels(generate: ReturnType<typeof vi.fn>): string[] {
  return generate.mock.calls.map(
    (call) => (call[0] as { usageLabel: string }).usageLabel,
  );
}

describe("runPipeline", () => {
  let tmpDir: string;
  let store: RunStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-pipeline-"));
    store = new RunStore(path.join(tmpDir, "anvil.db"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    // research-planner는 step이 아니라 context-hunter 내부의 researchPlanner 호출이다 (ADR-012) —
    // PIPELINE_STEPS는 여전히 6개다.
    expect(calledLabels(generateStructured)).toEqual([
      RESEARCH_PLANNER_USAGE_LABEL,
      THESIS_USAGE_LABEL,
      COLD_CRITIC_USAGE_LABEL,
      SOLUTION_DESIGNER_USAGE_LABEL,
      VERDICT_USAGE_LABEL,
    ]);
    // context-hunter만 grounding 경로다 (인용을 코드가 추출해야 하므로)
    expect(calledLabels(generateGrounded)).toEqual([CONTEXT_HUNTER_USAGE_LABEL]);

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

    // 산출물 persist — 각 step은 매핑된 artifacts.kind로 저장된다 (ADR-014)
    expect(STEP_ARTIFACT_KINDS.verdict).toBe("verdict");
    expect(
      store.loadStepOutput(result.runId, "context-hunter", MarketContextSchema),
    ).toEqual(marketContext);
    expect(store.loadStepOutput(result.runId, "verdict", VerdictSchema)).toEqual(
      verdict,
    );

    // 리포트 생성 — 파일이 아니라 artifacts(kind='report')에 남는다
    const report = store.loadReport(result.runId);
    expect(result.report).toBe(report);
    expect(report).toContain("# [컨설팅 리포트]");
    expect(report).toContain(solution.revisedConcept);
    expect(report).toContain(verdict.headline);
  });

  it("verdict step 실패: state에 error를 기록하고 리포트도 completedAt도 남기지 않는다", async () => {
    const { gemini } = fakeGemini({ failOn: VERDICT_USAGE_LABEL });

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
    expect(store.loadReport(error.runId)).toBeNull();
  });

  it("resume: completed인 verdict 산출물은 재사용하고 재실행하지 않는다", async () => {
    const first = fakeGemini();
    const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

    const second = fakeGemini();
    await runPipeline(makeDeps(second.gemini), {
      idea: IDEA,
      resumeRunId: runId,
    });

    expect(calledLabels(second.generateStructured)).toEqual([]);
    expect(second.generateGrounded).not.toHaveBeenCalled();
    expect(store.loadStepOutput(runId, "verdict", VerdictSchema)).toEqual(
      verdict,
    );
  });

  it("verdict 산출물이 손상되면 completed 상태여도 verdict step만 재실행한다", async () => {
    const first = fakeGemini();
    const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

    // 스키마 검증에 실패하는 산출물 (survivalScore가 recommendation 밴드와 모순)
    store.saveStepOutput(runId, "verdict", {
      ...verdict,
      survivalScore: 5,
    });

    const second = fakeGemini();
    await runPipeline(makeDeps(second.gemini), {
      idea: IDEA,
      resumeRunId: runId,
    });

    expect(calledLabels(second.generateStructured)).toEqual([VERDICT_USAGE_LABEL]);
    expect(store.loadStepOutput(runId, "verdict", VerdictSchema)).toEqual(
      verdict,
    );
  });

  // ADR-017: 하류(solution·verdict) step의 스키마는 상류(criticism)를 안다. 그래서 resume이
  // 교차 산출물 정합성까지 재검증한다 — 원장 없이 저장된 구 solution은 새 코드 없이
  // ADR-011의 이송 경로("산출물이 없거나 손상됨 — 재실행한다")를 탄다.
  describe("결함↔해결책 원장 (교차 산출물 검증)", () => {
    it("★ resume: 원장 없이 저장된 solution은 손상으로 취급해 재실행한다", async () => {
      const first = fakeGemini();
      const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

      // 원장이 생기기 전에 저장된 solution의 모양. 정적 SolutionSchema는 통과시키지만
      // (관대한 읽기), criticism의 fatal(c2)에 침묵하므로 팩토리는 거부한다.
      const legacySolution = { ...solution, remedies: [] };
      store.saveStepOutput(runId, "solution-designer", legacySolution);
      expect(SolutionSchema.safeParse(legacySolution).success).toBe(true);

      const second = fakeGemini();
      await runPipeline(makeDeps(second.gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      // 침묵한 solution만 재실행된다. verdict는 completed이고 저장된 판정이 여전히
      // 검증을 통과하므로 건너뛴다 — resume은 하류로 무효화를 전파하지 않는다 (ADR-004)
      expect(calledLabels(second.generateStructured)).toEqual([
        SOLUTION_DESIGNER_USAGE_LABEL,
      ]);
      // 재실행으로 원장이 복구된다 — 구 run은 resume만으로 이송된다
      expect(
        store.loadStepOutput(runId, "solution-designer", SolutionSchema)
          ?.remedies,
      ).toEqual(solution.remedies);
    });

    it("resume: 원장이 fatal을 전건 커버하면 재실행하지 않는다", async () => {
      const first = fakeGemini();
      const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

      const second = fakeGemini();
      await runPipeline(makeDeps(second.gemini), {
        idea: IDEA,
        resumeRunId: runId,
      });

      expect(calledLabels(second.generateStructured)).toEqual([]);
      expect(
        store.loadStepOutput(runId, "solution-designer", SolutionSchema),
      ).toEqual(solution);
    });

    it("fatal에 침묵하는 solution은 solution-designer step이 error로 기록된다", async () => {
      // 재시도를 다 쓰고도 원장을 못 채운 경우 — 침묵한 산출물이 저장되면 안 된다
      const { gemini } = fakeGemini({ solution: { ...solution, remedies: [] } });

      const promise = runPipeline(makeDeps(gemini), { idea: IDEA });
      await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
      const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
      expect(error.step).toBe("solution-designer");
      // 재시도 피드백이 되는 메시지다 — 빠진 id를 이름으로 지목해야 한다 (ADR-004)
      expect(error.message).toContain("c2");

      const saved = store.loadRun(error.runId);
      expect(saved.steps.map((s) => s.status)).toEqual([
        "completed",
        "completed",
        "completed",
        "error",
        "pending",
      ]);
      expect(saved.completedAt).toBeUndefined();
      expect(store.loadReport(error.runId)).toBeNull();
    });

    it("웹 읽기 경로가 쓰는 정적 스키마는 원장 없는 구 solution도 통과시킨다", async () => {
      // 관대한 읽기 / 엄격한 쓰기는 설계다 — 웹은 criticism 없이 solution을 렌더해야 하고,
      // 웹을 팩토리로 바꾸면 원장 이전에 저장된 기존 run이 조용히 빈 화면이 된다 (ADR-017)
      const legacySolution = { ...solution, remedies: [] };
      expect(SolutionSchema.safeParse(legacySolution).success).toBe(true);
      expect(solutionSchemaFor(criticism).safeParse(legacySolution).success).toBe(
        false,
      );

      const legacyVerdict = { ...verdict, remedyAudits: [] };
      expect(VerdictSchema.safeParse(legacyVerdict).success).toBe(true);
      expect(verdictSchemaFor(criticism).safeParse(legacyVerdict).success).toBe(
        false,
      );
    });
  });

  it("cold-critic step 실패: state에 error를 기록하고 PipelineStepError를 던진다", async () => {
    const { gemini } = fakeGemini({ failOn: COLD_CRITIC_USAGE_LABEL });

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
    const first = fakeGemini({ failOn: COLD_CRITIC_USAGE_LABEL });
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
    expect(calledLabels(second.generateStructured)).toEqual([
      COLD_CRITIC_USAGE_LABEL,
      SOLUTION_DESIGNER_USAGE_LABEL,
      VERDICT_USAGE_LABEL,
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
    expect(store.loadReport(result.runId)).toContain(marketContext.ideaTitle);
  });

  it("산출물이 손상된 completed step은 재실행한다", async () => {
    const first = fakeGemini();
    const { runId } = await runPipeline(makeDeps(first.gemini), { idea: IDEA });

    // context 산출물을 손상시킨다 (steps상 status는 여전히 completed)
    store.saveStepOutput(runId, "context-hunter", {
      ...marketContext,
      competitors: "배열이 아니다",
    });

    const second = fakeGemini();
    await runPipeline(makeDeps(second.gemini), {
      idea: IDEA,
      resumeRunId: runId,
    });

    // context-hunter는 재실행(그 안에서 planner도 다시 돈다), 산출물이 멀쩡한 나머지 step은 skip
    expect(calledLabels(second.generateStructured)).toEqual([
      RESEARCH_PLANNER_USAGE_LABEL,
    ]);
    expect(calledLabels(second.generateGrounded)).toEqual([
      CONTEXT_HUNTER_USAGE_LABEL,
    ]);

    // 재실행으로 산출물이 복구된다
    expect(
      store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
    ).toEqual(marketContext);
  });

  // ADR-013: research는 step 산출물이 아니라 context-hunter의 부산물이다.
  // executeStep의 반환값은 context 아티팩트에만 저장되므로, 수집 증거는 별도로 영속화한다.
  describe("research 증거 영속화", () => {
    it("★ context-hunter 실행 시 수집 증거를 research 아티팩트로 저장한다", async () => {
      const { gemini } = fakeGemini();
      const save = vi.spyOn(store, "saveResearchEvidence");

      const { runId } = await runPipeline(makeDeps(gemini), { idea: IDEA });

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toBe(runId);

      // 저장소에도 남아야 한다 — 리포트 인용을 수집물과 대조할 원본이다
      const evidence = store.loadResearchEvidence(runId);
      expect(evidence).not.toBeNull();
      expect(evidence?.coverage).toEqual(marketContext.researchCoverage);
    });

    it("research는 step 산출물이 아니다", () => {
      // PIPELINE_STEPS·resume 판정·웹 진행 뷰까지 파급되므로 STEP_ARTIFACT_KINDS에 넣지 않는다
      expect(Object.values(STEP_ARTIFACT_KINDS)).not.toContain("research");
    });

    it("★ resume: context-hunter가 completed면 research를 재생성하지 않는다", async () => {
      // 1차 실행 — cold-critic에서 실패시켜 context-hunter만 completed로 남긴다
      const first = fakeGemini({ failOn: COLD_CRITIC_USAGE_LABEL });
      const error = (await runPipeline(makeDeps(first.gemini), {
        idea: IDEA,
      }).catch((e: unknown) => e)) as PipelineStepError;

      const save = vi.spyOn(store, "saveResearchEvidence");

      const second = fakeGemini();
      await runPipeline(makeDeps(second.gemini), {
        idea: IDEA,
        resumeRunId: error.runId,
      });

      // skip된 step은 run()이 호출되지 않는다 — 이미 저장돼 있으므로 정상이다
      expect(save).not.toHaveBeenCalled();
      expect(store.loadResearchEvidence(error.runId)).not.toBeNull();
    });
  });

  // 인터뷰 블록과 같은 pause/resume 모양이다 — detached CLI에는 stdin이 없으므로
  // opportunities·selection 아티팩트로 멈추고 이어간다 (ADR-007).
  describe("주제 발굴 (스카우트 흐름)", () => {
    const SCOPE = "배터리 산업";

    it("범위 힌트 자리표시자는 저장소와 에이전트가 같은 문자열을 쓴다", () => {
      // orchestrator가 "힌트 없음"을 이 문자열 비교로 판정한다 — 갈리면 플래너가
      // "전 범위 탐색"이라는 산업을 검색하려 든다
      expect(SCOUT_FULL_SCOPE_LABEL).toBe(SCOUT_FULL_SCOPE_IDEA);
    });

    it("★ 선택 전: 후보를 만들고 waiting으로 일시 중지한다 (하류 미실행)", async () => {
      const { gemini, generateStructured, generateGrounded, generateGroundedText } =
        fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });

      const result = await runPipeline(makeDeps(gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      expect(result.status).toBe("waiting");
      expect(result.report).toBeUndefined();

      // 주제 발굴 호출만 돌고 정반합은 시작조차 하지 않는다
      expect(calledLabels(generateStructured)).toEqual(SCOUT_LABELS);
      // 검색은 산문 grounding 경로다 — generateGrounded는 context-hunter 전용으로 남았다
      expect(calledLabels(generateGroundedText)).toEqual([
        SCOUT_SEARCH_USAGE_LABEL,
      ]);
      expect(generateGrounded).not.toHaveBeenCalled();

      // 후보가 저장됐고, 인용은 코드가 실체로 치환한 것이다 (ref 문자열이 남지 않는다)
      const opportunities = store.loadOpportunities(runId);
      expect(opportunities?.candidates.map((c) => c.id)).toEqual(["O1", "O2"]);
      expect(opportunities?.candidates[0].signals[0].citation).toEqual(
        scoutCitations[0],
      );
      expect(opportunities?.scope).toBe(SCOPE);

      // waiting은 에러가 아니다 — completedAt을 세팅하지 않는다
      const saved = store.loadRun(runId);
      expect(saved.steps.find((s) => s.name === "trend-scout")?.status).toBe(
        "waiting",
      );
      expect(saved.completedAt).toBeUndefined();
      expect(
        store.loadStepOutput(runId, "context-hunter", MarketContextSchema),
      ).toBeNull();
    });

    it("★ resume(선택 여전히 없음): 저장된 후보를 재사용하고 재검색하지 않는다", async () => {
      // grounded 검색은 이 파이프라인에서 가장 비싼 호출이다 (ADR-016) —
      // resume마다 다시 돌면 비용이 조용히 배로 뛴다
      const first = fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });
      const before = store.loadOpportunities(runId);

      const second = fakeGemini();
      const result = await runPipeline(makeDeps(second.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      expect(result.status).toBe("waiting");
      expect(calledLabels(second.generateStructured)).toEqual([]);
      expect(second.generateGrounded).not.toHaveBeenCalled();
      expect(store.loadOpportunities(runId)).toEqual(before);
    });

    it("★ 선택 제출 후 resume: 주제를 확정하고 정반합을 완주한다", async () => {
      const first = fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      // 사용자가 두 번째 후보를 고른다 — 첫 후보 폴백이면 이 테스트가 잡는다
      store.saveOpportunitySelection(runId, { candidateId: "O2" });

      const second = fakeGemini();
      const result = await runPipeline(makeDeps(second.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      expect(result.status).toBe("completed");
      // 주제 발굴은 다시 돌지 않고 자료조사부터 이어진다
      expect(calledLabels(second.generateStructured)).toEqual([
        RESEARCH_PLANNER_USAGE_LABEL,
        THESIS_USAGE_LABEL,
        COLD_CRITIC_USAGE_LABEL,
        SOLUTION_DESIGNER_USAGE_LABEL,
        VERDICT_USAGE_LABEL,
      ]);
      expect(calledLabels(second.generateGrounded)).toEqual([
        CONTEXT_HUNTER_USAGE_LABEL,
      ]);

      const saved = store.loadRun(runId);
      expect(saved.steps.map((s) => s.status)).toEqual([
        "completed",
        "completed",
        "completed",
        "completed",
        "completed",
        "completed",
      ]);
      expect(saved.completedAt).toBeDefined();
    });

    it("★ 확정된 idea는 후보의 title과 whatItIs를 모두 담는다", async () => {
      // 하류 에이전트는 idea만 보고 판단한다 — 제목만 넣으면 맥락이 통째로 날아간다
      const first = fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });
      store.saveOpportunitySelection(runId, { candidateId: "O2" });

      const second = fakeGemini();
      await runPipeline(makeDeps(second.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      const chosen = scoutDraft.candidates[1];
      const saved = store.loadRun(runId);
      expect(saved.idea).toContain(chosen.title);
      expect(saved.idea).toContain(chosen.whatItIs);
      // 범위 힌트는 확정 주제로 갈아끼워진다 — 목록에 남는 제목이 이 값이다
      expect(saved.idea).not.toBe(SCOPE);

      // 확정 주제가 실제로 하류 프롬프트까지 흐른다
      const plannerPrompt = (
        second.generateStructured.mock.calls[0][0] as { prompt: string }
      ).prompt;
      expect(plannerPrompt).toContain(chosen.title);
    });

    it("★ 선택된 후보가 자료조사 프롬프트로 흐른다 (근거를 idea 문자열로 압축하지 않는다)", async () => {
      // 反이 공격해야 할 대상은 "이 주제가 기회라는 판단"이다. 그 근거(신호·날짜·반대 증거)가
      // 프롬프트에 없으면 비판이 일반론이 되고, context는 正·反·合 전부에 주입된다
      const first = fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });
      store.saveOpportunitySelection(runId, { candidateId: "O2" });

      const second = fakeGemini();
      await runPipeline(makeDeps(second.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      const call = second.generateGrounded.mock.calls.find(
        ([params]: [{ usageLabel: string }]) =>
          params.usageLabel === CONTEXT_HUNTER_USAGE_LABEL,
      ) as [{ prompt: string }];
      const prompt = call[0].prompt;

      // 고른 후보(O2)의 근거가 들어가고, 고르지 않은 후보(O1)의 근거는 들어가지 않는다
      const chosen = scoutDraft.candidates[1];
      expect(prompt).toContain(CONTEXT_HUNTER_SCOUT_HEADING);
      expect(prompt).toContain(chosen.signals[0].statement);
      expect(prompt).toContain(chosen.counterSignal.statement);
      expect(prompt).not.toContain(
        scoutDraft.candidates[0].counterSignal.statement,
      );
    });

    it("★ 후보 0건: waiting이 아니라 error로 종료한다", async () => {
      // citations 0건이면 침묵 게이트가 합성을 건너뛴다 — 근거 없는 후보를 지어내지 않는
      // 것은 설계된 동작이지만, 파이프라인은 고를 것이 없어 진행할 수 없다
      const { gemini } = fakeGemini({ scoutCitations: [] });
      const { runId } = store.createRun(SCOPE, { scout: true });

      const promise = runPipeline(makeDeps(gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });
      await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
      const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
      expect(error.step).toBe("trend-scout");

      const saved = store.loadRun(runId);
      const step = saved.steps.find((s) => s.name === "trend-scout");
      expect(step?.status).toBe("error");
      expect(step?.failedAt).toBeDefined();
      // 사용자가 다음에 무엇을 할지 알려주는 메시지여야 한다 (모델 탓이 아니다)
      expect(step?.errorMessage).toContain("탐색 범위");
      expect(saved.completedAt).toBeUndefined();
      // 빈 결과도 저장한다 — resume이 같은 곳에서 멈춰야 재검색이 조용히 반복되지 않는다
      expect(store.loadOpportunities(runId)?.candidates).toEqual([]);
    });

    it("후보 0건 run을 resume해도 재검색하지 않고 같은 곳에서 멈춘다", async () => {
      const first = fakeGemini({ scoutCitations: [] });
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      }).catch(() => undefined);

      const second = fakeGemini({ scoutCitations: [] });
      await expect(
        runPipeline(makeDeps(second.gemini), {
          idea: SCOPE,
          resumeRunId: runId,
        }),
      ).rejects.toBeInstanceOf(PipelineStepError);

      // 저장된 빈 결과를 버리고 다시 검색하지 않는다 — 가장 비싼 호출이다
      expect(second.generateGrounded).not.toHaveBeenCalled();
      expect(calledLabels(second.generateStructured)).toEqual([]);
    });

    it("★ 존재하지 않는 candidateId: 첫 후보로 폴백하지 않고 error다", async () => {
      // 조용한 오답이 명시적 실패보다 나쁘다 — 사용자가 고르지 않은 주제로 리포트가 나온다
      const first = fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(first.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });
      store.saveOpportunitySelection(runId, { candidateId: "O99" });

      const second = fakeGemini();
      const promise = runPipeline(makeDeps(second.gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });
      await expect(promise).rejects.toBeInstanceOf(PipelineStepError);
      const error = (await promise.catch((e: unknown) => e)) as PipelineStepError;
      expect(error.step).toBe("trend-scout");

      const saved = store.loadRun(runId);
      expect(saved.steps.find((s) => s.name === "trend-scout")?.status).toBe(
        "error",
      );
      // 주제가 확정되지 않았다 — 범위 힌트 그대로다
      expect(saved.idea).toBe(SCOPE);
      expect(calledLabels(second.generateStructured)).toEqual([]);
      expect(store.loadReport(runId)).toBeNull();
    });

    it("스카우트 run에서는 interviewer를 실행하지 않는다", async () => {
      // 한 run에서 사용자를 두 번(후보 선택 → 질문 답변) 멈춰 세우지 않는다
      const { gemini, generateStructured } = fakeGemini({
        questions: { questions: [{ id: "q1", question: "타깃은?", why: "검증" }] },
      });
      const { runId } = store.createRun(SCOPE, { interview: true, scout: true });
      await runPipeline(makeDeps(gemini), { idea: SCOPE, resumeRunId: runId });

      store.saveOpportunitySelection(runId, { candidateId: "O1" });
      const result = await runPipeline(makeDeps(gemini), {
        idea: SCOPE,
        resumeRunId: runId,
      });

      expect(result.status).toBe("completed");
      expect(calledLabels(generateStructured)).not.toContain(
        INTERVIEWER_USAGE_LABEL,
      );
      expect(store.loadInterviewQuestions(runId)).toBeNull();
      // 유령 step이 생기지 않는다 — 진행 뷰와 resume 판정이 함께 망가진다
      expect(
        store.loadRun(runId).steps.map((s) => s.name),
      ).not.toContain("interviewer");
    });

    it("범위 힌트가 없으면 플래너에 자리표시자를 범위로 넘기지 않는다", async () => {
      const { gemini, generateStructured } = fakeGemini();
      // createRun이 빈 힌트를 SCOUT_FULL_SCOPE_IDEA로 확정한다
      const { runId, idea } = store.createRun("", { scout: true });
      expect(idea).toBe(SCOUT_FULL_SCOPE_IDEA);

      await runPipeline(makeDeps(gemini), { idea, resumeRunId: runId });

      // "전 범위 탐색"이라는 산업을 검색하게 두면 안 된다 — 전 범위 모드로 넘어가야 한다
      const plannerPrompt = (
        generateStructured.mock.calls[0][0] as { prompt: string }
      ).prompt;
      expect(plannerPrompt).toContain("특정 산업으로 좁히지 않는다");
      // 산출물의 scope 표기는 자리표시자 그대로다
      expect(store.loadOpportunities(runId)?.scope).toBe(SCOUT_FULL_SCOPE_IDEA);
    });

    it("후보 산출물은 저장 후에도 스키마를 통과한다 (resume 재사용의 전제)", async () => {
      const { gemini } = fakeGemini();
      const { runId } = store.createRun(SCOPE, { scout: true });
      await runPipeline(makeDeps(gemini), { idea: SCOPE, resumeRunId: runId });

      expect(
        store.loadStepOutput(runId, "trend-scout", OpportunitiesSchema),
      ).not.toBeNull();
    });
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
      expect(result.report).toBeUndefined();
      expect(store.loadReport(runId)).toBeNull();

      // 질문만 생성되고 하류 에이전트는 호출되지 않는다
      expect(calledLabels(generateStructured)).toEqual([
        INTERVIEWER_USAGE_LABEL,
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
      expect(calledLabels(second.generateStructured)).toEqual([
        RESEARCH_PLANNER_USAGE_LABEL,
        THESIS_USAGE_LABEL,
        COLD_CRITIC_USAGE_LABEL,
        SOLUTION_DESIGNER_USAGE_LABEL,
        VERDICT_USAGE_LABEL,
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
      expect(calledLabels(generateStructured)).toEqual([
        INTERVIEWER_USAGE_LABEL,
        RESEARCH_PLANNER_USAGE_LABEL,
        THESIS_USAGE_LABEL,
        COLD_CRITIC_USAGE_LABEL,
        SOLUTION_DESIGNER_USAGE_LABEL,
        VERDICT_USAGE_LABEL,
      ]);
      expect(calledLabels(generateGrounded)).toEqual([CONTEXT_HUNTER_USAGE_LABEL]);
      expect(store.loadRun(runId).completedAt).toBeDefined();
    });
  });
});
