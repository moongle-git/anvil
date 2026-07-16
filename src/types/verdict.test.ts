import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Criticism } from "./criticism.js";
import {
  RECOMMENDATIONS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_SCORE_BANDS,
  REMEDY_VERDICTS,
  REMEDY_VERDICT_LABELS,
  RecommendationSchema,
  RemedyAuditSchema,
  RemedyVerdictSchema,
  ResidualRiskSchema,
  VerdictSchema,
  verdictSchemaFor,
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
  remedyAudits: [],
};

/**
 * 원장 도입 이전의 최신 run 산출물 (실측: run d32758의 verdict — remedyAudits 없음,
 * residualRisks에 criticismId 없음). 정적 스키마는 이것을 통과시켜야 한다 (ADR-017).
 */
const ledgerlessRunArtifact = {
  survivalScore: 75,
  recommendation: "proceed",
  headline:
    "VocalForge AI의 멀티모달 바이오메트릭스 진단 및 성과 기반 모델은 시장의 근본적 비판을 성공적으로 방어했다.",
  rationale:
    "反단계에서 제기된 모든 치명적 비판을 구조적으로 방어하거나 우회하는 데 성공했다.",
  residualRisks: [
    {
      keyword: "데이터 정확도",
      severity: "major",
      note: "멀티모달 바이오메트릭스 데이터 수집 및 분석 AI의 초기 정확도가 핵심 가치를 결정한다.",
    },
  ],
  conditions: ["출시 6개월 내 프리미엄 구독 전환율 10% 이상 달성."],
};

const fatalBmPoint = {
  id: "c1",
  axis: "bm",
  claim: "구독 모델은 저관여 취미 시장에서 이탈률이 높다",
  evidence: "YouTube 댓글에서 '무료 앱으로 충분하다'는 반응 다수",
  severity: "fatal",
  riskScore: 80,
  riskKeyword: "낮은 지불 의사",
} as const;

const fatalCopycatPoint = {
  id: "c2",
  axis: "copycat",
  claim: "기존 식물 앱이 AI 기능을 추가하면 차별성이 사라진다",
  evidence: "Planta는 이미 사진 기반 진단 기능을 출시했다",
  severity: "fatal",
  riskScore: 85,
  riskKeyword: "해자 부재",
} as const;

const majorPainPoint = {
  id: "c3",
  axis: "painPoint",
  claim: "물주기 리마인더는 이미 무료 앱이 해결한 문제다",
  evidence: "경쟁 서비스 Planta가 동일 기능을 무료 티어로 제공 중",
  severity: "major",
  riskScore: 50,
  riskKeyword: "무료 대체재",
} as const;

const criticism: Criticism = {
  points: [fatalBmPoint, fatalCopycatPoint, majorPainPoint],
  verdict: "현재 형태로는 기존 무료 앱과 차별화되지 않아 실패 확률이 높다.",
};

const auditForC1 = {
  criticismId: "c1",
  assessment: "solid",
  note: "성과 보장형 과금은 지불 의사 부재를 구조적으로 우회한다.",
} as const;

const auditForC2 = {
  criticismId: "c2",
  assessment: "restated",
  note: "'독점 데이터'는 해자 부재 지적에 수식어만 붙인 재주장이다.",
} as const;

const auditingVerdict = {
  ...validVerdict,
  remedyAudits: [auditForC1, auditForC2],
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

  it("criticismId로 유래한 비판을 밝힐 수 있다", () => {
    expect(
      ResidualRiskSchema.safeParse({ ...validRisk, criticismId: "c1" }).success,
    ).toBe(true);
  });

  it("criticismId가 없어도 통과한다 (피벗이 새로 만든 리스크)", () => {
    expect(ResidualRiskSchema.safeParse(validRisk).success).toBe(true);
  });
});

describe("RemedyVerdictSchema", () => {
  it.each([...REMEDY_VERDICTS])("'%s'를 허용한다", (assessment) => {
    expect(RemedyVerdictSchema.parse(assessment)).toBe(assessment);
  });

  it("정의되지 않은 감사 결과를 거부한다", () => {
    expect(RemedyVerdictSchema.safeParse("partial").success).toBe(false);
  });
});

describe("REMEDY_VERDICT_LABELS", () => {
  it("모든 감사 결과에 한국어 라벨이 빠짐없이 대응한다", () => {
    expect(Object.keys(REMEDY_VERDICT_LABELS).sort()).toEqual(
      [...REMEDY_VERDICTS].sort(),
    );
    for (const assessment of REMEDY_VERDICTS) {
      expect(REMEDY_VERDICT_LABELS[assessment]).toBeTruthy();
    }
  });
});

