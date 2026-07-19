import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";
import type { GeminiService, GroundingCitation } from "../services/gemini.js";
import type {
  OpportunitiesDraft,
  OpportunityDraft,
  ScoutDossier,
  ScoutQueries,
} from "../types/index.js";
import { SCOUT_PLANNER_USAGE_LABEL, scoutWindowStart } from "./scoutPlanner.js";
import { SCOUT_STRUCTURE_USAGE_LABEL } from "./scoutSearch.js";
import {
  runTrendScout,
  TREND_SCOUT_THINKING_BUDGET,
  TREND_SCOUT_USAGE_LABEL,
  type TrendScoutDeps,
} from "./trendScout.js";

// 시각 성분을 남긴다 — 실제 배선은 orchestrator의 `new Date()`라 자정이 아니다.
// 자정 픽스처는 날짜창 경계의 어긋남을 통째로 가린다.
const NOW = new Date("2026-07-19T14:32:11.000Z");

const QUERIES: ScoutQueries = {
  funding: ["grid storage series B 2026"],
  incumbent: ["utility capex guidance 2026"],
  regulation: ["EU battery passport enforcement date"],
  costCurve: ["LFP cell $/kWh 2026"],
};

const DOSSIER: ScoutDossier = {
  findings: [
    {
      signalType: "funding",
      statement: "계통 저장 스타트업 3곳이 시리즈 B를 마감했다",
      observedAt: "2026-03-11",
    },
    {
      signalType: "regulation",
      statement: "EU 배터리 여권 규정이 2027-02-18 시행된다",
      observedAt: "2026-01-20",
    },
  ],
};

const CITATIONS: GroundingCitation[] = [
  {
    uri: "https://vertexaisearch.example/redirect/abc",
    title: "Grid storage funding roundup",
    domain: "techfunding.example",
    kind: "redirect",
  },
  {
    uri: "https://eur-lex.example/battery-passport",
    title: "Battery passport regulation",
    domain: "eur-lex.example",
    kind: "origin",
  },
  { uri: "https://c.example/report", kind: "redirect" },
];

/** 팩토리 제약(삼각측량·날짜창·수치 귀속)을 전부 만족하는 후보 */
function draftCandidate(
  overrides: Partial<OpportunityDraft> = {},
): OpportunityDraft {
  return {
    id: "O1",
    title: "배터리 여권 대응 데이터 파이프라인",
    whatItIs: "셀 단위 이력을 규제 서식으로 자동 제출하는 SaaS다.",
    signals: [
      {
        signalType: "funding",
        statement: "계통 저장 스타트업 3곳이 시리즈 B를 마감했다",
        observedAt: "2026-03-11",
        citationRef: "C1",
        figures: [],
      },
      {
        signalType: "regulation",
        statement: "EU 배터리 여권 규정 시행일이 확정됐다",
        observedAt: "2026-01-20",
        effectiveAt: "2027-02-18",
        citationRef: "C2",
        figures: [],
      },
    ],
    counterSignal: {
      signalType: "incumbent",
      statement: "대형 ERP 벤더가 같은 보고 모듈을 로드맵에 올렸다",
      observedAt: "2026-05-02",
      citationRef: "C2",
      figures: [],
    },
    whyNow: "시행일 전 18개월이 도입 결정 구간이다.",
    whoPays: "EU에 셀을 출하하는 배터리 제조사",
    horizon: "mid",
    ...overrides,
  };
}

interface FakeDeps {
  deps: TrendScoutDeps;
  generateStructured: ReturnType<typeof vi.fn>;
  generateGroundedText: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  options: {
    citations?: GroundingCitation[];
    dossier?: ScoutDossier;
    draft?: OpportunitiesDraft;
  } = {},
): FakeDeps {
  const generateStructured = vi.fn(
    async (params: { usageLabel: string }): Promise<unknown> => {
      if (params.usageLabel === SCOUT_PLANNER_USAGE_LABEL) {
        return QUERIES;
      }
      if (params.usageLabel === SCOUT_STRUCTURE_USAGE_LABEL) {
        return options.dossier ?? DOSSIER;
      }
      return options.draft ?? { candidates: [draftCandidate()] };
    },
  );
  // 검색은 산문으로 받고 구조화는 별도 non-grounded 호출이 한다 (인용 귀속 보존)
  const generateGroundedText = vi.fn().mockResolvedValue({
    text: "관측된 사실 산문",
    citations: options.citations ?? CITATIONS,
    webSearchQueries: ["grid storage series B 2026"],
  });
  const log = vi.fn();

  return {
    deps: {
      gemini: {
        generateStructured,
        generateGroundedText,
      } as unknown as GeminiService,
      log,
    },
    generateStructured,
    generateGroundedText,
    log,
  };
}

