import { describe, expect, it } from "vitest";
import { ThesisSchema } from "./thesis.js";

const validThesis = {
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

describe("ThesisSchema", () => {
  it("유효한 Thesis를 허용한다", () => {
    expect(ThesisSchema.safeParse(validThesis).success).toBe(true);
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
});
