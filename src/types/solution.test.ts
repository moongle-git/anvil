import { describe, expect, it } from "vitest";
import { SolutionSchema } from "./solution.js";

const validSolution = {
  minimalInput: "식물 사진 한 장만 업로드하면 종·상태를 자동 인식한다.",
  agenticWorkflow: "진단 에이전트가 상태를 분석하고 케어 플랜 에이전트가 일정을 생성한다.",
  dataFlywheel: "사용자별 케어 성공/실패 데이터를 축적해 종·환경별 케어 모델을 고도화한다.",
  monetization: "무료 진단 + 자동 케어 플랜 구독(B2C), 화원 대상 진단 API(B2B).",
  revisedConcept: "사진 한 장으로 시작하는 자율 식물 케어 에이전트.",
};

describe("SolutionSchema", () => {
  it("유효한 Solution을 허용한다", () => {
    expect(SolutionSchema.safeParse(validSolution).success).toBe(true);
  });

  it("synthesis 없이도 허용한다 (옵셔널, 구 solution.json 하위호환)", () => {
    expect(SolutionSchema.safeParse(validSolution).success).toBe(true);
  });

  it("synthesis가 있으면 허용한다", () => {
    const result = SolutionSchema.safeParse({
      ...validSolution,
      synthesis:
        "낙관론의 성장 동력과 반론의 이탈 리스크를 종합하면 '실패 없는 케어' 가치가 핵심이다.",
    });
    expect(result.success).toBe(true);
  });

  it("synthesis가 빈 문자열이면 거부한다", () => {
    const result = SolutionSchema.safeParse({ ...validSolution, synthesis: "" });
    expect(result.success).toBe(false);
  });

  it.each([
    "minimalInput",
    "agenticWorkflow",
    "dataFlywheel",
    "monetization",
    "revisedConcept",
  ] as const)("빈 %s를 거부한다", (field) => {
    const result = SolutionSchema.safeParse({ ...validSolution, [field]: "" });
    expect(result.success).toBe(false);
  });

  it("필수 필드가 빠지면 거부한다", () => {
    const withoutFlywheel: Record<string, unknown> = { ...validSolution };
    delete withoutFlywheel.dataFlywheel;
    expect(SolutionSchema.safeParse(withoutFlywheel).success).toBe(false);
  });
});
