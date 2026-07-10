import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CompetitorService,
  Criticism,
  MarketContext,
  Solution,
  Thesis,
  Verdict,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { CompetitorTable } from "@/components/report/CompetitorTable";
import { MarketContextSection } from "@/components/report/MarketContextSection";
import { SectionNav } from "@/components/report/SectionNav";
import { SolutionSection } from "@/components/report/SolutionSection";
import { ReportView } from "@/components/report/ReportView";
import {
  MONETIZATION_NUMBERED,
  REVISED_CONCEPT_NESTED,
} from "../richTextFixtures";

afterEach(cleanup);

const criticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      claim: "페인포인트가 약하다",
      evidence: "근거1",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "약한 통증",
    },
    {
      id: "c2",
      axis: "painPoint",
      claim: "대체재 존재",
      evidence: "근거2",
      severity: "minor",
      riskScore: 20,
      riskKeyword: "대체재",
    },
    {
      id: "c3",
      axis: "bm",
      claim: "BM 취약",
      evidence: "근거3",
      severity: "major",
      riskScore: 50,
      riskKeyword: "가격 침식",
    },
    {
      id: "c4",
      axis: "copycat",
      claim: "카피 쉬움",
      evidence: "근거4",
      severity: "fatal",
      riskScore: 78,
      riskKeyword: "복제 용이",
    },
  ],
  verdict: "현재 구조로는 시장에서 살아남기 어렵다.",
};

function makeCompetitors(n: number): CompetitorService[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `경쟁사 ${i + 1}`,
    description: `설명 ${i + 1}`,
    url: `https://example.com/${i + 1}`,
    pricingHint: i % 2 === 0 ? "무료" : "유료",
  }));
}

const solution: Solution = {
  revisedConcept:
    "**에이전트 기반 재설계**\n\n회의를 자동 관측해 요약과 액션을 만든다.",
  minimalInput: "사용자는 회의 링크만 제공한다.",
  agenticWorkflow: "관측 → 요약 → 액션 추출을 자동 실행한다.",
  dataFlywheel: "사용자 수정 피드백이 요약 품질을 높인다.",
  monetization: "팀 단위 구독. 좌석당 과금 모델.",
  synthesis: "낙관의 성장성과 반론의 번들 리스크를 종합하면 실행 추적이 해자다.",
};

const thesis: Thesis = {
  points: [
    {
      id: "t1",
      axis: "painPoint",
      claim: "회의 정리 통증은 실재한다",
      rationale: "회의 후 정리에 한 시간씩 쓴다는 목소리가 있다.",
    },
    {
      id: "t2",
      axis: "bm",
      claim: "팀 좌석당 구독에 지불 의사가 있다",
      rationale: "조직 단위 도입 수요가 관찰된다.",
    },
    {
      id: "t3",
      axis: "copycat",
      claim: "회의 데이터 진입점이 해자가 된다",
      rationale: "진입점을 선점하면 후발 주자가 따라오기 어렵다.",
    },
  ],
  revenueModel: "팀 좌석당 구독으로 확장한다.",
  growthLevers: ["조직 내 바이럴 확산", "캘린더 생태계 번들"],
  marketTailwinds: ["원격근무 확산", "AI 요약 수요 증가"],
  bestCaseScenario: "2년 내 팀 침투율 20% 달성 시 카테고리 리더.",
  winningThesis: "회의 데이터 진입점을 선점하면 실행 추적 시장을 장악한다.",
};

const marketContext: MarketContext = {
  ideaTitle: "AI 회의록 요약",
  briefing: "요약 기능이 번들로 흡수되며 독립 서비스의 유료화 명분이 좁아진다.",
  marketSizeIndicators: [],
  competitorInsight: "무료 티어가 지배해 요약 단독 포지션은 소진됐다.",
  voicesInsight: "지불 의사는 요약이 아니라 그 다음 단계에 남는다.",
  trends: ["AI 요약 수요 증가", "원격근무 확산"],
  competitors: makeCompetitors(9),
  youtubeVoices: [
    {
      videoTitle: "회의록 자동화 후기",
      videoUrl: "https://youtube.com/watch?v=abc",
      comment: "회의 끝나고 정리에 한 시간씩 써요",
      authorName: "user1",
      likeCount: 42,
    },
  ],
  painPointEvidence: ["회의록 작성에 주당 3시간"],
  sources: ["https://vertexaisearch.google.com/redirect/very-long-url-aaaaaa"],
};

