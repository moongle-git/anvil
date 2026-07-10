import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RECOMMENDATIONS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_SCORE_BANDS,
  RecommendationSchema,
  ResidualRiskSchema,
  VerdictSchema,
  type Verdict,
} from "./verdict.js";

const validVerdict: Verdict = {
  survivalScore: 85,
  recommendation: "proceed",
  headline: "생존 보장형 과금으로 전환하면 이 사업은 살아남는다.",
  rationale:
    "무료 대체재의 지불 의사 문제는 남지만, 재설계된 보장형 구독이 fatal 비판을 정면으로 흡수한다.",
  residualRisks: [
    {
      keyword: "무료 대체재",
      severity: "major",
      note: "Planta의 무료 티어가 여전히 초기 유입을 잠식한다",
    },
  ],
  conditions: ["6개월 내 유료 전환율 5% 달성"],
};

describe("RecommendationSchema", () => {
  it.each([...RECOMMENDATIONS])("'%s'를 허용한다", (recommendation) => {
    expect(RecommendationSchema.parse(recommendation)).toBe(recommendation);
  });

  it("정의되지 않은 값을 거부한다", () => {
    expect(RecommendationSchema.safeParse("hold").success).toBe(false);
  });
});

describe("RECOMMENDATION_LABELS", () => {
  it("모든 recommendation에 한국어 라벨이 빠짐없이 대응한다", () => {
    for (const recommendation of RECOMMENDATIONS) {
      expect(RECOMMENDATION_LABELS[recommendation]).toBeTruthy();
    }
    expect(Object.keys(RECOMMENDATION_LABELS).sort()).toEqual(
      [...RECOMMENDATIONS].sort(),
    );
  });
});

describe("RECOMMENDATION_SCORE_BANDS", () => {
  it("모든 recommendation에 점수 밴드가 빠짐없이 대응한다", () => {
    expect(Object.keys(RECOMMENDATION_SCORE_BANDS).sort()).toEqual(
      [...RECOMMENDATIONS].sort(),
    );
  });

  it("0~100을 빈틈·겹침 없이 분할한다", () => {
    expect(RECOMMENDATION_SCORE_BANDS.abandon.min).toBe(0);
    expect(RECOMMENDATION_SCORE_BANDS.proceed.max).toBe(100);
    expect(RECOMMENDATION_SCORE_BANDS.pivot.min).toBe(
      RECOMMENDATION_SCORE_BANDS.abandon.max + 1,
    );
    expect(RECOMMENDATION_SCORE_BANDS.proceed.min).toBe(
      RECOMMENDATION_SCORE_BANDS.pivot.max + 1,
    );
  });
});

describe("ResidualRiskSchema", () => {
  const validRisk = {
    keyword: "무료 대체재",
    severity: "fatal",
    note: "Planta 무료 티어가 유입을 잠식한다",
  };

  it("유효한 잔존 리스크를 허용한다", () => {
    expect(ResidualRiskSchema.safeParse(validRisk).success).toBe(true);
  });

  it("빈 keyword를 거부한다", () => {
    expect(
      ResidualRiskSchema.safeParse({ ...validRisk, keyword: "" }).success,
    ).toBe(false);
  });

  it("CriticismSeverity가 아닌 severity를 거부한다", () => {
    expect(
      ResidualRiskSchema.safeParse({ ...validRisk, severity: "critical" })
        .success,
    ).toBe(false);
  });
});

describe("VerdictSchema", () => {
  it("유효한 Verdict를 허용한다", () => {
    expect(VerdictSchema.safeParse(validVerdict).success).toBe(true);
  });

  it("proceed + survivalScore 85를 허용한다", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      recommendation: "proceed",
      survivalScore: 85,
    });
    expect(result.success).toBe(true);
  });

  it("proceed + survivalScore 20은 자기모순이므로 거부한다", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      recommendation: "proceed",
      survivalScore: 20,
    });
    expect(result.success).toBe(false);
  });

  it("abandon + survivalScore 90은 자기모순이므로 거부한다", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      recommendation: "abandon",
      survivalScore: 90,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["abandon", 20],
    ["pivot", 55],
    ["proceed", 70],
  ] as const)("%s + %d는 밴드와 정합해 통과한다", (recommendation, score) => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      recommendation,
      survivalScore: score,
    });
    expect(result.success).toBe(true);
  });

  it("survivalScore가 정수가 아니면 거부한다", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      survivalScore: 85.5,
    });
    expect(result.success).toBe(false);
  });

  it("survivalScore가 100을 넘으면 거부한다", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      survivalScore: 101,
    });
    expect(result.success).toBe(false);
  });

  it("residualRisks가 빈 배열이면 거부한다", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      residualRisks: [],
    });
    expect(result.success).toBe(false);
  });

  it("conditions가 빈 배열이면 거부한다", () => {
    const result = VerdictSchema.safeParse({ ...validVerdict, conditions: [] });
    expect(result.success).toBe(false);
  });

  it.each(["headline", "rationale"] as const)("빈 %s를 거부한다", (field) => {
    const result = VerdictSchema.safeParse({ ...validVerdict, [field]: "" });
    expect(result.success).toBe(false);
  });

  it("Gemini 구조화 출력 경로: z.toJSONSchema가 throw하지 않는다", () => {
    expect(() => z.toJSONSchema(VerdictSchema)).not.toThrow();
  });
});