/** 합성 호출의 인자. planner 호출과 섞이지 않게 usageLabel로 고른다 */
function synthesisCall(generateStructured: ReturnType<typeof vi.fn>): {
  prompt: string;
  systemInstruction: string;
  usageLabel: string;
  thinkingBudget?: number;
  schema: ZodType<OpportunitiesDraft>;
} {
  const call = generateStructured.mock.calls.find(
    (args) => args[0].usageLabel === TREND_SCOUT_USAGE_LABEL,
  );
  if (call === undefined) {
    throw new Error("합성 호출이 없다");
  }
  return call[0];
}

describe("runTrendScout — 침묵 게이트", () => {
  it("★ citations 0건이면 합성 호출 자체를 하지 않고 candidates를 비운다", async () => {
    // 근거가 하나도 없는 상태에서 만든 후보는 전부 모델의 사전지식, 즉 환각이다
    const { deps, generateStructured } = fakeDeps({
      citations: [],
      dossier: { findings: [] },
    });

    const result = await runTrendScout(deps, "배터리", NOW);

    expect(result.candidates).toEqual([]);
    const synthesis = generateStructured.mock.calls.filter(
      (args) => args[0].usageLabel === TREND_SCOUT_USAGE_LABEL,
    );
    expect(synthesis).toHaveLength(0);
  });

  it("★ findings가 있어도 citations가 0건이면 합성하지 않는다", async () => {
    // findings는 모델의 서술이고 citations는 코드가 추출한 사실이다 — 후자가 없으면 귀속이 불가능하다
    const { deps, generateStructured } = fakeDeps({ citations: [] });

    const result = await runTrendScout(deps, undefined, NOW);

    expect(result.candidates).toEqual([]);
    expect(
      generateStructured.mock.calls.some(
        (args) => args[0].usageLabel === TREND_SCOUT_USAGE_LABEL,
      ),
    ).toBe(false);
  });

  it("침묵을 로그로 남긴다 — 빈 배열은 눈치채기 어렵다", async () => {
    const { deps, log } = fakeDeps({ citations: [] });

    await runTrendScout(deps, "배터리", NOW);

    expect(
      log.mock.calls.map((call) => String(call[0])).some((m) => m.includes("인용")),
    ).toBe(true);
  });

  it("침묵해도 scope·searchedAt은 채운다 — 코드가 아는 사실이다", async () => {
    const { deps } = fakeDeps({ citations: [] });

    const result = await runTrendScout(deps, "배터리 규제", NOW);

    expect(result.scope).toBe("배터리 규제");
    expect(result.searchedAt).toBe(NOW.toISOString());
  });
});

describe("runTrendScout — 프롬프트", () => {
  it("★ 인용을 [C1]·[C2] 형태로 번호 붙여 넣는다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { prompt } = synthesisCall(generateStructured);
    expect(prompt).toContain("[C1]");
    expect(prompt).toContain("[C2]");
    expect(prompt).toContain("[C3]");
  });

  it("★ 인용의 title·domain을 노출한다 — LLM이 판단할 수 있는 정보다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { prompt } = synthesisCall(generateStructured);
    expect(prompt).toContain("Grid storage funding roundup");
    expect(prompt).toContain("techfunding.example");
  });

  it("★ dossier의 findings도 함께 넣는다 — 인용과 findings는 별개의 목록이다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { prompt } = synthesisCall(generateStructured);
    for (const finding of DOSSIER.findings) {
      expect(prompt).toContain(finding.statement);
    }
  });

  it("플레이스홀더를 남기지 않고 usageLabel·thinkingBudget이 배선돼 있다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const params = synthesisCall(generateStructured);
    expect(params.prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(params.usageLabel).toBe(TREND_SCOUT_USAGE_LABEL);
    expect(params.thinkingBudget).toBe(TREND_SCOUT_THINKING_BUDGET);
    expect(TREND_SCOUT_USAGE_LABEL).toBe("trend-scout");
  });

  it("★ scope가 undefined여도 정상 동작한다 — 범위 미지정이 기본 사용법이다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await runTrendScout(deps, undefined, NOW);

    expect(result.scope.length).toBeGreaterThan(0);
    expect(result.candidates).toHaveLength(1);
    expect(synthesisCall(generateStructured).prompt).not.toContain("undefined");
  });
});

