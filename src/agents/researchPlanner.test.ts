import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import { SearchQueriesSchema, type SearchQueries } from "../types/index.js";
import {
  RESEARCH_PLANNER_PROMPT_TEMPLATE,
  RESEARCH_PLANNER_SYSTEM_PROMPT,
  planResearchQueries,
  type ResearchPlannerDeps,
} from "./researchPlanner.js";

const IDEA =
  "직장인을 위한 AI 기반 회의록 요약 서비스인데 슬랙과 연동해서 회의가 끝나면 자동으로 요약을 보내준다";
const CLARIFICATIONS = "Q: 핵심 타깃은?\nA: 스타트업 PM이고 슬랙이 핵심 채널이다";

const QUERIES: SearchQueries = {
  youtube: "회의록 정리 꿀팁",
  hackernews: "meeting notes automation slack",
  naver: "회의록 정리 너무 귀찮",
  web: ["AI 회의록 요약 시장 규모", "회의록 자동화 경쟁 서비스"],
};

interface FakeDeps {
  deps: ResearchPlannerDeps;
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
      gemini: { generateStructured, generateGrounded } as unknown as GeminiService,
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

describe("planResearchQueries", () => {
  it("SearchQueries 스키마로 구조화 출력을 1회 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await planResearchQueries(deps, IDEA);

    expect(result).toEqual(QUERIES);
    expect(SearchQueriesSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.schema).toBe(SearchQueriesSchema);
    expect(params.systemInstruction).toBe(RESEARCH_PLANNER_SYSTEM_PROMPT);
  });

  it("★ grounding을 쓰지 않는다 — 검색어를 짓는 단계지 검색하는 단계가 아니다", async () => {
    // non-grounding이면 responseJsonSchema를 쓸 수 있어 형식 실패가 구조적으로 없다 (ADR-012)
    const { deps, generateGrounded } = fakeDeps();

    await planResearchQueries(deps, IDEA);

    expect(generateGrounded).not.toHaveBeenCalled();
  });

  it("프롬프트에 아이디어 원문이 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await planResearchQueries(deps, IDEA);

    expect(promptOf(generateStructured)).toContain(IDEA);
  });

  it("★ 프롬프트에 인터뷰 답변(clarifications)이 포함된다", async () => {
    // 이 step 이전에는 인터뷰 답변이 검색어에 전혀 반영되지 않았다 — 그 버그의 회귀 가드다
    const { deps, generateStructured } = fakeDeps();

    await planResearchQueries(deps, IDEA, CLARIFICATIONS);

    const prompt = promptOf(generateStructured);
    expect(prompt).toContain("스타트업 PM");
    expect(prompt).toContain("슬랙이 핵심 채널");
  });

  it("clarifications가 없으면 placeholder가 프롬프트에 그대로 남지 않는다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await planResearchQueries(deps, IDEA);

    const prompt = promptOf(generateStructured);
    expect(prompt).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(prompt).toContain("추가 설명 없음");
  });

  it("clarifications가 공백뿐이어도 placeholder가 남지 않는다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await planResearchQueries(deps, IDEA, "   ");

    expect(promptOf(generateStructured)).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});

describe("planResearchQueries (fail-soft 폴백)", () => {
  it("Gemini가 실패해도 throw하지 않고 아이디어 원문으로 폴백한다", async () => {
    const { deps } = fakeDeps(new Error("Gemini 구조화 출력이 3회 시도 후에도 검증에 실패했다"));

    const result = await planResearchQueries(deps, IDEA);

    // 검색어 생성 실패는 자료조사를 멈출 이유가 아니다 (ADR-012 fail-soft)
    expect(result).toEqual({
      youtube: IDEA,
      hackernews: IDEA,
      naver: IDEA,
      web: [IDEA],
    });
    expect(SearchQueriesSchema.safeParse(result).success).toBe(true);
  });

  it("폴백이 발동하면 로그를 남긴다 (HN이 한국어 쿼리로 조용히 0건이 된다)", async () => {
    const { deps, log } = fakeDeps(new Error("Gemini 호출 실패"));

    await planResearchQueries(deps, IDEA);

    expect(log).toHaveBeenCalledTimes(1);
    const message = String(log.mock.calls[0][0]);
    expect(message).toContain("폴백");
    expect(message).toContain("Gemini 호출 실패");
  });

  it("log가 주어지지 않아도 폴백이 throw하지 않는다", async () => {
    const generateStructured = vi.fn().mockRejectedValue(new Error("실패"));
    const deps: ResearchPlannerDeps = {
      gemini: { generateStructured } as unknown as GeminiService,
    };

    await expect(planResearchQueries(deps, IDEA)).resolves.toEqual({
      youtube: IDEA,
      hackernews: IDEA,
      naver: IDEA,
      web: [IDEA],
    });
  });
});

describe("RESEARCH_PLANNER_SYSTEM_PROMPT (소스별 언어 계약)", () => {
  it("★ hackernews 검색어를 영어로 만들라고 지시한다", () => {
    // HN은 영어권이라 한국어 쿼리는 에러 없이 조용히 0건이 된다 — planner의 존재 이유다
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("hackernews");
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("영어");
  });

  it.each(Object.keys(SearchQueriesSchema.shape))(
    "소스 %s의 검색어 작성 지시를 담는다",
    (source) => {
      expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain(source);
    },
  );

  it("아이디어 원문을 그대로 검색어로 쓰지 말라고 지시한다", () => {
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("그대로");
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("키워드");
  });

  it("제품 홍보가 아니라 페인포인트의 언어로 검색하라고 지시한다", () => {
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("페인포인트");
  });

  it("인터뷰 답변을 검색어에 반영하라고 지시한다", () => {
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("반영");
  });

  it("검색을 수행하는 단계가 아님을 명시한다 (grounding과의 역할 분리)", () => {
    expect(RESEARCH_PLANNER_SYSTEM_PROMPT).toContain("검색을 수행하지 않는다");
  });
});

describe("RESEARCH_PLANNER_PROMPT_TEMPLATE", () => {
  it("{idea}와 {clarifications} placeholder를 갖는다", () => {
    expect(RESEARCH_PLANNER_PROMPT_TEMPLATE).toContain("{idea}");
    expect(RESEARCH_PLANNER_PROMPT_TEMPLATE).toContain("{clarifications}");
  });
});
