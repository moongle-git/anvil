import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Criticism, Solution } from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { CompareClient } from "@/components/compare/CompareClient";

// useSearchParams를 mock: 테스트마다 current를 바꿔 ?a=&b= 시나리오를 준다.
const { params } = vi.hoisted(() => ({
  params: { current: new URLSearchParams() },
}));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useSearchParams: () => params.current };
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
  vi.stubGlobal("fetch", fetchMock);
  params.current = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const criticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      claim: "c",
      evidence: "e",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "치명",
    },
    {
      id: "c2",
      axis: "bm",
      claim: "c",
      evidence: "e",
      severity: "major",
      riskScore: 50,
      riskKeyword: "중대",
    },
    {
      id: "c3",
      axis: "copycat",
      claim: "c",
      evidence: "e",
      severity: "minor",
      riskScore: 20,
      riskKeyword: "경미",
    },
  ],
  verdict: "판정 문장",
};

const solution: Solution = {
  revisedConcept: "재설계 컨셉 본문",
  minimalInput: "x",
  agenticWorkflow: "y",
  dataFlywheel: "z",
  monetization: "구독 모델 본문",
};

function makeDetail(
  runId: string,
  idea: string,
  status: RunDetail["status"] = "completed",
): RunDetail {
  return {
    state: {
      runId,
      idea,
      createdAt: "2026-07-01T09:00:00.000Z",
      steps: [],
      interview: false,
      ...(status === "completed"
        ? { completedAt: "2026-07-01T09:05:00.000Z" }
        : {}),
    },
    status,
    hasReport: true,
    criticism,
    solution,
  };
}

function routeFetch(map: Record<string, Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    for (const [id, res] of Object.entries(map)) {
      if (url.endsWith(`/api/runs/${id}`)) return res;
    }
    return jsonResponse({ error: "없음" }, 404);
  });
}

describe("CompareClient 가드", () => {
  it("b 파라미터가 없으면 비교를 차단한다", () => {
    params.current = new URLSearchParams("a=r1");
    render(<CompareClient />);
    expect(screen.getByText("비교할 수 없습니다")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a와 b가 같으면 비교를 차단한다", () => {
    params.current = new URLSearchParams("a=r1&b=r1");
    render(<CompareClient />);
    expect(screen.getByText("비교할 수 없습니다")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("한쪽 run이 404면 '존재하지 않는' 안내를 보여준다", async () => {
    params.current = new URLSearchParams("a=r1&b=missing");
    routeFetch({ r1: jsonResponse(makeDetail("r1", "아이디어 A")) });
    render(<CompareClient />);
    await waitFor(() =>
      expect(
        screen.getByText("존재하지 않는 run이 포함되어 있습니다."),
      ).toBeDefined(),
    );
  });

  it("한쪽이 미완료면 '완료된 run만' 안내를 보여준다", async () => {
    params.current = new URLSearchParams("a=r1&b=r2");
    routeFetch({
      r1: jsonResponse(makeDetail("r1", "아이디어 A")),
      r2: jsonResponse(makeDetail("r2", "아이디어 B", "running")),
    });
    render(<CompareClient />);
    await waitFor(() =>
      expect(
        screen.getByText("완료된 run만 비교할 수 있습니다."),
      ).toBeDefined(),
    );
  });
});

describe("CompareClient 에러 복구", () => {
  it("fetch 실패 시 에러 카드를 보여주고 '다시 시도'로 복구한다", async () => {
    params.current = new URLSearchParams("a=r1&b=r2");
    let calls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ error: "서버 오류" }, 500); // 최초 로드 실패
      }
      if (url.endsWith("/api/runs/r1")) {
        return jsonResponse(makeDetail("r1", "아이디어 A"));
      }
      if (url.endsWith("/api/runs/r2")) {
        return jsonResponse(makeDetail("r2", "아이디어 B"));
      }
      return jsonResponse({ error: "없음" }, 404);
    });
    render(<CompareClient />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "다시 시도" }),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "아이디어 A" })).toBeDefined(),
    );
  });
});

describe("CompareClient 정상 비교", () => {
  it("두 완료 run을 5개 행(실행정보→severity→판정→컨셉→BM) 순서로 렌더링한다", async () => {
    params.current = new URLSearchParams("a=r1&b=r2");
    routeFetch({
      r1: jsonResponse(makeDetail("r1", "아이디어 A")),
      r2: jsonResponse(makeDetail("r2", "아이디어 B")),
    });
    const { container } = render(<CompareClient />);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "아이디어 A" })).toBeDefined(),
    );

    // 두 run 리포트 링크
    expect(
      screen.getByRole("link", { name: "아이디어 A" }).getAttribute("href"),
    ).toBe("/runs/r1");
    expect(
      screen.getByRole("link", { name: "아이디어 B" }).getAttribute("href"),
    ).toBe("/runs/r2");

    // 행 라벨과 순서
    const text = container.textContent ?? "";
    expect(text.indexOf("severity 집계")).toBeLessThan(text.indexOf("최종 판정"));
    expect(text.indexOf("최종 판정")).toBeLessThan(text.indexOf("재설계된 컨셉"));
    expect(text.indexOf("재설계된 컨셉")).toBeLessThan(
      text.indexOf("비즈니스 모델"),
    );

    // 병렬 fetch 2회
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 내용 대조 (양쪽 verdict/컨셉/BM)
    expect(screen.getAllByText("판정 문장").length).toBe(2);
    expect(screen.getAllByText("구독 모델 본문").length).toBe(2);
  });
});
