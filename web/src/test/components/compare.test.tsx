import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DIALECTIC_AXIS_LABELS,
  RECOMMENDATIONS,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_SCORE_BANDS,
  type Criticism,
  type Solution,
  type Verdict,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { CompareClient } from "@/components/compare/CompareClient";
import { CompareMatrix } from "@/components/compare/CompareMatrix";
import { buildRiskProfile } from "@/lib/risk";

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

// riskKeyword는 severity 라벨(치명적/중대/경미)과 겹치지 않게 둔다 — 훅 조회 시 오탐 방지.
const criticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      claim: "c",
      evidence: "e",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "허구성",
    },
    {
      id: "c2",
      axis: "bm",
      claim: "c",
      evidence: "e",
      severity: "major",
      riskScore: 50,
      riskKeyword: "수익불안",
    },
    {
      id: "c3",
      axis: "copycat",
      claim: "c",
      evidence: "e",
      severity: "minor",
      riskScore: 20,
      riskKeyword: "모방용이",
    },
  ],
  verdict: "이것은 反의 소결론이다",
};

const solution: Solution = {
  revisedConcept: "재설계 컨셉 본문",
  minimalInput: "x",
  agenticWorkflow: "y",
  dataFlywheel: "z",
  monetization: "구독 모델 본문",
};

const verdictA: Verdict = {
  survivalScore: 75,
  recommendation: "proceed",
  headline: "A는 추진할 만하다",
  rationale: "근거 A",
  residualRisks: [{ keyword: "잔존A", severity: "minor", note: "노트A" }],
  conditions: ["3개월 내 유료 100명 검증"],
};

const verdictB: Verdict = {
  survivalScore: 30,
  recommendation: "abandon",
  headline: "B는 접는 게 낫다",
  rationale: "근거 B",
  residualRisks: [{ keyword: "잔존B", severity: "fatal", note: "노트B" }],
  conditions: ["재검토 필요"],
};

function makeDetail(
  runId: string,
  idea: string,
  status: RunDetail["status"] = "completed",
  overrides: Partial<RunDetail> = {},
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
    verdict: verdictA,
    ...overrides,
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
  it("두 완료 run을 fetch해 새 ROWS 순서로 렌더링한다", async () => {
    params.current = new URLSearchParams("a=r1&b=r2");
    routeFetch({
      r1: jsonResponse(makeDetail("r1", "아이디어 A")),
      r2: jsonResponse(makeDetail("r2", "아이디어 B", "completed", { verdict: verdictB })),
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

    // 결론(생존 점수)이 맨 위, 근거(재설계 컨셉)가 아래 — 비교 효용 순서
    const text = container.textContent ?? "";
    expect(text.indexOf("생존 점수")).toBeLessThan(text.indexOf("리스크 집계"));
    expect(text.indexOf("리스크 집계")).toBeLessThan(
      text.indexOf("재설계된 컨셉"),
    );

    // 병렬 fetch 2회
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("구독 모델 본문").length).toBe(2);
  });
});

