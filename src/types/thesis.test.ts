import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ThesisPointSchema, ThesisSchema, type ThesisPoint } from "./thesis.js";

const painPointClaim: ThesisPoint = {
  id: "t1",
  axis: "painPoint",
  claim: "식물을 죽인 경험은 반복되는 실질적 고통이다",
  rationale: "댓글 '물주기 타이밍을 계속 놓쳐서 다 죽였어요'가 반복 등장한다",
};

const bmClaim: ThesisPoint = {
  id: "t2",
  axis: "bm",
  claim: "실패 방지에는 지불 의사가 생긴다",
  rationale: "Planta가 월 $7.99 구독으로 이미 유료 시장을 검증했다",
};

const copycatClaim: ThesisPoint = {
  id: "t3",
  axis: "copycat",
  claim: "가정별 생육 데이터는 대기업이 복제할 수 없는 해자다",
  rationale: "경쟁 서비스 어느 곳도 개별 환경 데이터를 축적하지 않는다",
};

const validThesis = {
  points: [painPointClaim, bmClaim, copycatClaim],
  revenueModel:
    "무료 진단으로 유입 후 케어 플랜 구독(월 4,900원)으로 전환하는 프리미엄 모델.",
  growthLevers: [
    "케어 성공 사진을 공유하는 바이럴 루프",
    "화원·플랜트샵 대상 진단 API 번들 판매",
  ],
  marketTailwinds: [
    "반려식물 인구 증가와 '식집사' 트렌드 확산",
    "온디바이스 비전 모델 단가 하락으로 진단 비용 절감",
  ],
  bestCaseScenario:
    "2년 내 구독 전환율 8%를 달성하면 국내 식물 케어 SaaS 1위로 자리잡는다.",
  winningThesis:
    "저관여 취미 시장이라도 '실패 없는 케어'라는 명확한 가치가 유료 전환을 이끈다.",
};

describe("ThesisPointSchema", () => {
  it("유효한 낙관 주장을 허용한다", () => {
    expect(ThesisPointSchema.safeParse(painPointClaim).success).toBe(true);
  });

  it("정의되지 않은 axis를 거부한다", () => {
    const result = ThesisPointSchema.safeParse({
      ...painPointClaim,
      axis: "growth",
    });
    expect(result.success).toBe(false);
  });

  it.each(["id", "claim", "rationale"] as const)("빈 %s를 거부한다", (field) => {
    const result = ThesisPointSchema.safeParse({
      ...painPointClaim,
      [field]: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("ThesisSchema", () => {
  it("유효한 Thesis를 허용한다", () => {
    expect(ThesisSchema.safeParse(validThesis).success).toBe(true);
  });

  it("세 축을 모두 덮지 않으면 거부한다", () => {
    const result = ThesisSchema.safeParse({
      ...validThesis,
      points: [painPointClaim, bmClaim, { ...copycatClaim, axis: "bm" }],
    });
    expect(result.success).toBe(false);
  });

  it("id가 중복되면 거부한다", () => {
    const result = ThesisSchema.safeParse({
      ...validThesis,
      points: [painPointClaim, bmClaim, { ...copycatClaim, id: "t1" }],
    });
    expect(result.success).toBe(false);
  });

  it("points가 3개 미만이면 거부한다", () => {
    const result = ThesisSchema.safeParse({
      ...validThesis,
      points: [painPointClaim, bmClaim],
    });
    expect(result.success).toBe(false);
  });

  it.each(["revenueModel", "bestCaseScenario", "winningThesis"] as const)(
    "빈 %s를 거부한다",
    (field) => {
      const result = ThesisSchema.safeParse({ ...validThesis, [field]: "" });
      expect(result.success).toBe(false);
    },
  );

  it.each(["growthLevers", "marketTailwinds"] as const)(
    "빈 배열 %s를 거부한다 (최소 1개)",
    (field) => {
      const result = ThesisSchema.safeParse({ ...validThesis, [field]: [] });
      expect(result.success).toBe(false);
    },
  );

  it("배열 항목에 빈 문자열이 있으면 거부한다", () => {
    const result = ThesisSchema.safeParse({
      ...validThesis,
      growthLevers: ["유효한 항목", ""],
    });
    expect(result.success).toBe(false);
  });

  it("필수 필드가 빠지면 거부한다", () => {
    const withoutRevenue: Record<string, unknown> = { ...validThesis };
    delete withoutRevenue.revenueModel;
    expect(ThesisSchema.safeParse(withoutRevenue).success).toBe(false);
  });

  it("Gemini 구조화 출력 경로: z.toJSONSchema가 throw하지 않는다", () => {
    expect(() => z.toJSONSchema(ThesisSchema)).not.toThrow();
  });
});
