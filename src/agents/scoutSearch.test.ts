import { describe, expect, it, vi } from "vitest";
import type { GeminiService, GroundingCitation } from "../services/gemini.js";
import {
  ScoutDossierSchema,
  SIGNAL_TYPES,
  type ScoutDossier,
  type ScoutQueries,
} from "../types/index.js";
import {
  SCOUT_SEARCH_CITATION_RETRIES,
  SCOUT_SEARCH_MAX_QUERIES_PER_AXIS,
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
  generateGroundedText: ReturnType<typeof vi.fn>;
  generateStructured: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function fakeDeps(
  result: {
    data?: ScoutDossier;
    citations?: GroundingCitation[];
    webSearchQueries?: string[];
    text?: string;
  } = {},
): FakeDeps {
  const generateGroundedText = vi.fn().mockResolvedValue({
    text: result.text ?? "관측된 사실 산문",
    citations: result.citations ?? CITATIONS,
    webSearchQueries: result.webSearchQueries ?? ["grid storage series B 2026"],
  });
  const generateStructured = vi.fn().mockResolvedValue(result.data ?? DOSSIER);
  const log = vi.fn();

  return {
    deps: {
      gemini: {
        generateGroundedText,
        generateStructured,
      } as unknown as GeminiService,
      log,
    },
    generateGroundedText,
    generateStructured,
    log,
  };
}

function paramsOf(mock: ReturnType<typeof vi.fn>): {
  prompt: string;
  schema: unknown;
  useUrlContext?: boolean;
  thinkingBudget?: number;
  citationRetries?: number;
  usageLabel: string;
  systemInstruction: string;
} {
  return mock.mock.calls[0][0];
}

describe("searchCapitalSignals", () => {
  it("★ 검색은 산문으로 받는다 — JSON을 강제하면 인용 귀속이 사라진다", async () => {
    const { deps, generateGroundedText } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(generateGroundedText).toHaveBeenCalledTimes(1);
    const params = paramsOf(generateGroundedText);
    // 산문 경로에는 스키마가 없다. 구조화는 뒤따르는 non-grounded 호출의 일이다
    expect(params.schema).toBeUndefined();
    expect(params.systemInstruction).toBe(SCOUT_SEARCH_SYSTEM_PROMPT);
    expect(params.usageLabel).toBe(SCOUT_SEARCH_USAGE_LABEL);
  });

  it("★ 산문을 non-grounded 호출로 ScoutDossier에 담는다", async () => {
    const { deps, generateStructured } = fakeDeps({ text: "관측 산문 본문" });

    const result = await searchCapitalSignals(deps, QUERIES);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = paramsOf(generateStructured);
    expect(params.schema).toBe(ScoutDossierSchema);
    // 구조화 호출은 검색한 산문만 보고 옮겨 적는다 — 새 사실을 만들 여지를 주지 않는다
    expect(params.prompt).toContain("관측 산문 본문");
    expect(result.dossier).toEqual(DOSSIER);
  });

  it("★ 축마다 검색어를 상한까지만 싣는다 — 검색이 넓어지면 인용 귀속이 사라진다", async () => {
    const { deps, generateGroundedText } = fakeDeps();

    await searchCapitalSignals(deps, {
      funding: ["f1", "f2", "f3", "f4"],
      incumbent: ["i1", "i2", "i3"],
      regulation: ["r1"],
      costCurve: ["c1", "c2"],
    });

    const { prompt } = paramsOf(generateGroundedText);
    expect(prompt).toContain("f1");
    expect(prompt).toContain("f2");
    // 상한을 넘은 검색어는 프롬프트에 실리지 않는다
    expect(prompt).not.toContain("f3");
    expect(prompt).not.toContain("f4");
    expect(prompt).not.toContain("i3");
    // 상한 미만인 축은 그대로 간다
    expect(prompt).toContain("r1");
    expect(prompt).toContain("c2");
    expect(SCOUT_SEARCH_MAX_QUERIES_PER_AXIS).toBe(2);
  });

  it("★ citationRetries를 켠다 — 인용 0건이면 스카우트는 후보를 하나도 못 만든다", async () => {
    const { deps, generateGroundedText } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    // groundingChunks는 비결정적이라 같은 요청이 다음 번에 인용을 싣는다.
    // 이 호출만 인용이 필수다 — context-hunter는 0건이어도 진행한다.
    expect(paramsOf(generateGroundedText).citationRetries).toBe(
      SCOUT_SEARCH_CITATION_RETRIES,
    );
    expect(SCOUT_SEARCH_CITATION_RETRIES).toBeGreaterThan(0);
  });

  it("★ useUrlContext: false — 사전에 읽을 대상 URL이 없어 왕복만 늘어난다", async () => {
    const { deps, generateGroundedText } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(paramsOf(generateGroundedText).useUrlContext).toBe(false);
  });

  it("thinkingBudget 4096 — contextHunter(8192)보다 가볍고 planner(0)보다 무겁다", async () => {
    const { deps, generateGroundedText } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    expect(paramsOf(generateGroundedText).thinkingBudget).toBe(
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
    const { deps, generateGroundedText } = fakeDeps();

    await searchCapitalSignals(deps, QUERIES);

    const { prompt } = paramsOf(generateGroundedText);
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
    const generateGroundedText = vi.fn().mockResolvedValue({
      text: "본문",
      citations: CITATIONS,
      webSearchQueries: [],
    });
    const generateStructured = vi.fn().mockResolvedValue(DOSSIER);

    await expect(
      searchCapitalSignals(
        {
          gemini: {
            generateGroundedText,
            generateStructured,
          } as unknown as GeminiService,
        },
        QUERIES,
      ),
    ).resolves.toMatchObject({ dossier: DOSSIER });
  });

  it("★ 인용 0건이면 구조화 호출을 건너뛴다 — 근거 없는 관측은 하류가 전부 버린다", async () => {
    const { deps, generateStructured } = fakeDeps({ citations: [] });

    const result = await searchCapitalSignals(deps, QUERIES);

    // 침묵 게이트가 어차피 버릴 findings를 만드느라 토큰을 쓰지 않는다 (ADR-019)
    expect(generateStructured).not.toHaveBeenCalled();
    expect(result.dossier.findings).toEqual([]);
    expect(result.citations).toEqual([]);
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