describe("runTrendScout — 스키마 팩토리 배선 (ADR-017)", () => {
  it("★ 넘어간 schema가 화이트리스트 밖 ref를 거부한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { schema } = synthesisCall(generateStructured);
    const outside = draftCandidate({
      signals: [
        { ...draftCandidate().signals[0], citationRef: "C9" },
        draftCandidate().signals[1],
      ],
    });

    expect(schema.safeParse({ candidates: [outside] }).success).toBe(false);
    expect(schema.safeParse({ candidates: [draftCandidate()] }).success).toBe(true);
  });

  it("★ 후보가 6개면 검증에 실패한다 (최대 5)", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { schema } = synthesisCall(generateStructured);
    const six = Array.from({ length: 6 }, (_, index) =>
      draftCandidate({ id: `O${index + 1}` }),
    );

    expect(schema.safeParse({ candidates: six }).success).toBe(false);
    expect(schema.safeParse({ candidates: six.slice(0, 5) }).success).toBe(true);
  });

  it("★ 날짜창 밖 observedAt을 거부한다 — 검색 없이 채울 수 없는 필드다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { schema } = synthesisCall(generateStructured);
    const stale = draftCandidate({
      signals: [
        { ...draftCandidate().signals[0], observedAt: "2019-01-01" },
        draftCandidate().signals[1],
      ],
    });

    expect(schema.safeParse({ candidates: [stale] }).success).toBe(false);
  });

  // scoutPlanner → trendScout → opportunitiesSchemaFor 전 경로를 한 번에 묶는다.
  // 프롬프트는 windowStart를 날짜로만 보여주므로(.slice(0,10)) 모델이 그 경계일을 그대로
  // 쓰는 것은 정당하다 — 그런데 검증이 시각까지 비교하면 거부되고, 그 피드백은
  // `"2025-01-19"이 탐색 구간(2025-01-19 이후) 밖이다`라 모델이 고칠 수가 없다.
  it("★ 프롬프트가 광고한 날짜창 경계일을 그대로 쓰면 통과한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { schema, prompt } = synthesisCall(generateStructured);
    const boundary = scoutWindowStart(NOW).toISOString().slice(0, 10);
    const onBoundary = draftCandidate({
      signals: [
        { ...draftCandidate().signals[0], observedAt: boundary },
        draftCandidate().signals[1],
      ],
    });

    // 프롬프트가 실제로 그 날짜를 보여준다는 것이 이 테스트의 전제다
    expect(prompt).toContain(boundary);
    expect(schema.safeParse({ candidates: [onBoundary] }).success).toBe(true);
  });

  it("★ 오늘 관측된 신호를 미래로 판정하지 않는다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    const { schema } = synthesisCall(generateStructured);
    const today = draftCandidate({
      signals: [
        {
          ...draftCandidate().signals[0],
          observedAt: NOW.toISOString().slice(0, 10),
        },
        draftCandidate().signals[1],
      ],
    });

    expect(schema.safeParse({ candidates: [today] }).success).toBe(true);
  });
});

