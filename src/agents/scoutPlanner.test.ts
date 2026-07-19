import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  ScoutQueriesSchema,
  SIGNAL_TYPES,
  type ScoutQueries,
} from "../types/index.js";
import {
  SCOUT_LOOKBACK_MONTHS,
  SCOUT_PLANNER_PROMPT_TEMPLATE,
  SCOUT_PLANNER_SYSTEM_PROMPT,
  SCOUT_PLANNER_THINKING_BUDGET,
  SCOUT_PLANNER_USAGE_LABEL,
  planScoutQueries,
  scoutWindowStart,
  type ScoutPlannerDeps,
} from "./scoutPlanner.js";

const NOW = new Date("2026-07-19T00:00:00.000Z");
const SCOPE = "에너지 저장 인프라";

const QUERIES: ScoutQueries = {
  funding: ["grid storage series B 2026"],
  incumbent: ["utility capex guidance transmission 2026"],
  regulation: ["EU battery passport enforcement date"],
  costCurve: ["LFP cell $/kWh 2026"],
};

interface FakeDeps {
  deps: ScoutPlannerDeps;
  generateStructured: ReturnType<typeof vi.fn>;
  generateGrounded: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

function fakeDeps(error?: Error): FakeDeps {
  const generateStructured =
    error === undefined
      ? vi.fn().mockResolvedValue(QUERIES)
      : vi.fn().mockRejectedValue(error);
  const generateGrounded = vi.fn();
  const log = vi.fn();

  return {
    deps: {
      gemini: {
        generateStructured,
        generateGrounded,
      } as unknown as GeminiService,
      log,
    },
    generateStructured,
    generateGrounded,
    log,
  };
}

function promptOf(generateStructured: ReturnType<typeof vi.fn>): string {
  return generateStructured.mock.calls[0][0].prompt as string;
}

describe("planScoutQueries", () => {
  it("ScoutQueries 스키마로 구조화 출력을 1회 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await planScoutQueries(deps, SCOPE, NOW);

    expect(result).toEqual(QUERIES);
    expect(ScoutQueriesSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.schema).toBe(ScoutQueriesSchema);
    expect(params.systemInstruction).toBe(SCOUT_PLANNER_SYSTEM_PROMPT);
    expect(params.usageLabel).toBe(SCOUT_PLANNER_USAGE_LABEL);
  });

  it("★ grounding을 쓰지 않는다 — 검색어를 짓는 단계지 검색하는 단계가 아니다", async () => {
    // 비싼 grounded 호출은 scoutSearch가 한다. 여기서 켜면 형식 실패가 정액 요금을 태운다 (ADR-016)
    const { deps, generateGrounded } = fakeDeps();

    await planScoutQueries(deps, SCOPE, NOW);

    expect(generateGrounded).not.toHaveBeenCalled();
  });

  it("★ scope가 있으면 네 축 전부를 그 범위로 좁히라고 프롬프트에 싣는다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await planScoutQueries(deps, SCOPE, NOW);

    const prompt = promptOf(generateStructured);
    expect(prompt).toContain(SCOPE);
    // 축 하나만 좁히고 나머지를 흘리면 삼각측량이 성립하지 않는다
    expect(prompt).toMatch(/네 축 전부|모든 축/);
  });

  it("★ scope가 undefined여도 에러가 아니다 — 전 범위 탐색이 정상 모드다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await planScoutQueries(deps, undefined, NOW);

    expect(result).toEqual(QUERIES);
    const prompt = promptOf(generateStructured);
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(prompt).toContain("전 범위");
  });

  it("scope가 공백뿐이어도 전 범위 탐색으로 다룬다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await planScoutQueries(deps, "   ", NOW);

    const prompt = promptOf(generateStructured);
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(prompt).toContain("전 범위");
  });

  it("★ now 기준 탐색 날짜창을 프롬프트에 박는다", async () => {
    // 날짜창이 없으면 모델은 사전지식의 과거 트렌드를 현재로 착각해 뱉는다
    const { deps, generateStructured } = fakeDeps();

    await planScoutQueries(deps, SCOPE, NOW);

    const prompt = promptOf(generateStructured);
    expect(prompt).toContain("2026-07-19");
    expect(prompt).toContain(scoutWindowStart(NOW).toISOString().slice(0, 10));
  });
});

describe("scoutWindowStart", () => {
  it("SCOUT_LOOKBACK_MONTHS만큼 과거를 가리킨다 (기본 18개월)", () => {
    expect(SCOUT_LOOKBACK_MONTHS).toBe(18);
    // 2026-07-19에서 18개월 전 = 2025-01-19
    expect(scoutWindowStart(NOW).toISOString().slice(0, 10)).toBe("2025-01-19");
  });

  it("인자로 받은 Date를 변형하지 않는다", () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    scoutWindowStart(now);
    expect(now.toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });
});

