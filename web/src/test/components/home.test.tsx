import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunSummary } from "@anvil/runStore";
import { IdeaForm } from "@/components/home/IdeaForm";
import { RunList } from "@/components/home/RunList";
import { HomeClient } from "@/components/home/HomeClient";
import Home from "@/app/page";

// useRouter는 App Router 컨텍스트가 없으면 throw하므로 mock한다. next/link 렌더링은
// 유지해야 하므로 나머지 export는 실제 구현을 그대로 쓴다.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push }) };
});

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
  push.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const RUNS: RunSummary[] = [
  {
    runId: "r-completed",
    idea: "회의록 요약 서비스",
    createdAt: "2026-07-01T09:00:00+09:00",
    completedAt: "2026-07-01T09:10:00+09:00",
    status: "completed",
  },
  {
    runId: "r-completed-2",
    idea: "반려식물 관리 앱",
    createdAt: "2026-07-02T09:00:00+09:00",
    completedAt: "2026-07-02T09:10:00+09:00",
    status: "completed",
  },
  {
    runId: "r-error",
    idea: "점심 메뉴 추천",
    createdAt: "2026-07-03T09:00:00+09:00",
    status: "error",
  },
  {
    runId: "r-running",
    idea: "운동 코치 봇",
    createdAt: "2026-07-04T09:00:00+09:00",
    status: "running",
  },
];