const verdict: Verdict = {
  survivalScore: 55,
  recommendation: "pivot",
  headline: "요약을 버리고 실행 추적으로 재편하면 생존 가능성이 열린다.",
  rationale:
    "핵심 가치를 요약이 아니라 실행 추적으로 옮기면 번들 흡수를 우회할 수 있다.",
  residualRisks: [
    {
      keyword: "번들 흡수",
      severity: "major",
      note: "대형 협업 도구가 요약을 번들로 흡수할 수 있다.",
    },
  ],
  conditions: ["6개월 내 팀 3곳 유료 전환"],
};

function makeDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    state: {
      runId: "r1",
      idea: "AI 회의록 요약 서비스",
      createdAt: "2026-07-01T09:00:00.000Z",
      steps: [],
      completedAt: "2026-07-01T09:05:00.000Z",
      interview: false,
    },
    status: "completed",
    hasReport: true,
    context: marketContext,
    thesis,
    criticism,
    solution,
    verdict,
    ...overrides,
  };
}

describe("CompetitorTable", () => {
  it("초기 8개만 보이고 '1개 더보기'로 전체를 확장한다", () => {
    render(<CompetitorTable competitors={makeCompetitors(9)} />);

    expect(screen.getByText("경쟁사 8")).toBeDefined();
    expect(screen.queryByText("경쟁사 9")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1개 더보기" }));

    expect(screen.getByText("경쟁사 9")).toBeDefined();
    expect(screen.queryByRole("button", { name: /더보기/ })).toBeNull();
  });

  it("8개 이하면 더보기 버튼이 없다", () => {
    render(<CompetitorTable competitors={makeCompetitors(8)} />);
    expect(screen.queryByRole("button", { name: /더보기/ })).toBeNull();
  });
});

describe("MarketContextSection", () => {
  it("정제된 인사이트(briefing·competitorInsight·voicesInsight)를 접히지 않은 본문에 보여준다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();

    const briefingNode = screen.getByText(marketContext.briefing);
    const competitorInsightNode = screen.getByText(
      marketContext.competitorInsight,
    );
    const voicesInsightNode = screen.getByText(marketContext.voicesInsight);

    expect(details?.contains(briefingNode)).toBe(false);
    expect(details?.contains(competitorInsightNode)).toBe(false);
    expect(details?.contains(voicesInsightNode)).toBe(false);
  });

  it("원시 근거(첫 경쟁사·첫 YouTube 댓글 원문)는 <details> 안에 접어 둔다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const details = container.querySelector("details");

    const firstCompetitor = screen.getByText("경쟁사 1");
    const firstComment = screen.getByText("회의 끝나고 정리에 한 시간씩 써요");

    expect(details?.contains(firstCompetitor)).toBe(true);
    expect(details?.contains(firstComment)).toBe(true);
  });

  it("근거 <details>는 기본 닫힘이고 summary 클릭으로 열린다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.hasAttribute("open")).toBe(false);

    fireEvent.click(container.querySelector("summary") as HTMLElement);
    expect(details.open).toBe(true);
  });

  it("summary 문자열에 경쟁사·유저 목소리 건수를 표기한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const summary = container.querySelector("summary")?.textContent ?? "";
    expect(summary).toContain("경쟁 서비스 9개");
    expect(summary).toContain("유저 목소리 1건");
  });

  it("marketSizeIndicators가 비면 '시장 규모 지표' 소제목을 렌더링하지 않는다", () => {
    render(
      <MarketContextSection
        context={{ ...marketContext, marketSizeIndicators: [] }}
      />,
    );
    expect(screen.queryByText("시장 규모 지표")).toBeNull();
  });

  it("marketSizeIndicators가 있으면 소제목과 지표를 접히지 않은 본문에 보여준다", () => {
    const { container } = render(
      <MarketContextSection
        context={{ ...marketContext, marketSizeIndicators: ["연 30% 성장"] }}
      />,
    );
    const heading = screen.getByText("시장 규모 지표");
    const indicator = screen.getByText("연 30% 성장");
    const details = container.querySelector("details");

    expect(details?.contains(heading)).toBe(false);
    expect(details?.contains(indicator)).toBe(false);
  });

  it("youtubeVoices가 비면 접힌 영역에 '수집된 YouTube 목소리 없음'을 표시하고 voicesInsight는 본문에 남긴다", () => {
    const { container } = render(
      <MarketContextSection context={{ ...marketContext, youtubeVoices: [] }} />,
    );
    const details = container.querySelector("details");
    const emptyVoices = screen.getByText("수집된 YouTube 목소리 없음");
    expect(details?.contains(emptyVoices)).toBe(true);

    const voicesInsightNode = screen.getByText(marketContext.voicesInsight);
    expect(details?.contains(voicesInsightNode)).toBe(false);
  });

  it("원시 배열이 모두 비면 <details> 자체를 렌더링하지 않는다", () => {
    const { container } = render(
      <MarketContextSection
        context={{
          ...marketContext,
          trends: [],
          competitors: [],
          youtubeVoices: [],
          painPointEvidence: [],
          sources: [],
        }}
      />,
    );
    expect(container.querySelector("details")).toBeNull();
  });

  it("YouTube 영상 링크가 새 탭(target·rel)으로 열린다", () => {
    render(<MarketContextSection context={marketContext} />);
    const link = screen.getByRole("link", { name: "회의록 자동화 후기" });
    expect(link.getAttribute("href")).toBe("https://youtube.com/watch?v=abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("briefing의 **볼드**를 <strong>으로 변환해 ** 문자를 노출하지 않는다", () => {
    const { container } = render(
      <MarketContextSection
        context={{ ...marketContext, briefing: "**핵심**은 번들 흡수다." }}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("핵심");
    expect(container.textContent).not.toContain("**");
  });

  it("context가 없으면 데이터 없음 EmptyState를 보여주고 throw하지 않는다", () => {
    expect(() =>
      render(<MarketContextSection context={undefined} />),
    ).not.toThrow();
    expect(screen.getByText("시장 맥락 데이터가 없습니다")).toBeDefined();
  });

  it("aria-labelledby로 섹션이 제목과 연결된다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("market");
    expect(container.querySelector("#market")?.tagName).toBe("H2");
  });
});

