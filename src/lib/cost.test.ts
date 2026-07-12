import { describe, expect, it } from "vitest";
import { estimateCostUsd, type CallUsage } from "./cost.js";

const FLASH_INPUT = 0.3 / 1_000_000;
const FLASH_OUTPUT = 2.5 / 1_000_000;
const FLASH_CACHED = 0.03 / 1_000_000;
const GROUNDING = 0.035;

function usage(overrides: Partial<CallUsage> = {}): CallUsage {
  return {
    label: "thesis",
    model: "gemini-2.5-flash",
    grounded: false,
    attempt: 1,
    promptTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    thoughtsTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

describe("estimateCostUsd", () => {
  it("입력·출력 토큰에 모델 단가를 적용한다", () => {
    const cost = estimateCostUsd(
      usage({ promptTokens: 10_000, outputTokens: 2_000 }),
    );

    expect(cost).toBeCloseTo(10_000 * FLASH_INPUT + 2_000 * FLASH_OUTPUT, 10);
  });

  it("캐시된 토큰을 두 번 세지 않는다 (promptTokenCount가 이미 포함한다)", () => {
    // promptTokenCount는 cachedContentTokenCount를 포함한다. 그냥 더하면 캐시된 토큰이
    // 입력 단가와 캐시 단가로 이중 과금된다 — 캐시 효과가 장부에서 사라진다.
    const cost = estimateCostUsd(
      usage({ promptTokens: 1_000, cachedTokens: 400 }),
    );

    expect(cost).toBeCloseTo(600 * FLASH_INPUT + 400 * FLASH_CACHED, 10);
    // 이중 과금(1000 × 입력 + 400 × 캐시)과 명시적으로 다르다
    expect(cost).not.toBeCloseTo(1_000 * FLASH_INPUT + 400 * FLASH_CACHED, 10);
  });

  it("캐시가 전부 히트해도 입력 요금이 음수가 되지 않는다", () => {
    const cost = estimateCostUsd(
      usage({ promptTokens: 1_000, cachedTokens: 1_000 }),
    );

    expect(cost).toBeCloseTo(1_000 * FLASH_CACHED, 10);
  });

  it("★ thinking 토큰은 입력이 아니라 출력 단가로 과금된다", () => {
    // 이 phase의 존재 이유다. thoughtsTokenCount는 candidatesTokenCount에 포함되지
    // 않으므로 따로 더해야 하고, 출력 요금($2.50/1M)으로 곱해야 한다.
    const withThinking = estimateCostUsd(usage({ thoughtsTokens: 4_000 }));
    const withoutThinking = estimateCostUsd(usage({ thoughtsTokens: 1_000 }));

    expect(withThinking - withoutThinking).toBeCloseTo(3_000 * FLASH_OUTPUT, 10);
    // thinking 1,000토큰과 출력 1,000토큰의 값이 같다 — 같은 단가라는 뜻이다
    expect(estimateCostUsd(usage({ thoughtsTokens: 1_000 }))).toBeCloseTo(
      estimateCostUsd(usage({ outputTokens: 1_000 })),
      10,
    );
  });

  it("grounded 호출에는 요청당 정액($0.035)이 더해진다", () => {
    const tokens = { promptTokens: 1_000, outputTokens: 500 };
    const grounded = estimateCostUsd(usage({ ...tokens, grounded: true }));
    const plain = estimateCostUsd(usage({ ...tokens, grounded: false }));

    expect(grounded - plain).toBeCloseTo(GROUNDING, 10);
  });

  it("non-grounded 호출에는 grounding 요금이 붙지 않는다", () => {
    expect(estimateCostUsd(usage({ outputTokens: 1_000 }))).toBeCloseTo(
      1_000 * FLASH_OUTPUT,
      10,
    );
  });

  it("모델마다 다른 단가표를 쓴다", () => {
    const tokens = { promptTokens: 1_000_000, outputTokens: 1_000_000 };

    expect(
      estimateCostUsd(usage({ ...tokens, model: "gemini-2.5-flash-lite" })),
    ).toBeCloseTo(0.1 + 0.4, 10);
    expect(
      estimateCostUsd(usage({ ...tokens, model: "gemini-2.5-pro" })),
    ).toBeCloseTo(1.25 + 10.0, 10);
  });

  it("모르는 모델 ID는 throw하지 않고 0을 반환한다", () => {
    // 모델을 바꿨다고 파이프라인이 죽으면 안 된다. 계측은 파이프라인을 방해하지 않는다.
    // usage 행에는 model이 그대로 남으므로 "단가를 모르는 모델"이라는 사실이 드러난다.
    const unknown = usage({
      model: "gemini-9.9-unknown",
      promptTokens: 10_000,
      outputTokens: 10_000,
      thoughtsTokens: 10_000,
      grounded: true,
    });

    expect(() => estimateCostUsd(unknown)).not.toThrow();
    expect(estimateCostUsd(unknown)).toBe(0);
  });

  it("토큰을 쓰지 않은 non-grounded 호출의 비용은 0이다", () => {
    expect(estimateCostUsd(usage())).toBe(0);
  });
});
