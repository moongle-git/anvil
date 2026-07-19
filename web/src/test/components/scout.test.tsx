import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Opportunity,
  ResolvedCapitalSignal,
  RunState,
  StepState,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { HomeClient } from "@/components/home/HomeClient";
import { ScoutForm } from "@/components/home/ScoutForm";
import { OpportunityPicker } from "@/components/progress/OpportunityPicker";
import { ProgressView } from "@/components/progress/ProgressView";
import { RunDetailClient } from "@/components/progress/RunDetailClient";
import { ReportView } from "@/components/report/ReportView";

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

// --- 후보 fixture ---

const FUNDING_SIGNAL: ResolvedCapitalSignal = {
  signalType: "funding",
  statement: "산업용 열관리 스타트업이 시리즈B로 $4.2B를 조달했다",
  observedAt: "2026-03-11",
  citation: {
    kind: "origin",
    uri: "https://example-news.test/heat-series-b",
    title: "열관리 스타트업 시리즈B",
    domain: "example-news.test",
  },
  figures: [
    {
      value: "$4.2B",
      citation: {
        kind: "origin",
        uri: "https://example-news.test/heat-series-b",
        title: "열관리 스타트업 시리즈B",
        domain: "example-news.test",
      },
    },
  ],
  quote: "이번 라운드는 데이터센터 냉각 수요를 겨냥한 것이다",
};

const REGULATION_SIGNAL: ResolvedCapitalSignal = {
  signalType: "regulation",
  statement: "EU가 데이터센터 폐열 재사용 의무를 확정했다",
  observedAt: "2026-01-20",
  effectiveAt: "2027-01-01",
  citation: {
    kind: "redirect",
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AB",
    title: "EU 폐열 지침",
    domain: "eur-lex.test",
  },
  figures: [],
};

const COUNTER_SIGNAL: ResolvedCapitalSignal = {
  signalType: "incumbent",
  statement: "대형 클라우드 사업자는 자체 냉각팀을 확대해 외주 수요가 줄고 있다",
  observedAt: "2026-05-02",
  citation: {
    kind: "origin",
    uri: "https://incumbent-report.test/cooling",
    title: "클라우드 냉각 내재화 보고서",
    domain: "incumbent-report.test",
  },
  figures: [],
};

const CANDIDATE_A: Opportunity = {
  id: "O1",
  title: "데이터센터 폐열 거래 플랫폼",
  whatItIs: "데이터센터의 폐열을 인근 수요처와 중개하는 정산 플랫폼",
  signals: [FUNDING_SIGNAL, REGULATION_SIGNAL],
  counterSignal: COUNTER_SIGNAL,
  whyNow: "규제 시행일이 확정되며 폐열 처리 비용이 회계에 잡히기 시작했다",
  whoPays: "데이터센터 운영사와 지역난방 사업자",
  horizon: "mid",
};

const CANDIDATE_B: Opportunity = {
  ...CANDIDATE_A,
  id: "O2",
  title: "산업 폐수 열회수 설비 리스",
  whatItIs: "중소 제조사에 열회수 설비를 구독형으로 공급한다",
};

const OPPORTUNITIES = {
  candidates: [CANDIDATE_A, CANDIDATE_B],
  scope: "전 범위 탐색",
  searchedAt: "2026-07-19T05:00:00.000Z",
};

// --- RunDetail 빌더 ---

function scoutState(steps: StepState[], overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "s1",
    idea: "전 범위 탐색",
    createdAt: "2026-07-19T05:00:00.000Z",
    steps,
    interview: false,
    scout: true,
    ...overrides,
  };
}

const waitingScoutDetail: RunDetail = {
  state: scoutState([
    { name: "trend-scout", status: "waiting", startedAt: "2026-07-19T05:00:01.000Z" },
    { name: "context-hunter", status: "pending" },
  ]),
  status: "waiting",
  hasReport: false,
  opportunities: OPPORTUNITIES,
};

const NO_CANDIDATES_MESSAGE =
  "자본 흐름 근거를 찾지 못해 후보를 만들지 않았다. 탐색 범위를 바꿔 새 run으로 다시 시도하라.";