describe("runTrendScout — ID → 실체 치환 (ADR-013)", () => {
  it("★ 최종 산출물에 citationRef 문자열이 남지 않는다", async () => {
    const { deps } = fakeDeps();

    const result = await runTrendScout(deps, "배터리", NOW);

    expect(JSON.stringify(result)).not.toContain("citationRef");
    expect(JSON.stringify(result)).not.toContain('"C1"');
  });

  it("★ 유효한 ID가 해당 citation의 title·domain·kind로 치환된다", async () => {
    const { deps } = fakeDeps();

    const result = await runTrendScout(deps, "배터리", NOW);
    const [candidate] = result.candidates;

    expect(candidate.signals[0].citation).toEqual(CITATIONS[0]);
    expect(candidate.signals[0].citation.title).toBe("Grid storage funding roundup");
    expect(candidate.signals[0].citation.domain).toBe("techfunding.example");
    expect(candidate.signals[1].citation).toEqual(CITATIONS[1]);
    expect(candidate.counterSignal.citation).toEqual(CITATIONS[1]);
  });

  it("★ figures의 ref도 실제 citation으로 치환된다", async () => {
    const { deps } = fakeDeps({
      draft: {
        candidates: [
          draftCandidate({
            signals: [
              {
                ...draftCandidate().signals[0],
                statement: "시리즈 B로 $4.2B가 들어갔다",
                figures: [{ value: "$4.2B", citationRef: "C1" }],
              },
              draftCandidate().signals[1],
            ],
          }),
        ],
      },
    });

    const result = await runTrendScout(deps, "배터리", NOW);
    const [figure] = result.candidates[0].signals[0].figures;

    expect(figure.value).toBe("$4.2B");
    expect(figure.citation).toEqual(CITATIONS[0]);
  });

  it("★ 모르는 ref는 퍼지 매칭하지 않고 드롭 + 로그다", async () => {
    // 스키마가 이미 화이트리스트를 강제하므로 여기 걸리면 방어적 이중 장치가 작동한 것이다.
    // "가장 비슷한 인용"으로 때우면 환각이 그럴듯한 근거로 세탁된다.
    const { deps, log } = fakeDeps({
      draft: {
        candidates: [
          draftCandidate({
            counterSignal: {
              ...draftCandidate().counterSignal,
              citationRef: "C99",
            },
          }),
        ],
      },
    });

    const result = await runTrendScout(deps, "배터리", NOW);

    expect(result.candidates).toEqual([]);
    expect(
      log.mock.calls.map((call) => String(call[0])).some((m) => m.includes("C99")),
    ).toBe(true);
  });

  it("신호가 드롭돼 2건 미만이 되면 후보를 통째로 드롭한다 (삼각측량 붕괴)", async () => {
    const { deps, log } = fakeDeps({
      draft: {
        candidates: [
          draftCandidate({
            signals: [
              { ...draftCandidate().signals[0], citationRef: "C7" },
              draftCandidate().signals[1],
            ],
          }),
        ],
      },
    });

    const result = await runTrendScout(deps, "배터리", NOW);

    expect(result.candidates).toEqual([]);
    expect(
      log.mock.calls.map((call) => String(call[0])).some((m) => m.includes("C7")),
    ).toBe(true);
  });
});

describe("runTrendScout — 단계 배선", () => {
  it("planner → grounded 검색 → 구조화 → 합성 순으로 각자의 라벨로 남는다 (ADR-016)", async () => {
    const { deps, generateStructured, generateGroundedText } = fakeDeps();

    await runTrendScout(deps, "배터리", NOW);

    // grounded는 산문 검색 1회뿐이다 — 구조화는 non-grounded라 정액 요금을 다시 태우지 않는다
    expect(generateGroundedText).toHaveBeenCalledTimes(1);
    const labels = generateStructured.mock.calls.map((args) => args[0].usageLabel);
    expect(labels).toEqual([
      SCOUT_PLANNER_USAGE_LABEL,
      SCOUT_STRUCTURE_USAGE_LABEL,
      TREND_SCOUT_USAGE_LABEL,
    ]);
  });

  it("log가 없어도 throw하지 않는다", async () => {
    const { deps } = fakeDeps();

    await expect(
      runTrendScout({ gemini: deps.gemini }, undefined, NOW),
    ).resolves.toMatchObject({ searchedAt: NOW.toISOString() });
  });
});
