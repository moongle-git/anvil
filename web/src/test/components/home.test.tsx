import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "@/components/home/HomePage";
import {
  completedSummary,
  COMPLETED_A_ID,
  COMPLETED_B_ID,
  errorSummary,
  runningSummary,
} from "@/test/clientFixtures";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

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

describe("HomePage", () => {
  it("run 목록을 렌더링한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        runs: [completedSummary(), runningSummary(), errorSummary()],
      }),
    );

    render(<HomePage />);

    expect(await screen.findByText("AI 회의록 요약 서비스")).toBeDefined();
    expect(screen.getByText("AI 식물 관리 서비스")).toBeDefined();
    expect(screen.getByText("AI 점심 추천 서비스")).toBeDefined();
    expect(screen.getAllByText("완료").length).toBeGreaterThan(0);
    expect(screen.getAllByText("진행중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("실패").length).toBeGreaterThan(0);
  });

  it("상태 필터를 API status 파라미터로 요청한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

    render(<HomePage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("상태"), { target: { value: "error" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/runs?status=error",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("run이 없으면 빈 상태와 예시 아이디어 버튼을 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));

    render(<HomePage />);

    expect(await screen.findByText("아직 실행된 컨설팅이 없습니다")).toBeDefined();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "동네 상권을 위한 재고 예측 SaaS",
      })[0],
    );
    expect(screen.getByLabelText("아이디어")).toHaveProperty(
      "value",
      "동네 상권을 위한 재고 예측 SaaS",
    );
  });

  it("폼 제출 성공 시 생성된 run 상세로 이동한다", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(jsonResponse({ runId: "new-run" }, 201));
      }
      return Promise.resolve(jsonResponse({ runs: [] }));
    });

    render(<HomePage />);

    fireEvent.change(screen.getByLabelText("아이디어"), {
      target: { value: "AI 세금 신고 도우미" },
    });
    fireEvent.click(screen.getByRole("button", { name: "컨설팅 시작" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/runs",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ idea: "AI 세금 신고 도우미" }),
        }),
      );
    });
    expect(push).toHaveBeenCalledWith("/runs/new-run");
  });

  it("완료 run 두 개를 선택하면 비교 버튼이 활성화된다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        runs: [
          completedSummary(COMPLETED_A_ID, "첫 번째 완료 run"),
          completedSummary(COMPLETED_B_ID, "두 번째 완료 run"),
          runningSummary(),
        ],
      }),
    );

    render(<HomePage />);

    const compareButton = screen.getByRole("button", { name: "비교하기" });
    expect((compareButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await screen.findByLabelText("첫 번째 완료 run 비교 선택"));
    fireEvent.click(screen.getByLabelText("두 번째 완료 run 비교 선택"));

    expect((compareButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(compareButton);
    expect(push).toHaveBeenCalledWith(
      `/compare?a=${COMPLETED_A_ID}&b=${COMPLETED_B_ID}`,
    );
  });
});
