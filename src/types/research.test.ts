import { describe, expect, it } from "vitest";
import {
  RESEARCH_SOURCE_IDS,
  ResearchSourceIdSchema,
  SearchQueriesSchema,
  SOURCE_LABELS,
} from "./research.js";

describe("ResearchSourceIdSchema", () => {
  it.each(RESEARCH_SOURCE_IDS)("%s를 허용한다", (id) => {
    expect(ResearchSourceIdSchema.safeParse(id).success).toBe(true);
  });

  it("미지의 소스를 거부한다", () => {
    expect(ResearchSourceIdSchema.safeParse("reddit").success).toBe(false);
  });
});

describe("SOURCE_LABELS", () => {
  it("모든 소스에 표시 라벨이 있다 (라벨 하드코딩 방지)", () => {
    for (const id of RESEARCH_SOURCE_IDS) {
      expect(SOURCE_LABELS[id]).toBeTruthy();
    }
  });

  it("소스마다 라벨이 서로 다르다", () => {
    const labels = RESEARCH_SOURCE_IDS.map((id) => SOURCE_LABELS[id]);
    expect(new Set(labels).size).toBe(RESEARCH_SOURCE_IDS.length);
  });
});

describe("SearchQueriesSchema", () => {
  const valid = {
    youtube: "반려식물 물주기 실패",
    hackernews: "plant care app retention",
    naver: "반려식물 관리 앱 후기",
    web: ["반려식물 시장 규모", "식물 관리 앱 경쟁사"],
  };

  it("소스별 검색어와 웹 검색어를 허용한다", () => {
    expect(SearchQueriesSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["youtube", "hackernews", "naver"] as const)(
    "빈 %s 검색어를 거부한다",
    (field) => {
      const result = SearchQueriesSchema.safeParse({ ...valid, [field]: "" });
      expect(result.success).toBe(false);
    },
  );

  it.each(["youtube", "hackernews", "naver", "web"] as const)(
    "%s가 빠지면 거부한다",
    (field) => {
      const withoutField: Record<string, unknown> = { ...valid };
      delete withoutField[field];
      expect(SearchQueriesSchema.safeParse(withoutField).success).toBe(false);
    },
  );

  it("web이 빈 배열이면 거부한다 (grounding 힌트가 최소 1개는 필요하다)", () => {
    expect(SearchQueriesSchema.safeParse({ ...valid, web: [] }).success).toBe(
      false,
    );
  });

  it("web이 3개를 넘으면 거부한다", () => {
    const result = SearchQueriesSchema.safeParse({
      ...valid,
      web: ["a", "b", "c", "d"],
    });
    expect(result.success).toBe(false);
  });
});
