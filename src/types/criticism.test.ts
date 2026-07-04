import { describe, expect, it } from "vitest";
import { CriticismPointSchema, CriticismSchema } from "./criticism.js";

const validPoint = {
  claim: "물주기 리마인더는 이미 무료 앱이 해결한 문제다",
  evidence: "경쟁 서비스 Planta가 동일 기능을 무료 티어로 제공 중",
  severity: "fatal",
};

describe("CriticismPointSchema", () => {
  it("유효한 비판 포인트를 허용한다", () => {
    expect(CriticismPointSchema.safeParse(validPoint).success).toBe(true);
  });

  it.each(["fatal", "major", "minor"])("severity '%s'를 허용한다", (severity) => {
    const result = CriticismPointSchema.safeParse({ ...validPoint, severity });
    expect(result.success).toBe(true);
  });

  it("정의되지 않은 severity를 거부한다", () => {
    const result = CriticismPointSchema.safeParse({
      ...validPoint,
      severity: "critical",
    });
    expect(result.success).toBe(false);
  });

  it("빈 claim을 거부한다", () => {
    const result = CriticismPointSchema.safeParse({ ...validPoint, claim: "" });
    expect(result.success).toBe(false);
  });

  it("evidence가 빠지면 거부한다", () => {
    const withoutEvidence: Record<string, unknown> = { ...validPoint };
    delete withoutEvidence.evidence;
    expect(CriticismPointSchema.safeParse(withoutEvidence).success).toBe(false);
  });
});

describe("CriticismSchema", () => {
  const validCriticism = {
    painPointReality: [validPoint],
    bmWeakness: [
      {
        claim: "구독 모델은 저관여 취미 시장에서 이탈률이 높다",
        evidence: "YouTube 댓글에서 '무료 앱으로 충분하다'는 반응 다수",
        severity: "major",
      },
    ],
    copycatRisk: [
      {
        claim: "기존 식물 앱이 AI 기능을 추가하면 차별성이 사라진다",
        evidence: "Planta는 이미 사진 기반 진단 기능을 출시했다",
        severity: "major",
      },
    ],
    verdict: "현재 형태로는 기존 무료 앱과 차별화되지 않아 실패 확률이 높다.",
  };

  it("유효한 Criticism을 허용한다", () => {
    expect(CriticismSchema.safeParse(validCriticism).success).toBe(true);
  });

  it("비판 축이 빈 배열이면 거부한다 (3축 모두 최소 1개)", () => {
    const result = CriticismSchema.safeParse({
      ...validCriticism,
      bmWeakness: [],
    });
    expect(result.success).toBe(false);
  });

  it("빈 verdict를 거부한다", () => {
    const result = CriticismSchema.safeParse({ ...validCriticism, verdict: "" });
    expect(result.success).toBe(false);
  });

  it("필수 축이 빠지면 거부한다", () => {
    const withoutRisk: Record<string, unknown> = { ...validCriticism };
    delete withoutRisk.copycatRisk;
    expect(CriticismSchema.safeParse(withoutRisk).success).toBe(false);
  });
});