describe("CompareMatrix 콘텐츠", () => {
  it("두 run의 survivalScore를 각각 data-survival-score로 노출한다", () => {
    const { container } = render(
      <CompareMatrix
        a={makeDetail("r1", "A")}
        b={makeDetail("r2", "B", "completed", { verdict: verdictB })}
      />,
    );
    const scores = Array.from(
      container.querySelectorAll("[data-survival-score]"),
    ).map((el) => el.getAttribute("data-survival-score"));
    expect(scores).toContain("75");
    expect(scores).toContain("30");
  });

  it.each([...RECOMMENDATIONS])(
    "recommendation '%s'의 한국어 라벨을 노출한다",
    (rec) => {
      render(
        <CompareMatrix
          a={makeDetail("r1", "A", "completed", {
            verdict: {
              ...verdictA,
              recommendation: rec,
              survivalScore: RECOMMENDATION_SCORE_BANDS[rec].min,
            },
          })}
          b={makeDetail("r2", "B", "completed", { verdict: undefined })}
        />,
      );
      expect(
        screen.getAllByText(RECOMMENDATION_LABELS[rec]).length,
      ).toBeGreaterThan(0);
    },
  );

  it("verdict.headline을 렌더링하고 criticism.verdict를 최종 판정으로 렌더링하지 않는다", () => {
    render(
      <CompareMatrix
        a={makeDetail("r1", "A")}
        b={makeDetail("r2", "B", "completed", { verdict: verdictB })}
      />,
    );
    expect(screen.getByText("A는 추진할 만하다")).toBeDefined();
    expect(screen.getByText("B는 접는 게 낫다")).toBeDefined();
    // "최종 판정" 라벨 자체가 없고, 反의 소결론 원문도 렌더링되지 않는다 (ADR-010)
    expect(screen.queryByText("최종 판정")).toBeNull();
    expect(screen.queryByText("이것은 反의 소결론이다")).toBeNull();
  });

  it("buildRiskProfile의 세 축 라벨·점수·키워드를 모두 노출한다", () => {
    const { container } = render(
      <CompareMatrix a={makeDetail("r1", "A")} b={makeDetail("r2", "B")} />,
    );
    // 축 라벨은 상수에서 온다 — 하드코딩하지 않는다
    expect(DIALECTIC_AXIS_LABELS.painPoint).toBe("페인포인트");
    for (const axis of buildRiskProfile(criticism)) {
      const cell = container.querySelector(`[data-risk-axis="${axis.axis}"]`);
      expect(cell).not.toBeNull();
      const cellText = cell?.textContent ?? "";
      expect(cellText).toContain(axis.label);
      expect(cellText).toContain(`${axis.score}/100`);
      expect(cellText).toContain(axis.keyword);
    }
  });

  it("한쪽 run에 verdict가 없으면 그 셀에 —를 보이고 throw하지 않는다", () => {
    render(
      <CompareMatrix
        a={makeDetail("r1", "A")}
        b={makeDetail("r2", "B", "completed", { verdict: undefined })}
      />,
    );
    // a.verdict가 있어 생존 점수 행은 유지되고, b 셀은 대시
    expect(screen.getByText("생존 점수")).toBeDefined();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("두 run 모두 verdict가 없으면 생존 점수·판정·한 줄 결론 행을 생략한다", () => {
    render(
      <CompareMatrix
        a={makeDetail("r1", "A", "completed", { verdict: undefined })}
        b={makeDetail("r2", "B", "completed", { verdict: undefined })}
      />,
    );
    expect(screen.queryByText("생존 점수")).toBeNull();
    expect(screen.queryByText("판정")).toBeNull();
    expect(screen.queryByText("한 줄 결론")).toBeNull();
    // 나머지 행은 유지된다 (빈 행 3개만 걷어낸다)
    expect(screen.getByText("리스크 집계")).toBeDefined();
    expect(screen.getByText("재설계된 컨셉")).toBeDefined();
  });

  it("한쪽 run이 완전 구버전(모든 산출물 undefined)이어도 렌더링한다", () => {
    expect(() =>
      render(
        <CompareMatrix
          a={makeDetail("r1", "A", "completed", {
            criticism: undefined,
            solution: undefined,
            verdict: undefined,
            hasReport: false,
          })}
          b={makeDetail("r2", "B")}
        />,
      ),
    ).not.toThrow();
    // 정상 run(b)의 내용은 정상 노출된다
    expect(screen.getAllByText("재설계 컨셉 본문").length).toBeGreaterThan(0);
  });

  it("행이 정의된 ROWS 순서로 렌더링된다", () => {
    const { container } = render(
      <CompareMatrix a={makeDetail("r1", "A")} b={makeDetail("r2", "B")} />,
    );
    const text = container.textContent ?? "";
    const order = [
      "생존 점수",
      "판정",
      "한 줄 결론",
      "리스크 집계",
      "축별 최고 위험도",
      "재설계된 컨셉",
      "비즈니스 모델",
    ];
    const positions = order.map((label) => text.indexOf(label));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
  });

  it("모바일 식별 라벨(각 셀 위의 run 아이디어)을 유지한다", () => {
    render(
      <CompareMatrix
        a={makeDetail("r1", "아이디어 A")}
        b={makeDetail("r2", "아이디어 B")}
      />,
    );
    // 컬럼 헤더 링크 1회 + 각 행 셀의 모바일 라벨 → 1회보다 많이 나타난다
    expect(screen.getAllByText("아이디어 A").length).toBeGreaterThan(1);
  });
});