describe("planScoutQueries (fail-soft 폴백)", () => {
  it("★ Gemini가 실패해도 throw하지 않고 축별 기본 검색어로 폴백한다", async () => {
    // 검색어 생성 실패는 탐색을 멈출 이유가 아니다 (researchPlanner와 같은 규약)
    const { deps } = fakeDeps(new Error("Gemini 구조화 출력이 3회 시도 후에도 검증에 실패했다"));

    const result = await planScoutQueries(deps, SCOPE, NOW);

    expect(ScoutQueriesSchema.safeParse(result).success).toBe(true);
    for (const axis of SIGNAL_TYPES) {
      expect(result[axis].length).toBeGreaterThan(0);
    }
  });

  it("폴백 검색어도 scope가 있으면 네 축 전부에 반영한다", async () => {
    const { deps } = fakeDeps(new Error("실패"));

    const result = await planScoutQueries(deps, SCOPE, NOW);

    for (const axis of SIGNAL_TYPES) {
      expect(result[axis].every((query) => query.includes(SCOPE))).toBe(true);
    }
  });

  it("scope 없이 폴백해도 네 축이 전부 채워진다", async () => {
    const { deps } = fakeDeps(new Error("실패"));

    const result = await planScoutQueries(deps, undefined, NOW);

    expect(ScoutQueriesSchema.safeParse(result).success).toBe(true);
  });

  it("폴백이 발동하면 로그를 남긴다 (검색어 품질 저하가 조용히 지나가면 안 된다)", async () => {
    const { deps, log } = fakeDeps(new Error("Gemini 호출 실패"));

    await planScoutQueries(deps, SCOPE, NOW);

    expect(log).toHaveBeenCalledTimes(1);
    const message = String(log.mock.calls[0][0]);
    expect(message).toContain("폴백");
    expect(message).toContain("Gemini 호출 실패");
  });

  it("log가 주어지지 않아도 폴백이 throw하지 않는다", async () => {
    const generateStructured = vi.fn().mockRejectedValue(new Error("실패"));
    const deps: ScoutPlannerDeps = {
      gemini: { generateStructured } as unknown as GeminiService,
    };

    await expect(
      planScoutQueries(deps, undefined, NOW),
    ).resolves.toBeDefined();
  });
});

describe("SCOUT_PLANNER_SYSTEM_PROMPT (자본 흐름 계약)", () => {
  it.each(SIGNAL_TYPES)("신호 축 %s의 검색 대상을 지시한다", (axis) => {
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toContain(axis);
  });

  it("★ 인기·화제성·조회수를 겨냥하지 말라고 명시한다", () => {
    // 그것은 자본 흐름이 아니라 이미 늦은 시장의 신호다
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toMatch(/인기|화제성|조회수/);
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toContain("검색하지 마라");
  });

  it("★ regulation에 비중을 실으라고 지시한다", () => {
    // 네 축 중 유일하게 1차 사료가 공개돼 있고, 시행일이 강제 지출을 만든다
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toContain("시행일");
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toContain("비중");
  });

  it("★ 시차(돈과 제품 사이의 간극)를 검색하라고 지시한다", () => {
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toContain("시차");
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toMatch(/아직|간극/);
  });

  it("검색을 수행하는 단계가 아님을 명시한다 (grounding과의 역할 분리)", () => {
    expect(SCOUT_PLANNER_SYSTEM_PROMPT).toContain("검색을 수행하지 않는다");
  });
});

describe("SCOUT_PLANNER_PROMPT_TEMPLATE", () => {
  it("{scope}·{windowStart}·{now} placeholder를 갖는다", () => {
    expect(SCOUT_PLANNER_PROMPT_TEMPLATE).toContain("{scope}");
    expect(SCOUT_PLANNER_PROMPT_TEMPLATE).toContain("{windowStart}");
    expect(SCOUT_PLANNER_PROMPT_TEMPLATE).toContain("{now}");
  });
});

describe("thinking 상한 (ADR-016)", () => {
  it("thinking을 끈다 — 검색어 생성은 판단이 아니라 형식 변환이다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await planScoutQueries(deps, SCOPE, NOW);

    expect(generateStructured.mock.calls[0][0].thinkingBudget).toBe(
      SCOUT_PLANNER_THINKING_BUDGET,
    );
    expect(SCOUT_PLANNER_THINKING_BUDGET).toBe(0);
  });
});
