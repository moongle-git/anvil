import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CriticismPointSchema,
  CriticismSchema,
  type CriticismPoint,
} from "./criticism.js";

const validPoint: CriticismPoint = {
  id: "c1",
  axis: "painPoint",
  claim: "물주기 리마인더는 이미 무료 앱이 해결한 문제다",
  evidence: "경쟁 서비스 Planta가 동일 기능을 무료 티어로 제공 중",
  severity: "fatal",
  riskScore: 80,
  riskKeyword: "무료 대체재",
};

const bmPoint: CriticismPoint = {
  id: "c2",
  axis: "bm",
  claim: "구독 모델은 저관여 취미 시장에서 이탈률이 높다",
  evidence: "YouTube 댓글에서 '무료 앱으로 충분하다'는 반응 다수",
  severity: "major",
  riskScore: 50,
  riskKeyword: "낮은 지불 의사",
};

const copycatPoint: CriticismPoint = {
  id: "c3",
  axis: "copycat",
  claim: "기존 식물 앱이 AI 기능을 추가하면 차별성이 사라진다",
  evidence: "Planta는 이미 사진 기반 진단 기능을 출시했다",
  severity: "minor",
  riskScore: 20,
  riskKeyword: "해자 부재",
};

const validCriticism = {
  points: [validPoint, bmPoint, copycatPoint],
  verdict: "현재 형태로는 기존 무료 앱과 차별화되지 않아 실패 확률이 높다.",
};

describe("CriticismPointSchema", () => {
  it("유효한 비판 포인트를 허용한다", () => {
    expect(CriticismPointSchema.safeParse(validPoint).success).toBe(true);
  });

  it("rebuts가 없어도 통과한다 (반박 대상 ThesisPoint는 선택)", () => {
    expect(CriticismPointSchema.safeParse(validPoint).success).toBe(true);
  });

  it("rebuts로 ThesisPoint.id를 참조할 수 있다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      rebuts: "t1",
    });
    expect(result.success).toBe(true);
  });

  it.each(["fatal", "major", "minor"])("severity '%s'를 허용한다", (severity) => {
    const bandScore = { fatal: 80, major: 50, minor: 20 }[severity];
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      severity,
      riskScore: bandScore,
    });
    expect(result.success).toBe(true);
  });

  it("정의되지 않은 severity를 거부한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      severity: "critical",
    });
    expect(result.success).toBe(false);
  });

  it("정의되지 않은 axis를 거부한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      axis: "moat",
    });
    expect(result.success).toBe(false);
  });

  it("severity 'fatal' + riskScore 20은 밴드를 벗어나므로 거부한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      severity: "fatal",
      riskScore: 20,
    });
    expect(result.success).toBe(false);
  });

  it("severity 'fatal' + riskScore 80은 밴드와 정합해 통과한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      severity: "fatal",
      riskScore: 80,
    });
    expect(result.success).toBe(true);
  });

  it("severity 'minor' + riskScore 90은 밴드를 벗어나므로 거부한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      severity: "minor",
      riskScore: 90,
    });
    expect(result.success).toBe(false);
  });

  it("riskScore가 0~100 범위를 벗어나면 거부한다", () => {
    expect(
      CriticismPointSchema.safeParse({ ...validPoint, riskScore: 120 }).success,
    ).toBe(false);
    expect(
      CriticismPointSchema.safeParse({ ...validPoint, riskScore: -1 }).success,
    ).toBe(false);
  });

  it("riskScore가 정수가 아니면 거부한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      riskScore: 80.5,
    });
    expect(result.success).toBe(false);
  });

  it.each(["id", "claim", "evidence", "riskKeyword"] as const)(
    "빈 %s를 거부한다",
    (field) => {
      const result = CriticismPointSchema.safeParse({
        ...validPoint,
        [field]: "",
      });
      expect(result.success).toBe(false);
    },
  );

  it("evidence가 빠지면 거부한다", () => {
    const withoutEvidence: Record<string, unknown> = { ...validPoint };
    delete withoutEvidence.evidence;
    expect(CriticismPointSchema.safeParse(withoutEvidence).success).toBe(false);
  });
});

describe("CriticismSchema", () => {
  it("유효한 Criticism을 허용한다", () => {
    expect(CriticismSchema.safeParse(validCriticism).success).toBe(true);
  });

  it("세 축을 모두 덮지 않으면 거부한다", () => {
    const result = CriticismSchema.safeParse({
      ...validCriticism,
      points: [validPoint, bmPoint, { ...copycatPoint, axis: "bm" }],
    });
    expect(result.success).toBe(false);
  });

  it("id가 중복되면 거부한다", () => {
    const result = CriticismSchema.safeParse({
      ...validCriticism,
      points: [validPoint, bmPoint, { ...copycatPoint, id: "c1" }],
    });
    expect(result.success).toBe(false);
  });

  it("points가 3개 미만이면 거부한다", () => {
    const result = CriticismSchema.safeParse({
      ...validCriticism,
      points: [validPoint, bmPoint],
    });
    expect(result.success).toBe(false);
  });

  it("빈 verdict를 거부한다 (反 섹션의 소결론)", () => {
    const result = CriticismSchema.safeParse({ ...validCriticism, verdict: "" });
    expect(result.success).toBe(false);
  });

  it("points가 빠지면 거부한다", () => {
    const withoutPoints: Record<string, unknown> = { ...validCriticism };
    delete withoutPoints.points;
    expect(CriticismSchema.safeParse(withoutPoints).success).toBe(false);
  });

  it("Gemini 구조화 출력 경로: z.toJSONSchema가 throw하지 않는다", () => {
    expect(() => z.toJSONSchema(CriticismSchema)).not.toThrow();
  });
});
