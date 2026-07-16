import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Criticism } from "./criticism.js";
import {
  REMEDY_STRATEGIES,
  REMEDY_STRATEGY_LABELS,
  RemedySchema,
  RemedyStrategySchema,
  SolutionSchema,
  solutionSchemaFor,
} from "./solution.js";

const validSolution = {
  minimalInput: "식물 사진 한 장만 업로드하면 종·상태를 자동 인식한다.",
  agenticWorkflow:
    "진단 에이전트가 상태를 분석하고 케어 플랜 에이전트가 일정을 생성한다.",
  dataFlywheel:
    "사용자별 케어 성공/실패 데이터를 축적해 종·환경별 케어 모델을 고도화한다.",
  monetization: "무료 진단 + 자동 케어 플랜 구독(B2C), 화원 대상 진단 API(B2B).",
  revisedConcept: "사진 한 장으로 시작하는 자율 식물 케어 에이전트.",
  synthesis:
    "낙관론의 성장 동력과 반론의 이탈 리스크를 종합하면 '실패 없는 케어' 가치가 핵심이다.",
};

/**
 * 원장 도입 이전의 최신 run 산출물 (실측: run d32758의 solution — 필드 6개, remedies 없음).
 * 정적 스키마는 이것을 통과시켜야 한다 — 관대한 읽기 / 엄격한 쓰기 (ADR-017).
 */
