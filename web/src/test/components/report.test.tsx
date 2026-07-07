import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CompetitorService,
  Criticism,
  MarketContext,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { CompetitorTable } from "@/components/report/CompetitorTable";
import { MarketContextSection } from "@/components/report/MarketContextSection";
import { VerdictBanner } from "@/components/report/VerdictBanner";
import { ReportView } from "@/components/report/ReportView";

afterEach(cleanup);

const criticism: Criticism = {
  painPointReality: [
    { claim: "페인포인트가 약하다", evidence: "근거1", severity: "fatal" },
    { claim: "대체재 존재", evidence: "근거2", severity: "minor" },
  ],
  bmWeakness: [
    { claim: "BM 취약", evidence: "근거3", severity: "major" },
  ],
  copycatRisk: [
    { claim: "카피 쉬움", evidence: "근거4", severity: "fatal" },
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

const marketContext: MarketContext = {
  ideaTitle: "AI 회의록 요약",
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
    },
    status: "completed",
    hasReport: true,
    context: marketContext,
    criticism,
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
  it("YouTube 인용 카드에 댓글·좋아요·새 탭 영상 링크를 렌더링한다", () => {
    render(<MarketContextSection context={marketContext} />);

    expect(
      screen.getByText("회의 끝나고 정리에 한 시간씩 써요"),
    ).toBeDefined();
    expect(screen.getByText(/좋아요 42/)).toBeDefined();
    const link = screen.getByRole("link", { name: "회의록 자동화 후기" });
    expect(link.getAttribute("href")).toBe("https://youtube.com/watch?v=abc");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("context가 없으면 데이터 없음 EmptyState를 보여준다", () => {
    render(<MarketContextSection context={undefined} />);
    expect(screen.getByText("시장 맥락 데이터가 없습니다")).toBeDefined();
  });
});

describe("ReportView (조립)", () => {
  it("헤더·verdict 배너·목차·시장 맥락 섹션과 나머지 섹션 스텁을 렌더링한다", () => {
    render(<ReportView detail={makeDetail()} />);

    // 헤더
    expect(
      screen.getByRole("heading", { level: 1, name: "AI 회의록 요약 서비스" }),
    ).toBeDefined();
    // verdict 배너 (역피라미드)
    expect(
      screen.getByText("현재 구조로는 시장에서 살아남기 어렵다."),
    ).toBeDefined();
    // 목차 앵커
    const nav = screen.getByRole("navigation", { name: "리포트 목차" });
    expect(nav.querySelector('a[href="#market"]')).not.toBeNull();
    expect(nav.querySelector('a[href="#solution"]')).not.toBeNull();
    // ① 시장 맥락 실제 렌더 + 나머지 스텁
    expect(screen.getByText("① 실시간 시장 맥락")).toBeDefined();
    expect(screen.getAllByText("다음 step에서 구현됩니다.").length).toBe(3);
  });
});