const noCandidatesDetail: RunDetail = {
  state: scoutState([
    {
      name: "trend-scout",
      status: "error",
      startedAt: "2026-07-19T05:00:01.000Z",
      failedAt: "2026-07-19T05:02:01.000Z",
      errorMessage: NO_CANDIDATES_MESSAGE,
    },
    { name: "context-hunter", status: "pending" },
  ]),
  status: "error",
  hasReport: false,
};

const completedScoutDetail: RunDetail = {
  state: scoutState(
    [
      {
        name: "trend-scout",
        status: "completed",
        startedAt: "2026-07-19T05:00:01.000Z",
        completedAt: "2026-07-19T05:02:00.000Z",
      },
    ],
    {
      idea: `${CANDIDATE_A.title} — ${CANDIDATE_A.whatItIs}`,
      completedAt: "2026-07-19T05:30:00.000Z",
    },
  ),
  status: "completed",
  hasReport: true,
  opportunities: OPPORTUNITIES,
  scoutOrigin: {
    scope: OPPORTUNITIES.scope,
    searchedAt: OPPORTUNITIES.searchedAt,
    opportunity: CANDIDATE_A,
  },
};

// ── 홈: 두 모드 ──

describe("홈 — 주제 찾기 모드", () => {
  it("범위를 비운 채로도 제출 버튼이 활성이다", () => {
    render(<ScoutForm scope="" onScopeChange={() => {}} />);
    const button = screen.getByRole("button", {
      name: "주제 찾기",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("빈 범위로 제출하면 mode: scout으로 POST하고 새 run으로 이동한다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "scout-run" }, 201));
    render(<ScoutForm scope="   " onScopeChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "주제 찾기" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/runs/scout-run"));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "scout",
      scope: "",
    });
  });

  it("범위 힌트를 적으면 trim해서 함께 보낸다", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "scout-run" }, 201));
    render(<ScoutForm scope="  기후 기술  " onScopeChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "주제 찾기" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      mode: "scout",
      scope: "기후 기술",
    });
  });

  it("HomeClient는 직접 입력이 기본이고 모드를 전환할 수 있다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runs: [] }));
    render(<HomeClient />);

    // 기본 모드: 기존 동작 그대로 (회귀 없음)
    expect(screen.getByRole("button", { name: "컨설팅 시작" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "주제 찾기" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "주제 찾기" }));

    expect(screen.getByRole("button", { name: "주제 찾기" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "컨설팅 시작" })).toBeNull();
  });

  it("직접 입력 모드는 기존 payload를 그대로 보낸다 (회귀 없음)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ runs: [] }));
    render(<HomeClient />);

    const textarea = screen.getByLabelText("검증할 아이디어");
    fireEvent.change(textarea, { target: { value: "회의록 요약 서비스" } });

    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "plain-run" }, 201));
    fireEvent.click(screen.getByRole("button", { name: "컨설팅 시작" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/runs/plain-run"));
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    const init = call?.[1] as RequestInit;
    expect(call?.[0]).toBe("/api/runs");
    expect(JSON.parse(init.body as string)).toEqual({
      idea: "회의록 요약 서비스",
    });
  });
});

// ── 진행 뷰 스테퍼 ──

describe("진행 뷰 — 스카우트 스테퍼", () => {
  it("trend-scout이 사용자 언어 라벨로 표시된다", () => {
    render(<ProgressView detail={waitingScoutDetail} onResume={() => {}} />);
    const item = document.querySelector('[data-step-name="trend-scout"]');
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain("주제 발굴");
    // 내부 step명이 그대로 노출되면 안 된다
    expect(item?.textContent).not.toContain("trend-scout");
  });
});

// ── 후보 선택 화면 ──

