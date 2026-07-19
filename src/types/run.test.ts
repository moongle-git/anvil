import { describe, expect, it } from "vitest";
import {
  PIPELINE_STEPS,
  RunStateSchema,
  StepStateSchema,
  StepStatusSchema,
} from "./run.js";

describe("PIPELINE_STEPS", () => {
  it("파이프라인 step 이름을 정반합 순서대로 담는다", () => {
    // 배열 순서가 곧 steps.ordinal이다 — trend-scout(주제 발굴)은 아이디어를 확정하는
    // 단계라 interviewer보다도 앞에 온다
    expect(PIPELINE_STEPS).toEqual([
      "trend-scout",
      "interviewer",
      "context-hunter",
      "thesis",
      "cold-critic",
      "solution-designer",
      "verdict",
    ]);
  });
});

describe("StepStatusSchema", () => {
  it.each(["pending", "completed", "error", "waiting"])(
    "'%s'를 허용한다",
    (status) => {
      expect(StepStatusSchema.parse(status)).toBe(status);
    },
  );

  it("정의되지 않은 status를 거부한다", () => {
    expect(StepStatusSchema.safeParse("running").success).toBe(false);
  });
});

describe("StepStateSchema", () => {
  it("필수 필드만 있는 step을 허용한다", () => {
    const result = StepStateSchema.safeParse({
      name: "context-hunter",
      status: "pending",
    });
    expect(result.success).toBe(true);
  });

  it("타임스탬프·에러 메시지 옵셔널 필드를 허용한다", () => {
    const result = StepStateSchema.safeParse({
      name: "cold-critic",
      status: "error",
      startedAt: "2026-07-04T12:00:00.000Z",
      failedAt: "2026-07-04T12:01:00.000Z",
      errorMessage: "schema validation failed",
    });
    expect(result.success).toBe(true);
  });

  it("PIPELINE_STEPS에 없는 name을 거부한다", () => {
    const result = StepStateSchema.safeParse({
      name: "report-writer",
      status: "pending",
    });
    expect(result.success).toBe(false);
  });
});

describe("RunStateSchema", () => {
  const validRunState = {
    runId: "run-20260704-abc123",
    idea: "AI 기반 반려식물 관리 서비스",
    createdAt: "2026-07-04T12:00:00.000Z",
    steps: PIPELINE_STEPS.map((name) => ({ name, status: "pending" })),
  };

  it("유효한 RunState를 허용한다", () => {
    const result = RunStateSchema.safeParse(validRunState);
    expect(result.success).toBe(true);
  });

  it("completedAt 옵셔널 필드를 허용한다", () => {
    const result = RunStateSchema.safeParse({
      ...validRunState,
      completedAt: "2026-07-04T12:10:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("interview 필드가 없는 구 state.json은 interview=false로 파싱한다", () => {
    const result = RunStateSchema.safeParse(validRunState);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interview).toBe(false);
    }
  });

  it("interview=true를 허용한다", () => {
    const result = RunStateSchema.safeParse({
      ...validRunState,
      interview: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interview).toBe(true);
    }
  });

  it("waiting 상태의 step을 포함한 RunState를 허용한다", () => {
    const result = RunStateSchema.safeParse({
      ...validRunState,
      steps: [{ name: "interviewer", status: "waiting" }],
    });
    expect(result.success).toBe(true);
  });

  it("빈 runId를 거부한다", () => {
    const result = RunStateSchema.safeParse({ ...validRunState, runId: "" });
    expect(result.success).toBe(false);
  });

  it("빈 idea를 거부한다", () => {
    const result = RunStateSchema.safeParse({ ...validRunState, idea: "" });
    expect(result.success).toBe(false);
  });

  it("ISO 형식이 아닌 createdAt을 거부한다", () => {
    const result = RunStateSchema.safeParse({
      ...validRunState,
      createdAt: "2026년 7월 4일",
    });
    expect(result.success).toBe(false);
  });

  it("steps가 없으면 거부한다", () => {
    const withoutSteps: Record<string, unknown> = { ...validRunState };
    delete withoutSteps.steps;
    expect(RunStateSchema.safeParse(withoutSteps).success).toBe(false);
  });
});
