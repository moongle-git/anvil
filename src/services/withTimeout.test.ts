import { describe, expect, it } from "vitest";
import { withTimeout } from "./withTimeout.js";

describe("withTimeout", () => {
  it("제한 시간 내에 완료되면 원본 값을 그대로 반환한다", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "작업")).resolves.toBe(
      42,
    );
  });

  it("제한 시간을 넘기면 label과 ms를 담은 시간 초과 에러로 실패한다", async () => {
    // 영원히 완료되지 않는 promise — hang을 재현한다
    const never = new Promise<number>(() => undefined);
    await expect(withTimeout(never, 10, "Gemini 호출")).rejects.toThrow(
      /Gemini 호출 시간 초과.*10ms/,
    );
  });

  it("원본이 reject하면 그 에러를 시간 초과로 감싸지 않고 그대로 전파한다", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("원본 실패")), 1000, "작업"),
    ).rejects.toThrow("원본 실패");
  });
});
