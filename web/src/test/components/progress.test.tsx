import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunState, StepState } from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { ProgressView } from "@/components/progress/ProgressView";
import { RunDetailClient } from "@/components/progress/RunDetailClient";
import { useRunDetail } from "@/components/progress/useRunDetail";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// --- RunDetail 빌더 ---

function makeState(steps: StepState[], completedAt?: string): RunState {
  return {
    runId: "r1",
    idea: "반려식물 케어 구독 서비스",
    createdAt: "2026-07-03T14:00:00.000Z",
    steps,
    ...(completedAt ? { completedAt } : {}),
  };
}

const RUNNING_STEPS: StepState[] = [
  {
    name: "context-hunter",
    status: "completed",
    startedAt: "2026-07-03T14:00:01.000Z",
    completedAt: "2026-07-03T14:01:45.000Z",
  },
  { name: "cold-critic", status: "pending" },
  { name: "solution-designer", status: "pending" },
];

const runningDetail: RunDetail = {
  state: makeState(RUNNING_STEPS),
  status: "running",
  hasReport: false,
};

const inProgressDetail: RunDetail = {
  state: makeState([
    { ...RUNNING_STEPS[0] },
    {
      name: "cold-critic",
      status: "pending",
      startedAt: "2026-07-03T14:01:45.000Z",
    },
    { name: "solution-designer", status: "pending" },
  ]),
  status: "running",
  hasReport: false,
};

const errorDetail: RunDetail = {
  state: makeState([
    { ...RUNNING_STEPS[0] },
    {
      name: "cold-critic",
      status: "error",
      startedAt: "2026-07-03T14:01:45.000Z",
      failedAt: "2026-07-03T14:01:50.000Z",
      errorMessage: "검색 API 호출에 실패했습니다",
    },
    { name: "solution-designer", status: "pending" },
  ]),
  status: "error",
  hasReport: false,
};

const stalledDetail: RunDetail = {
  state: makeState(RUNNING_STEPS),
  status: "stalled",
  hasReport: false,
};

const completedDetail: RunDetail = {
  state: makeState(
    RUNNING_STEPS.map((s) => ({
      ...s,
      status: "completed" as const,
      startedAt: "2026-07-03T14:00:01.000Z",
      completedAt: "2026-07-03T14:01:45.000Z",
    })),
    "2026-07-03T14:05:00.000Z",
  ),
  status: "completed",
  hasReport: true,
};

describe("useRunDetail (폴링)", () => {
  it("running이면 intervalMs마다 폴링하고 completed면 멈춘다", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(runningDetail))
      .mockResolvedValueOnce(jsonResponse(runningDetail))
      .mockResolvedValueOnce(jsonResponse(completedDetail));

    const { result } = renderHook(() => useRunDetail("r1", 2000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.detail?.status).toBe("completed");

    // completed 이후에는 더 이상 폴링하지 않는다
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("404면 not-found로 폴링을 멈춘다", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({ error: "없음" }, 404));

    const { result } = renderHook(() => useRunDetail("missing", 2000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.notFound).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("error 상태면 폴링을 멈춘다 (사용자 resume 대기)", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(errorDetail));

    renderHook(() => useRunDetail("r1", 2000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ProgressView", () => {
  it("내부 step명을 사용자 언어로 번역해 스테퍼를 렌더링한다", () => {
    render(<ProgressView detail={runningDetail} onResume={() => {}} />);
    expect(screen.getByText("시장 조사")).toBeDefined();
    expect(screen.getByText("냉정한 비판")).toBeDefined();
    expect(screen.getByText("AI 네이티브 재설계")).toBeDefined();
  });

  it("step 상태를 data-step-status로 노출한다 (완료/대기)", () => {
    render(<ProgressView detail={runningDetail} onResume={() => {}} />);
    expect(
      document
        .querySelector('[data-step-name="context-hunter"]')
        ?.getAttribute("data-step-status"),
    ).toBe("completed");
    expect(
      document
        .querySelector('[data-step-name="cold-critic"]')
        ?.getAttribute("data-step-status"),
    ).toBe("pending");
  });

  it("startedAt 있고 completedAt 없으면 진행중(running)으로 표시한다", () => {
    render(<ProgressView detail={inProgressDetail} onResume={() => {}} />);
    expect(
      document
        .querySelector('[data-step-name="cold-critic"]')
        ?.getAttribute("data-step-status"),
    ).toBe("running");
  });

  it("step error면 errorMessage와 '이어서 실행'을 보여주고 클릭 시 onResume", () => {
    const onResume = vi.fn();
    render(<ProgressView detail={errorDetail} onResume={onResume} />);
    expect(screen.getByText("검색 API 호출에 실패했습니다")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "이어서 실행" }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("run이 stalled면 중단 안내와 '이어서 실행'을 보여준다", () => {
    const onResume = vi.fn();
    render(<ProgressView detail={stalledDetail} onResume={onResume} />);
    expect(screen.getByText(/중단된 것 같습니다/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "이어서 실행" }));
    expect(onResume).toHaveBeenCalledOnce();
  });
});

describe("RunDetailClient (분기)", () => {
  it("completed면 리포트 뷰(제목·다운로드 링크)를 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(completedDetail));
    render(<RunDetailClient runId="r1" />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: completedDetail.state.idea,
        }),
      ).toBeDefined(),
    );
    expect(
      screen.getByRole("link", { name: "report.md 다운로드" }),
    ).toBeDefined();
  });

  it("running이면 진행 뷰를 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(runningDetail));
    render(<RunDetailClient runId="r1" />);
    await waitFor(() => expect(screen.getByText("시장 조사")).toBeDefined());
  });

  it("404면 not-found 안내를 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "없음" }, 404));
    render(<RunDetailClient runId="missing" />);
    await waitFor(() =>
      expect(screen.getByText("run을 찾을 수 없습니다")).toBeDefined(),
    );
  });

  it("최초 로딩이 실패하면 에러 카드를 보여주고 '다시 시도'로 복구한다", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(jsonResponse(runningDetail));
    render(<RunDetailClient runId="r1" />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "다시 시도" }),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByText("시장 조사")).toBeDefined());
  });

  it("resume 버튼 클릭 시 POST resume를 호출한다", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/resume")) {
        return jsonResponse({ runId: "r1" }, 202);
      }
      return jsonResponse(errorDetail);
    });
    render(<RunDetailClient runId="r1" />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "이어서 실행" }),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "이어서 실행" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/runs/r1/resume"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
