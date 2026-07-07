import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComparePage } from "@/components/compare/ComparePage";
import {
  completedDetail,
  COMPLETED_A_ID,
  COMPLETED_B_ID,
  runningDetail,
  RUNNING_ID,
} from "@/test/clientFixtures";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ComparePage", () => {
  it("완료 run 두 개를 2컬럼 비교 행으로 렌더링한다", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(COMPLETED_B_ID)) {
        return Promise.resolve(
          jsonResponse(completedDetail(COMPLETED_B_ID, "두 번째 완료 run")),
        );
      }
      return Promise.resolve(
        jsonResponse(completedDetail(COMPLETED_A_ID, "첫 번째 완료 run")),
      );
    });

    render(<ComparePage runA={COMPLETED_A_ID} runB={COMPLETED_B_ID} />);

    expect(await screen.findByText("실행 정보")).toBeDefined();
    expect(screen.getByText("severity")).toBeDefined();
    expect(screen.getByText("verdict")).toBeDefined();
    expect(screen.getByText("revisedConcept")).toBeDefined();
    expect(screen.getByText("monetization")).toBeDefined();
    expect(screen.getAllByText("첫 번째 완료 run").length).toBeGreaterThan(0);
    expect(screen.getAllByText("두 번째 완료 run").length).toBeGreaterThan(0);
  });

  it("미완료 run이 포함되면 비교를 차단한다", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(RUNNING_ID)) {
        return Promise.resolve(jsonResponse(runningDetail()));
      }
      return Promise.resolve(jsonResponse(completedDetail()));
    });

    render(<ComparePage runA={COMPLETED_A_ID} runB={RUNNING_ID} />);

    expect(await screen.findByText("완료된 run만 비교할 수 있습니다")).toBeDefined();
  });

  it("쿼리 파라미터가 부족하면 빈 상태를 렌더링한다", () => {
    render(<ComparePage runA={COMPLETED_A_ID} />);

    expect(screen.getByText("비교할 run 두 개가 필요합니다")).toBeDefined();
  });
});
