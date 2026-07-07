import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunDetailPage } from "@/components/progress/RunDetailPage";
import {
  completedDetail,
  errorDetail,
  ERROR_ID,
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
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function flushAsyncState() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RunDetailPage", () => {
  it("진행중 run의 3단계 스테퍼와 번역 라벨을 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(runningDetail()));

    render(<RunDetailPage runId={RUNNING_ID} />);

    expect(await screen.findByRole("heading", { name: /시장 조사/ })).toBeDefined();
    expect(screen.getByRole("heading", { name: /냉정한 비판/ })).toBeDefined();
    expect(screen.getByRole("heading", { name: /AI 네이티브 재설계/ })).toBeDefined();
    expect(screen.getAllByText("진행중").length).toBeGreaterThan(0);
  });

  it("error step 메시지와 resume 버튼을 렌더링하고 POST를 호출한다", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse({ runId: ERROR_ID }, 202));
      }
      return Promise.resolve(jsonResponse(errorDetail()));
    });

    render(<RunDetailPage runId={ERROR_ID} />);

    expect(await screen.findByText("모델 호출 실패")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "이어서 실행" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/runs/${ERROR_ID}/resume`,
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("completed 상태면 리포트 뷰로 전환하고 폴링을 중단한다", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(completedDetail()));

    render(<RunDetailPage runId="completed-a" />);
    await flushAsyncState();

    expect(screen.getByText("① 시장 맥락")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("404 응답이면 not-found 상태를 렌더링하고 폴링을 중단한다", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse({ error: "not found" }, 404));

    render(<RunDetailPage runId="missing-run" />);
    await flushAsyncState();

    expect(screen.getByText("run을 찾을 수 없습니다")).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