describe("후보 선택 화면", () => {
  function renderPicker(onSubmitted = () => {}) {
    return render(
      <OpportunityPicker
        runId="s1"
        opportunities={OPPORTUNITIES}
        onSubmitted={onSubmitted}
      />,
    );
  }

  it("후보의 제목·설명·타이밍·수익원·시계를 렌더한다", () => {
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]');
    expect(card).not.toBeNull();
    const text = card?.textContent ?? "";
    expect(text).toContain(CANDIDATE_A.title);
    expect(text).toContain(CANDIDATE_A.whatItIs);
    expect(text).toContain(CANDIDATE_A.whyNow);
    expect(text).toContain(CANDIDATE_A.whoPays);
    expect(text).toContain("중기");
  });

  it("신호의 observedAt과 출처 domain이 보인다", () => {
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]');
    const text = card?.textContent ?? "";
    expect(text).toContain("2026-03-11");
    expect(text).toContain("example-news.test");
    // 시행일도 함께 — 규제 신호의 값어치는 시행일에 있다
    expect(text).toContain("2027-01-01");
  });

  it("origin 인용만 링크가 되고 redirect는 만료 고지 텍스트로 남는다", () => {
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]') as HTMLElement;
    const link = within(card).getByRole("link", {
      name: /열관리 스타트업 시리즈B/,
    });
    expect(link.getAttribute("href")).toBe(FUNDING_SIGNAL.citation.uri);
    // 만료되는 리다이렉트에는 href를 걸지 않는다 (ADR-013)
    expect(
      within(card).queryByRole("link", { name: /EU 폐열 지침/ }),
    ).toBeNull();
    expect(card.textContent).toContain("EU 폐열 지침");
  });

  it("counterSignal이 접히지 않고 기본 노출된다", () => {
    renderPicker();
    const counter = document.querySelector(
      '[data-candidate-id="O1"] [data-counter-signal]',
    );
    expect(counter).not.toBeNull();
    expect(counter?.textContent).toContain(COUNTER_SIGNAL.statement);
    // <details> 안에 숨어 있으면 "기본 노출"이 아니다
    expect(counter?.closest("details")).toBeNull();
  });

  it("quote가 있으면 사람이 눈으로 대조할 수 있게 원문을 보여준다", () => {
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]');
    expect(card?.textContent).toContain(FUNDING_SIGNAL.quote as string);
  });

  it("점수·순위·추천 뱃지를 만들어내지 않는다", () => {
    renderPicker();
    const text = document.body.textContent ?? "";
    for (const forbidden of ["점수", "순위", "추천", "1위", "best", "Best"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(document.querySelector("[data-score]")).toBeNull();
    expect(document.querySelector("[data-rank]")).toBeNull();
  });

  it("모델이 낸 순서를 그대로 유지한다", () => {
    renderPicker();
    const ids = [...document.querySelectorAll("[data-candidate-id]")].map((el) =>
      el.getAttribute("data-candidate-id"),
    );
    expect(ids).toEqual(["O1", "O2"]);
  });

  it("카드의 선택 버튼만으로는 POST하지 않는다 — 확인을 거쳐야 한다", async () => {
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]') as HTMLElement;

    fireEvent.click(within(card).getByRole("button", { name: "이 주제로 진행" }));
    expect(fetchMock).not.toHaveBeenCalled();

    // 확인 줄이 그 자리에 뜬다
    const confirm = within(card).getByRole("button", { name: "시작" });
    fetchMock.mockResolvedValueOnce(jsonResponse({ runId: "s1" }, 202));
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/s1/selection");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ candidateId: "O1" });
  });

  it("확인을 취소하면 아무것도 제출되지 않는다", () => {
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "이 주제로 진행" }));
    fireEvent.click(within(card).getByRole("button", { name: "취소" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      within(card).getByRole("button", { name: "이 주제로 진행" }),
    ).toBeDefined();
  });

  it("제출 중에는 이중 제출이 막힌다", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "이 주제로 진행" }));
    const confirm = within(card).getByRole("button", {
      name: "시작",
    }) as HTMLButtonElement;

    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(jsonResponse({ runId: "s1" }, 202));
  });

  it("제출에 실패하면 사유를 알리고 다시 시도할 수 있다", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "이미 진행 중입니다" }, 409),
    );
    renderPicker();
    const card = document.querySelector('[data-candidate-id="O1"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "이 주제로 진행" }));
    fireEvent.click(within(card).getByRole("button", { name: "시작" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "이미 진행 중입니다",
      ),
    );
  });

  it("waiting인 스카우트 run 상세에서 선택 화면이 뜬다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(waitingScoutDetail));
    render(<RunDetailClient runId="s1" />);

    await waitFor(() =>
      expect(screen.getByText(CANDIDATE_A.title)).toBeDefined(),
    );
    // 인터뷰 폼이 아니라 후보 선택이다
    expect(screen.queryByText("몇 가지만 확인할게요")).toBeNull();
  });
});

