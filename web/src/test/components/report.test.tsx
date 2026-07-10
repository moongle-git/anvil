import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CompetitorService,
  Criticism,
  MarketContext,
  Solution,
  Thesis,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { CompetitorTable } from "@/components/report/CompetitorTable";
import { MarketContextSection } from "@/components/report/MarketContextSection";
import { SolutionSection } from "@/components/report/SolutionSection";
import { VerdictBanner } from "@/components/report/VerdictBanner";
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
    ...overrides,
  };
}

describe("VerdictBanner", () => {
  it("verdict 전문과 severity 집계(치명적 2·중대 1·경미 1)를 보여준다", () => {
    render(<VerdictBanner criticism={criticism} />);
    expect(
      screen.getByText("현재 구조로는 시장에서 살아남기 어렵다."),
    ).toBeDefined();
    expect(
      document.querySelector('[data-severity-count="fatal"]')?.textContent,
    ).toBe("2");
    expect(
      document.querySelector('[data-severity-count="major"]')?.textContent,
    ).toBe("1");
    expect(
      document.querySelector('[data-severity-count="minor"]')?.textContent,
    ).toBe("1");
  });

  it("criticism이 없으면 안내 문구를 보여준다", () => {
    render(<VerdictBanner criticism={undefined} />);
    expect(screen.getByText("비판 데이터를 불러올 수 없습니다.")).toBeDefined();
  });

  it("verdict의 볼드를 <strong>으로 렌더링하되 <p>를 중첩하지 않는다", () => {
    const { container } = render(
      <VerdictBanner
        criticism={{ ...criticism, verdict: "**치명적**이라고 판단한다." }}
      />,
    );

    expect(container.querySelector("p > strong")?.textContent).toBe("치명적");
    expect(container.textContent).not.toContain("**");
    // renderRichText를 쓰면 <p> 안에 <div><p>가 들어가 HTML이 무효가 된다
    expect(container.querySelector("p p")).toBeNull();
    expect(container.querySelector("p div")).toBeNull();
  });
});

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
  it("헤더·verdict 배너·목차·시장 맥락 섹션과 나머지 섹션 스텁을 렌더링한다", () => {
    render(<ReportView detail={makeDetail()} />);

    // 헤더
    expect(
      screen.getByRole("heading", { level: 1, name: "AI 회의록 요약 서비스" }),
    ).toBeDefined();
    // verdict는 상단 배너와 비판 섹션 콜아웃 두 곳에 나타난다 (역피라미드 + 최종 판정)
    expect(
      screen.getAllByText("현재 구조로는 시장에서 살아남기 어렵다.").length,
    ).toBe(2);
    // 목차 앵커
    const nav = screen.getByRole("navigation", { name: "리포트 목차" });
    expect(nav.querySelector('a[href="#market"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#thesis"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#solution"]')).not.toBeNull();
    // ①~④ 서사 섹션이 모두 실제로 렌더링된다 (스텁 없음).
    // ②正/③反은 DialecticSplit의 좌우 컬럼 헤더로 나타난다.
    // (⑤ 최종 판정 섹션 배치와 목차 갱신은 step 10 범위)
    expect(screen.getByText("① 실시간 시장 맥락")).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "② 낙관적 가설 (正)" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "③ 냉정한 비판 (反)" }),
    ).toBeDefined();
    expect(screen.getByText("재설계된 컨셉")).toBeDefined();
    // monetization은 별도 최상위 섹션이 아니라 合(SolutionSection)의 하위 절 ④로 흡수됐다
    expect(screen.getByText("④ 지속 가능한 비즈니스 모델")).toBeDefined();
    expect(screen.queryByText("다음 step에서 구현됩니다.")).toBeNull();
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