describe("RemedyAuditSchema", () => {
  it("유효한 감사를 허용한다", () => {
    expect(RemedyAuditSchema.safeParse(auditForC1).success).toBe(true);
  });

  it.each(["criticismId", "note"] as const)("빈 %s를 거부한다", (field) => {
    expect(
      RemedyAuditSchema.safeParse({ ...auditForC1, [field]: "" }).success,
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

  it("원장 없는 최신 run 산출물을 그대로 통과시킨다 (하위호환)", () => {
    expect(VerdictSchema.safeParse(ledgerlessRunArtifact).success).toBe(true);
  });

  it("remedyAudits가 없으면 빈 배열로 채운다", () => {
    expect(VerdictSchema.parse(ledgerlessRunArtifact).remedyAudits).toEqual([]);
  });

  it("정적 스키마는 dangling criticismId도 통과시킨다 (criticism을 모른다)", () => {
    const result = VerdictSchema.safeParse({
      ...validVerdict,
      remedyAudits: [{ ...auditForC1, criticismId: "c99" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("verdictSchemaFor (엄격한 쓰기)", () => {
  it("fatal 전건을 감사하면 통과한다", () => {
    expect(verdictSchemaFor(criticism).safeParse(auditingVerdict).success).toBe(
      true,
    );
  });

  it("감사하지 않은 fatal이 있으면 거부한다 (침묵 금지)", () => {
    const silent = { ...validVerdict, remedyAudits: [auditForC1] };
    expect(verdictSchemaFor(criticism).safeParse(silent).success).toBe(false);
  });

  it("감사가 통째로 비면 거부한다", () => {
    expect(verdictSchemaFor(criticism).safeParse(validVerdict).success).toBe(
      false,
    );
  });

  it("감사하지 않은 fatal의 id를 에러 메시지에 이름으로 지목한다", () => {
    const silent = { ...validVerdict, remedyAudits: [auditForC1] };
    const result = verdictSchemaFor(criticism).safeParse(silent);
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = z.prettifyError(result.error);
    expect(message).toContain("c2");
    expect(message).toContain("remedyAudits");
  });

  it("major를 감사하지 않아도 통과한다 (major는 강제하지 않는다)", () => {
    expect(verdictSchemaFor(criticism).safeParse(auditingVerdict).success).toBe(
      true,
    );
  });

  it("dangling criticismId를 거부하고 그 id를 지목한다", () => {
    const dangling = {
      ...auditingVerdict,
      remedyAudits: [...auditingVerdict.remedyAudits, { ...auditForC1, criticismId: "c99" }],
    };
    const result = verdictSchemaFor(criticism).safeParse(dangling);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(z.prettifyError(result.error)).toContain("c99");
  });

  it("criticismId 중복을 거부하고 그 id를 지목한다", () => {
    const duplicated = {
      ...auditingVerdict,
      remedyAudits: [...auditingVerdict.remedyAudits, auditForC1],
    };
    const result = verdictSchemaFor(criticism).safeParse(duplicated);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(z.prettifyError(result.error)).toContain("c1");
  });

  it("fatal이 0건이면 공허하게 통과한다 (강제할 것이 없다)", () => {
    const noFatal: Criticism = {
      points: [
        majorPainPoint,
        { ...fatalBmPoint, severity: "major", riskScore: 50 },
        { ...fatalCopycatPoint, severity: "minor", riskScore: 20 },
      ],
      verdict: "치명적이지는 않다.",
    };
    expect(verdictSchemaFor(noFatal).safeParse(validVerdict).success).toBe(true);
  });

  it("밴드 일치 규칙을 그대로 물려받는다 (점수 하한은 없다)", () => {
    const contradictory = {
      ...auditingVerdict,
      recommendation: "proceed",
      survivalScore: 20,
    };
    expect(verdictSchemaFor(criticism).safeParse(contradictory).success).toBe(
      false,
    );
  });

  it("fatal이 restated로 감사돼도 점수를 강제하지 않는다 (floor 없음 — ADR-010)", () => {
    const generous = {
      ...auditingVerdict,
      recommendation: "proceed",
      survivalScore: 85,
      remedyAudits: [
        { ...auditForC1, assessment: "restated" },
        { ...auditForC2, assessment: "dismissed" },
      ],
    };
    expect(verdictSchemaFor(criticism).safeParse(generous).success).toBe(true);
  });

  it("Gemini 구조화 출력 경로: z.toJSONSchema가 throw하지 않는다", () => {
    expect(() => z.toJSONSchema(verdictSchemaFor(criticism))).not.toThrow();
  });
});
