import { describe, expect, it, vi } from "vitest";
import type { GeminiService, GroundingCitation } from "../services/gemini.js";
import {
  ScoutDossierSchema,
  SIGNAL_TYPES,
  type ScoutDossier,
  type ScoutQueries,
} from "../types/index.js";
import {
  SCOUT_SEARCH_PROMPT_TEMPLATE,
  SCOUT_SEARCH_SYSTEM_PROMPT,
  SCOUT_SEARCH_THINKING_BUDGET,
  SCOUT_SEARCH_USAGE_LABEL,
  searchCapitalSignals,
  type ScoutSearchDeps,
} from "./scoutSearch.js";

const QUERIES: ScoutQueries = {
  funding: ["grid storage series B 2026"],
  incumbent: ["utility capex guidance transmission 2026"],
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
  { uri: "https://a.example", title: "A", kind: "redirect" },
  { uri: "https://b.example", kind: "origin" },
];

interface FakeDeps {
  deps: ScoutSearchDeps;
  generateGrounded: ReturnType<typeof vi.fn>;
  generateStructured: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  result: {
    data?: ScoutDossier;
    citations?: GroundingCitation[];
    webSearchQueries?: string[];
  } = {},
): FakeDeps {
  const generateGrounded = vi.fn().mockResolvedValue({
    data: result.data ?? DOSSIER,
    citations: result.citations ?? CITATIONS,
    webSearchQueries: result.webSearchQueries ?? ["grid storage series B 2026"],
  });
  const generateStructured = vi.fn();
  const log = vi.fn();

  return {
    deps: {
      gemini: {
        generateGrounded,
        generateStructured,
      } as unknown as GeminiService,
      log,
    },
    generateGrounded,
    generateStructured,
    log,
  };
}

function paramsOf(generateGrounded: ReturnType<typeof vi.fn>): {
  prompt: string;
  schema: unknown;
  useUrlContext?: boolean;
  thinkingBudget?: number;
  usageLabel: string;
  systemInstruction: string;
} {
  return generateGrounded.mock.calls[0][0];
}

describe("searchCapitalSignals", () => {
  it("★ generateGrounded에 ScoutDossierSchema를 전달한다 — 후보가 아니라 사실 목록이다", async () => {
    const { deps, generateGrounded } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(generateGrounded).toHaveBeenCalledTimes(1);
    const params = paramsOf(generateGrounded);
    expect(params.schema).toBe(ScoutDossierSchema);
    expect(params.systemInstruction).toBe(SCOUT_SEARCH_SYSTEM_PROMPT);
    expect(params.usageLabel).toBe(SCOUT_SEARCH_USAGE_LABEL);
  });

  it("★ useUrlContext: false — 사전에 읽을 대상 URL이 없어 왕복만 늘어난다", async () => {
    const { deps, generateGrounded } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(paramsOf(generateGrounded).useUrlContext).toBe(false);
  });

  it("thinkingBudget 4096 — contextHunter(8192)보다 가볍고 planner(0)보다 무겁다", async () => {
    const { deps, generateGrounded } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(paramsOf(generateGrounded).thinkingBudget).toBe(
      SCOUT_SEARCH_THINKING_BUDGET,
    );
    expect(SCOUT_SEARCH_THINKING_BUDGET).toBe(4096);
  });

  it("★ citations를 그대로 실어 반환한다 (코드가 추출한 사실이다)", async () => {
    const { deps } = fakeDeps();

    const result = await searchCapitalSignals(deps, QUERIES);

    expect(result.citations).toEqual(CITATIONS);
    expect(result.dossier).toEqual(DOSSIER);
    expect(result.webSearchQueries).toEqual(["grid storage series B 2026"]);
  });

  it("★ grounding이 아무것도 못 찾아 citations가 0건이어도 throw하지 않는다", async () => {
    // 침묵은 정상 상태다 — 빈손으로 돌아올 길이 없으면 모델은 환각을 만든다
    const { deps } = fakeDeps({
      data: { findings: [] },
      citations: [],
      webSearchQueries: [],
    });

    const result = await searchCapitalSignals(deps, QUERIES);

    expect(result.citations).toEqual([]);
    expect(result.dossier.findings).toEqual([]);
  });

  it("★ 네 축 검색어가 전부 프롬프트에 들어간다 — 빠진 축은 조사되지 않는다", async () => {
    const { deps, generateGrounded } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    const { prompt } = paramsOf(generateGrounded);
    for (const axis of SIGNAL_TYPES) {
      for (const query of QUERIES[axis]) {
        expect(prompt).toContain(query);
      }
    }
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  it("모델이 실제로 검색한 쿼리를 로그로 남긴다 (검색어 설계의 유일한 관측 수단)", async () => {
    const { deps, log } = fakeDeps({
      webSearchQueries: ["battery passport enforcement", "LFP price 2026"],
    });

    await searchCapitalSignals(deps, QUERIES);

    const messages = log.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes("battery passport enforcement"))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes("LFP price 2026"))).toBe(true);
  });

  it("검색된 쿼리가 0건이어도, log가 없어도 throw하지 않는다", async () => {
    const generateGrounded = vi.fn().mockResolvedValue({
      data: DOSSIER,
      citations: [],
      webSearchQueries: [],
    });

    await expect(
      searchCapitalSignals(
        { gemini: { generateGrounded } as unknown as GeminiService },
        QUERIES,
      ),
    ).resolves.toMatchObject({ dossier: DOSSIER });
  });

  it("non-grounded 경로를 쓰지 않는다 — 이 단계가 실제 검색이다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(generateStructured).not.toHaveBeenCalled();
  });
});

describe("SCOUT_SEARCH_SYSTEM_PROMPT (역할 경계)", () => {
  it("★ 사업 아이디어·후보를 만들지 말라고 명시한다", () => {
    // 여기서 후보를 만들면 번호 붙은 인용을 보지 못한 상태의 산출물이라 귀속을 강제할 수 없다.
    // 두 단계로 나눈 이유 전체가 이것이다.
    expect(SCOUT_SEARCH_SYSTEM_PROMPT).toMatch(/사업 아이디어|후보/);
    expect(SCOUT_SEARCH_SYSTEM_PROMPT).toContain("만들지 마라");
  });

  it("관측된 사실만 기록하라고 지시한다", () => {
    expect(SCOUT_SEARCH_SYSTEM_PROMPT).toContain("관측");
  });

  it.each(SIGNAL_TYPES)("신호 축 %s를 명시한다", (axis) => {
    expect(SCOUT_SEARCH_SYSTEM_PROMPT).toContain(axis);
  });
});

describe("SCOUT_SEARCH_PROMPT_TEMPLATE", () => {
  it("축별 검색어 placeholder를 갖는다", () => {
    expect(SCOUT_SEARCH_PROMPT_TEMPLATE).toContain("{queries}");
  });
});