// ── 후보 0개 ──

describe("후보 0개 — 설계된 침묵", () => {
  it("새 탐색을 안내하고 홈으로 가는 길을 준다", () => {
    render(<ProgressView detail={noCandidatesDetail} onResume={() => {}} />);

    const box = document.querySelector('[data-scout-exhausted]');
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain(NO_CANDIDATES_MESSAGE);
    expect(box?.textContent).toContain("범위");
    expect(
      within(box as HTMLElement).getByRole("link", { name: /새 탐색/ }).getAttribute("href"),
    ).toBe("/");
  });

  it("같은 자리에서 다시 멈추는 '이어서 실행'을 권하지 않는다", () => {
    const onResume = vi.fn();
    render(<ProgressView detail={noCandidatesDetail} onResume={onResume} />);
    const item = document.querySelector(
      '[data-step-name="trend-scout"]',
    ) as HTMLElement;
    expect(within(item).queryByRole("button", { name: "이어서 실행" })).toBeNull();
  });

  it("스카우트가 아닌 run의 error는 기존 resume 경로 그대로다 (회귀 없음)", () => {
    const plainError: RunDetail = {
      state: {
        runId: "r1",
        idea: "회의록 요약 서비스",
        createdAt: "2026-07-19T05:00:00.000Z",
        interview: false,
        scout: false,
        steps: [
          {
            name: "cold-critic",
            status: "error",
            startedAt: "2026-07-19T05:00:01.000Z",
            errorMessage: "검색 API 호출에 실패했습니다",
          },
        ],
      },
      status: "error",
      hasReport: false,
    };
    const onResume = vi.fn();
    render(<ProgressView detail={plainError} onResume={onResume} />);
    fireEvent.click(screen.getByRole("button", { name: "이어서 실행" }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-scout-exhausted]")).toBeNull();
  });
});

// ── 리포트 뷰 ──

describe("리포트 뷰 — 주제 출처", () => {
  it("① 시장 맥락보다 앞에 온다", () => {
    render(<ReportView detail={completedScoutDetail} />);
    const origin = document.querySelector("[data-scout-origin]");
    const market = document.getElementById("market");
    expect(origin).not.toBeNull();
    expect(market).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING = 4 — market이 origin 뒤에 온다
    const relation = (origin as Node).compareDocumentPosition(market as Node);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("근거 신호와 반대 증거를 모두 싣는다", () => {
    render(<ReportView detail={completedScoutDetail} />);
    const origin = document.querySelector("[data-scout-origin]") as HTMLElement;
    expect(origin.textContent).toContain(FUNDING_SIGNAL.statement);
    expect(origin.textContent).toContain(COUNTER_SIGNAL.statement);
    expect(origin.textContent).toContain(OPPORTUNITIES.scope);
  });

  it("판정·점수를 상단에 노출하지 않는다 (ADR-008)", () => {
    render(<ReportView detail={completedScoutDetail} />);
    const origin = document.querySelector("[data-scout-origin]") as HTMLElement;
    for (const forbidden of ["생존", "점수", "판정", "추천"]) {
      expect(origin.textContent).not.toContain(forbidden);
    }
  });

  it("SectionNav 목차는 여전히 5개다", () => {
    render(<ReportView detail={completedScoutDetail} />);
    const nav = screen.getByRole("navigation", { name: "리포트 목차" });
    expect(within(nav).getAllByRole("link")).toHaveLength(5);
  });

  it("스카우트가 아닌 run에는 출처 블록이 없다 (회귀 없음)", () => {
    const plain: RunDetail = {
      ...completedScoutDetail,
      state: { ...completedScoutDetail.state, scout: false },
    };
    delete (plain as { scoutOrigin?: unknown }).scoutOrigin;
    render(<ReportView detail={plain} />);
    expect(document.querySelector("[data-scout-origin]")).toBeNull();
  });
});