describe("ReportView (조립)", () => {
  it("헤더·목차·다섯 서사 섹션을 렌더링한다", () => {
    render(<ReportView detail={makeDetail()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "AI 회의록 요약 서비스" }),
    ).toBeDefined();

    // 시장 맥락 헤딩은 '실시간'을 유지해 목차 라벨('① 시장 맥락')과 충돌하지 않는다
    expect(screen.getByText("① 실시간 시장 맥락")).toBeDefined();
    // ②正/③反은 DialecticSplit의 좌우 컬럼 헤더(H2)로 나타난다
    expect(
      screen.getByRole("heading", { level: 2, name: "② 낙관적 가설 (正)" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "③ 냉정한 비판 (反)" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "④ 인사이트 및 재설계 (合)" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "⑤ 최종 판정" }),
    ).toBeDefined();
    // criticism.verdict(反 소결론)는 이제 배너가 사라져 DialecticSplit 한 곳에만 나타난다
    expect(
      screen.getAllByText("현재 구조로는 시장에서 살아남기 어렵다.").length,
    ).toBe(1);
  });

  it("다섯 섹션을 시장 맥락 → 正/反 → 合 → 최종 판정 DOM 순서로 렌더링한다", () => {
    render(<ReportView detail={makeDetail()} />);
    const ids = ["market", "thesis", "antithesis", "solution", "verdict"];
    const els = ids.map((id) => document.getElementById(id));
    els.forEach((el) => expect(el).not.toBeNull());
    for (let i = 0; i < els.length - 1; i++) {
      expect(
        els[i]!.compareDocumentPosition(els[i + 1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("verdict.headline이 criticism.verdict(反 소결론)보다 뒤에 나온다 (결론 후치)", () => {
    const { container } = render(<ReportView detail={makeDetail()} />);
    const text = container.textContent ?? "";
    expect(text.indexOf(criticism.verdict)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(verdict.headline)).toBeGreaterThan(
      text.indexOf(criticism.verdict),
    );
  });

  // ADR-008 회귀 방지선: 상단(헤더~첫 섹션)에 결론·생존 점수·severity 집계가 없어야 한다.
  it("상단에 결론(severity 집계·생존 점수·headline)을 노출하지 않는다 (역피라미드 제거)", () => {
    render(<ReportView detail={makeDetail()} />);

    // 상단 배너의 severity 집계 뱃지가 코드베이스에서 사라졌다
    expect(document.querySelector("[data-severity-count]")).toBeNull();

    const market = document.getElementById("market");
    expect(market).not.toBeNull();

    // 생존 점수 게이지는 최종 판정 섹션(#market 뒤)에만 있다
    const gauge = document.querySelector("[data-survival-score]");
    expect(gauge).not.toBeNull();
    expect(
      market!.compareDocumentPosition(gauge!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 최종 판정 headline도 #market보다 뒤에 온다
    const headline = screen.getByText(verdict.headline);
    expect(
      market!.compareDocumentPosition(headline) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("목차 앵커 5개가 실제 섹션 id와 모두 일치한다 (끊어진 앵커 없음)", () => {
    render(<ReportView detail={makeDetail()} />);
    const nav = screen.getByRole("navigation", { name: "리포트 목차" });
    const links = Array.from(nav.querySelectorAll('a[href^="#"]'));
    expect(links.length).toBe(5);
    for (const link of links) {
      const id = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("verdict가 없고 hasReport면 구버전 안내 배너를 보여준다", () => {
    render(
      <ReportView detail={makeDetail({ verdict: undefined, hasReport: true })} />,
    );
    expect(screen.getByText(/이전 버전 형식으로 생성/)).toBeDefined();
  });

  it("verdict가 있으면 구버전 안내 배너를 보여주지 않는다", () => {
    render(<ReportView detail={makeDetail()} />);
    expect(screen.queryByText(/이전 버전 형식으로 생성/)).toBeNull();
  });

  it("모든 산출물이 undefined인 구버전 run도 throw 없이 렌더링한다", () => {
    expect(() =>
      render(
        <ReportView
          detail={makeDetail({
            context: undefined,
            thesis: undefined,
            criticism: undefined,
            solution: undefined,
            verdict: undefined,
            hasReport: false,
          })}
        />,
      ),
    ).not.toThrow();
  });
});

describe("SectionNav", () => {
  it("nav에 aria-label이 있고 5단계 서사 순서의 앵커를 노출한다", () => {
    render(<SectionNav />);
    const nav = screen.getByRole("navigation", { name: "리포트 목차" });
    const hrefs = Array.from(nav.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "#market",
      "#thesis",
      "#antithesis",
      "#solution",
      "#verdict",
    ]);
  });

  it("IntersectionObserver가 없는 환경에서 throw하지 않는다", () => {
    const original = globalThis.IntersectionObserver;
    // @ts-expect-error jsdom 기본 상태(미정의)를 재현한다
    delete globalThis.IntersectionObserver;
    expect(() => render(<SectionNav />)).not.toThrow();
    globalThis.IntersectionObserver = original;
  });

  it("현재 뷰포트 섹션 항목에 aria-current='location'을 붙인다 (observer mock)", () => {
    let captured: IntersectionObserverCallback | undefined;
    const original = globalThis.IntersectionObserver;
    class MockObserver {
      constructor(cb: IntersectionObserverCallback) {
        captured = cb;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn();
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    globalThis.IntersectionObserver =
      MockObserver as unknown as typeof IntersectionObserver;

    render(<SectionNav />);
    act(() => {
      captured?.(
        [
          {
            target: { id: "solution" } as Element,
            isIntersecting: true,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });

    const active = screen.getByRole("link", {
      name: "④ 인사이트 및 재설계 (合)",
    });
    expect(active.getAttribute("aria-current")).toBe("location");
    // 나머지 항목엔 aria-current가 없다
    expect(
      screen
        .getByRole("link", { name: "① 시장 맥락" })
        .getAttribute("aria-current"),
    ).toBeNull();

    globalThis.IntersectionObserver = original;
  });
});

describe("SolutionSection", () => {
  it("synthesis 리드를 revisedConcept보다 먼저 렌더링한다 (合)", () => {
    const { container } = render(<SolutionSection solution={solution} />);
    const text = container.textContent ?? "";
    expect(text).toContain("정반합 통찰");
    expect(text).toContain(
      "낙관의 성장성과 반론의 번들 리스크를 종합하면 실행 추적이 해자다.",
    );
    // synthesis가 섹션의 리드 — 재설계 컨셉보다 앞에 온다 (DOM 순서)
    expect(text.indexOf("정반합 통찰")).toBeLessThan(text.indexOf("재설계된 컨셉"));
  });

  it("revisedConcept 리드 블록을 서브섹션보다 먼저 렌더링한다 (역피라미드)", () => {
    const { container } = render(<SolutionSection solution={solution} />);
    const text = container.textContent ?? "";
    expect(text.indexOf("재설계된 컨셉")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("재설계된 컨셉")).toBeLessThan(
      text.indexOf("① 최소 입력 구조"),
    );
  });

  it("4개 하위 절 제목을 순서대로 보여준다 (monetization 흡수)", () => {
    const { container } = render(<SolutionSection solution={solution} />);
    const text = container.textContent ?? "";
    expect(screen.getByText("① 최소 입력 구조")).toBeDefined();
    expect(screen.getByText("② 에이전틱 워크플로우")).toBeDefined();
    expect(screen.getByText("③ 독점적 데이터 플라이휠")).toBeDefined();
    expect(screen.getByText("④ 지속 가능한 비즈니스 모델")).toBeDefined();
    expect(text.indexOf("① 최소 입력 구조")).toBeLessThan(
      text.indexOf("④ 지속 가능한 비즈니스 모델"),
    );
  });

  it("monetization을 별도 <section>이 아니라 이 섹션 하위 절로 흡수한다", () => {
    const { container } = render(<SolutionSection solution={solution} />);
    // 섹션은 하나뿐이고(monetization 별도 섹션 없음), monetization 본문이 그 안에 있다
    expect(container.querySelectorAll("section").length).toBe(1);
    const monetizationNode = screen.getByText("팀 단위 구독. 좌석당 과금 모델.");
    expect(container.querySelector("section")?.contains(monetizationNode)).toBe(
      true,
    );
  });

  it("synthesis가 없으면 정반합 통찰 블록을 숨긴다 (구 solution 하위호환)", () => {
    const { synthesis, ...withoutSynthesis } = solution;
    void synthesis;
    expect(() =>
      render(<SolutionSection solution={withoutSynthesis} />),
    ).not.toThrow();
    expect(screen.queryByText("정반합 통찰")).toBeNull();
    // synthesis가 없어도 나머지는 정상 렌더링된다
    expect(screen.getByText("재설계된 컨셉")).toBeDefined();
  });

  it("재설계 컨셉의 2계층 불릿을 중첩 <ul>로 렌더링한다", () => {
    const { container } = render(
      <SolutionSection
        solution={{ ...solution, revisedConcept: REVISED_CONCEPT_NESTED }}
      />,
    );

    expect(container.querySelectorAll("ul ul > li").length).toBe(7);
    expect(container.textContent).not.toContain("*");
  });

  // 실데이터 회귀: 개행 0개짜리 818자 monetization이 통짜 <p> 하나로 렌더링되던 버그.
  // monetization이 이 섹션으로 흡수됐으므로 회귀 커버리지도 여기로 옮긴다.
  it("개행 없는 번호 목록 monetization을 <ol> 3개 항목으로 렌더링한다", () => {
    const { container } = render(
      <SolutionSection
        solution={{ ...solution, monetization: MONETIZATION_NUMBERED }}
      />,
    );

    expect(container.querySelectorAll("ol > li").length).toBe(3);
    expect(container.querySelectorAll("ol > li > strong").length).toBe(3);
    expect(container.textContent).not.toContain("*");
  });

  it("solution이 없으면 EmptyState를 보여준다", () => {
    render(<SolutionSection solution={undefined} />);
    expect(screen.getByText("재설계 데이터가 없습니다")).toBeDefined();
  });
});