describe("IdeaForm", () => {
  it("공백 입력이면 제출 버튼이 비활성화된다", () => {
    render(<IdeaForm idea="   " onIdeaChange={() => {}} />);
    const button = screen.getByRole("button", {
      name: "컨설팅 시작",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("제출 시 trim한 idea로 POST하고 runId로 이동한다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "new-run" }, 201));
    render(<IdeaForm idea="  회의록 요약 서비스  " onIdeaChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "컨설팅 시작" }));

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/runs/new-run"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      idea: "회의록 요약 서비스",
    });
  });

  it("API 실패 시 에러를 표시하고 이동하지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "서버가 응답하지 않습니다" }, 500),
    );
    render(<IdeaForm idea="유효한 아이디어" onIdeaChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "컨설팅 시작" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "서버가 응답하지 않습니다",
      ),
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe("RunList", () => {
  it("API의 run 목록을 아이디어 제목·상태 뱃지와 함께 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: RUNS }));
    render(<RunList onPickExample={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText("회의록 요약 서비스")).toBeDefined(),
    );
    expect(screen.getByText("점심 메뉴 추천")).toBeDefined();
    // 뱃지는 data-status 훅으로 조회한다 (필터 select의 option 텍스트와 구분).
    expect(document.querySelectorAll('[data-status="completed"]').length).toBe(
      2,
    );
    expect(document.querySelector('[data-status="error"]')).not.toBeNull();
    expect(document.querySelector('[data-status="running"]')).not.toBeNull();
  });

  it("상태 필터 선택 시 status 파라미터로 재조회한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: RUNS }));
    render(<RunList onPickExample={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("회의록 요약 서비스")).toBeDefined(),
    );

    fireEvent.change(screen.getByLabelText("상태 필터"), {
      target: { value: "completed" },
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("status=completed"),
      ),
    );
  });

  it("검색 입력을 디바운스해 q 파라미터로 재조회한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: RUNS }));
    render(<RunList onPickExample={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("회의록 요약 서비스")).toBeDefined(),
    );

    fireEvent.change(screen.getByLabelText("아이디어 검색"), {
      target: { value: "회의록" },
    });

    await waitFor(
      () => {
        const hit = fetchMock.mock.calls.some(
          ([u]) =>
            typeof u === "string" && decodeURIComponent(u).includes("q=회의록"),
        );
        expect(hit).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  it("실행 이력이 없고 필터도 없으면 온보딩 빈 상태와 예시 버튼을 보여준다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    const onPick = vi.fn();
    render(<RunList onPickExample={onPick} />);

    await waitFor(() =>
      expect(screen.getByText("아직 실행된 컨설팅이 없습니다")).toBeDefined(),
    );
    const example =
      "회의 녹음을 자동으로 요약하고 할 일을 뽑아주는 서비스";
    fireEvent.click(screen.getByRole("button", { name: example }));
    expect(onPick).toHaveBeenCalledWith(example);
  });

  it("error/stalled run의 '이어서 실행'은 resume POST 후 이동한다", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/resume")) {
        return jsonResponse({ runId: "r-error" }, 202);
      }
      return jsonResponse({ runs: RUNS });
    });
    render(<RunList onPickExample={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("점심 메뉴 추천")).toBeDefined(),
    );

    // running run에는 resume 버튼이 없어야 한다 (error 1건만)
    const resumeButtons = screen.getAllByRole("button", {
      name: "이어서 실행",
    });
    expect(resumeButtons.length).toBe(1);

    fireEvent.click(resumeButtons[0]);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/runs/r-error"),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/runs/r-error/resume"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("최초 목록 조회 실패 시 에러 카드를 보여주고 '다시 시도'로 복구한다", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(jsonResponse({ runs: RUNS }));
    render(<RunList onPickExample={() => {}} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "다시 시도" }),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(screen.getByText("회의록 요약 서비스")).toBeDefined(),
    );
  });

  it("완료 run 2개 선택 시 비교 버튼이 활성화되고 /compare로 이동한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: RUNS }));
    render(<RunList onPickExample={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("회의록 요약 서비스")).toBeDefined(),
    );

    const compareBtn = screen.getByRole("button", {
      name: /비교하기/,
    }) as HTMLButtonElement;
    expect(compareBtn.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("회의록 요약 서비스 비교 선택"));
    fireEvent.click(screen.getByLabelText("반려식물 관리 앱 비교 선택"));

    expect(compareBtn.disabled).toBe(false);
    fireEvent.click(compareBtn);
    expect(push).toHaveBeenCalledWith(
      "/compare?a=r-completed&b=r-completed-2",
    );
  });

  it("3번째 완료 run을 선택하면 가장 오래된 선택이 해제된다 (최대 2개)", async () => {
    const threeCompleted: RunSummary[] = ["c1", "c2", "c3"].map((id, i) => ({
      runId: id,
      idea: `아이디어 ${i + 1}`,
      createdAt: `2026-07-0${i + 1}T09:00:00+09:00`,
      completedAt: `2026-07-0${i + 1}T09:10:00+09:00`,
      status: "completed",
    }));
    fetchMock.mockResolvedValue(jsonResponse({ runs: threeCompleted }));
    render(<RunList onPickExample={() => {}} />);
    await waitFor(() => expect(screen.getByText("아이디어 1")).toBeDefined());

    fireEvent.click(screen.getByLabelText("아이디어 1 비교 선택"));
    fireEvent.click(screen.getByLabelText("아이디어 2 비교 선택"));
    fireEvent.click(screen.getByLabelText("아이디어 3 비교 선택"));

    expect(
      (screen.getByLabelText("아이디어 1 비교 선택") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText("아이디어 2 비교 선택") as HTMLInputElement)
        .checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /비교하기/ }));
    expect(push).toHaveBeenCalledWith("/compare?a=c2&b=c3");
  });
});

describe("Home 페이지 (page.tsx 조립)", () => {
  it("PageShell 헤더(anvil 링크)와 입력 폼을 렌더링한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    render(<Home />);

    const logo = screen.getByRole("link", { name: "anvil" });
    expect(logo.getAttribute("href")).toBe("/");
    expect(screen.getByLabelText("검증할 아이디어")).toBeDefined();
    await waitFor(() =>
      expect(screen.getByText("아직 실행된 컨설팅이 없습니다")).toBeDefined(),
    );
  });
});

describe("HomeClient (통합)", () => {
  it("빈 상태의 예시 버튼을 누르면 입력 폼 textarea가 채워진다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    render(<HomeClient />);

    await waitFor(() =>
      expect(screen.getByText("아직 실행된 컨설팅이 없습니다")).toBeDefined(),
    );
    const example = "반려식물의 물주기·분갈이 시기를 알려주는 앱";
    fireEvent.click(screen.getByRole("button", { name: example }));

    const textarea = screen.getByLabelText(
      "검증할 아이디어",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe(example);
  });
});