const ledgerlessRunArtifact = {
  minimalInput:
    "VocalForge AI는 사용자의 수동 입력 없이 백그라운드에서 상시 작동하는 '컨텍스트 기반 음성 센싱 에이전트'를 핵심으로 한다.",
  agenticWorkflow:
    "'음성 감지 에이전트'가 상시 사용자의 음성을 감지하고, 진단·코칭 에이전트가 자율 협업한다.",
  dataFlywheel:
    "독점적인 '멀티모달 보컬 바이오메트릭스 데이터'를 축적하는 데이터 플라이휠을 구축한다.",
  monetization:
    "사용자에게 '검증된 실력 향상 ROI'를 제공하여 구독 가치를 명확히 한다.",
  revisedConcept:
    "'AI 보컬 코칭의 근본적 한계(c1)'와 '경쟁사 기술 동질화(c3)' 비판에 대응하여 멀티모달 진단으로 전환한다.",
  synthesis:
    "기존 AI 보컬 코칭 서비스는 '개인화된 피드백'을 약속했지만 피치/타이밍 감지에 머물렀다(c1).",
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

const remedyForC1 = {
  respondsTo: "c1",
  strategy: "bypass",
  remedy: "구독이 아니라 '케어 실패 시 환불' 성과 보장형 과금으로 전장을 옮긴다.",
} as const;

const remedyForC2 = {
  respondsTo: "c2",
  strategy: "defend",
  remedy: "종·환경별 케어 성공 데이터를 독점 자산으로 축적해 복제 비용을 올린다.",
} as const;

const coveringSolution = {
  ...validSolution,
  remedies: [remedyForC1, remedyForC2],
};

describe("RemedyStrategySchema", () => {
  it.each([...REMEDY_STRATEGIES])("'%s'를 허용한다", (strategy) => {
    expect(RemedyStrategySchema.parse(strategy)).toBe(strategy);
  });

  it("정의되지 않은 전략을 거부한다", () => {
    expect(RemedyStrategySchema.safeParse("accept").success).toBe(false);
  });
});

describe("REMEDY_STRATEGY_LABELS", () => {
  it("모든 전략에 한국어 라벨이 빠짐없이 대응한다", () => {
    expect(Object.keys(REMEDY_STRATEGY_LABELS).sort()).toEqual(
      [...REMEDY_STRATEGIES].sort(),
    );
    for (const strategy of REMEDY_STRATEGIES) {
      expect(REMEDY_STRATEGY_LABELS[strategy]).toBeTruthy();
    }
  });
});

describe("RemedySchema", () => {
  it("유효한 해결책을 허용한다", () => {
    expect(RemedySchema.safeParse(remedyForC1).success).toBe(true);
  });

  it.each(["respondsTo", "remedy"] as const)("빈 %s를 거부한다", (field) => {
    expect(RemedySchema.safeParse({ ...remedyForC1, [field]: "" }).success).toBe(
      false,
    );
  });
});

describe("SolutionSchema (정적 — 관대한 읽기)", () => {
  it("유효한 Solution을 허용한다", () => {
    expect(SolutionSchema.safeParse(coveringSolution).success).toBe(true);
  });

  it("원장 없는 최신 run 산출물을 그대로 통과시킨다 (하위호환)", () => {
    expect(SolutionSchema.safeParse(ledgerlessRunArtifact).success).toBe(true);
  });

  it("remedies가 없으면 빈 배열로 채운다", () => {
    const result = SolutionSchema.parse(validSolution);
    expect(result.remedies).toEqual([]);
  });

  it("정적 스키마는 fatal 커버리지를 강제하지 않는다 — 엄격함은 팩토리에만 산다", () => {
    expect(SolutionSchema.safeParse({ ...validSolution, remedies: [] }).success).toBe(
      true,
    );
  });

  it("정적 스키마는 dangling respondsTo도 통과시킨다 (criticism을 모른다)", () => {
    const result = SolutionSchema.safeParse({
      ...validSolution,
      remedies: [{ ...remedyForC1, respondsTo: "c99" }],
    });
    expect(result.success).toBe(true);
  });

  it("synthesis가 없으면 거부한다 (ADR-017: .optional() 제거)", () => {
    const withoutSynthesis: Record<string, unknown> = { ...validSolution };
    delete withoutSynthesis.synthesis;
    expect(SolutionSchema.safeParse(withoutSynthesis).success).toBe(false);
  });

  it("synthesis가 빈 문자열이면 거부한다", () => {
    expect(
      SolutionSchema.safeParse({ ...validSolution, synthesis: "" }).success,
    ).toBe(false);
  });

  it.each([
    "minimalInput",
    "agenticWorkflow",
    "dataFlywheel",
    "monetization",
    "revisedConcept",
  ] as const)("빈 %s를 거부한다", (field) => {
    expect(
      SolutionSchema.safeParse({ ...validSolution, [field]: "" }).success,
    ).toBe(false);
  });

  it("필수 필드가 빠지면 거부한다", () => {
    const withoutFlywheel: Record<string, unknown> = { ...validSolution };
    delete withoutFlywheel.dataFlywheel;
    expect(SolutionSchema.safeParse(withoutFlywheel).success).toBe(false);
  });
});

describe("solutionSchemaFor (엄격한 쓰기)", () => {
  it("fatal 전건에 해결책이 있으면 통과한다", () => {
    expect(
      solutionSchemaFor(criticism).safeParse(coveringSolution).success,
    ).toBe(true);
  });

  it("fatal에 해결책이 없으면 거부한다 (침묵 금지)", () => {
    const silent = { ...validSolution, remedies: [remedyForC1] };
    expect(solutionSchemaFor(criticism).safeParse(silent).success).toBe(false);
  });

  it("원장이 통째로 비면 거부한다", () => {
    expect(
      solutionSchemaFor(criticism).safeParse({ ...validSolution, remedies: [] })
        .success,
    ).toBe(false);
  });

  it("침묵한 fatal의 id를 에러 메시지에 이름으로 지목한다 (재시도 피드백)", () => {
    const silent = { ...validSolution, remedies: [remedyForC1] };
    const result = solutionSchemaFor(criticism).safeParse(silent);
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = z.prettifyError(result.error);
    expect(message).toContain("c2");
    expect(message).toContain("remedies");
  });

  it("major에 해결책이 없어도 통과한다 (major는 강제하지 않는다)", () => {
    const result = solutionSchemaFor(criticism).safeParse(coveringSolution);
    expect(result.success).toBe(true);
  });

  it("major에 해결책을 내는 것은 허용한다", () => {
    const withMajor = {
      ...coveringSolution,
      remedies: [
        ...coveringSolution.remedies,
        {
          respondsTo: "c3",
          strategy: "defend",
          remedy: "리마인더가 아니라 진단을 판다.",
        },
      ],
    };
    expect(solutionSchemaFor(criticism).safeParse(withMajor).success).toBe(true);
  });

  it("dangling respondsTo를 거부하고 그 id를 지목한다", () => {
    const dangling = {
      ...coveringSolution,
      remedies: [
        ...coveringSolution.remedies,
        { ...remedyForC1, respondsTo: "c99" },
      ],
    };
    const result = solutionSchemaFor(criticism).safeParse(dangling);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(z.prettifyError(result.error)).toContain("c99");
  });

  it("respondsTo 중복을 거부하고 그 id를 지목한다", () => {
    const duplicated = {
      ...coveringSolution,
      remedies: [...coveringSolution.remedies, remedyForC1],
    };
    const result = solutionSchemaFor(criticism).safeParse(duplicated);
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
    expect(
      solutionSchemaFor(noFatal).safeParse({ ...validSolution, remedies: [] })
        .success,
    ).toBe(true);
  });

  it("정적 스키마의 필드 검증을 그대로 물려받는다", () => {
    expect(
      solutionSchemaFor(criticism).safeParse({
        ...coveringSolution,
        revisedConcept: "",
      }).success,
    ).toBe(false);
  });

  it("Gemini 구조화 출력 경로: z.toJSONSchema가 throw하지 않는다", () => {
    expect(() => z.toJSONSchema(solutionSchemaFor(criticism))).not.toThrow();
  });
});
