import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarketContextSchema,
  SOURCE_LABELS,
  type CompetitorService,
  type Criticism,
  type MarketContext,
  type Solution,
  type SourceCoverage,
  type Thesis,
  type Verdict,
} from "@anvil/types";
import type { RunDetail } from "@/lib/server/runs";
import { CompetitorTable } from "@/components/report/CompetitorTable";
import { MarketContextSection } from "@/components/report/MarketContextSection";
import { SectionNav } from "@/components/report/SectionNav";
import { SolutionSection } from "@/components/report/SolutionSection";
import { ReportView } from "@/components/report/ReportView";
import legacyContextFixture from "@/test/fixtures/2026-07-01T09-00-00-000Z-ai-meeting-notes-fx01/context.json";
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

/** urlContext가 실제로 읽어낸 원본 URL — 만료되지 않는 유일한 검색 인용이다 (ADR-013) */
const ORIGIN_CITATION = {
  uri: "https://clovanote.naver.com/pricing",
  title: "클로바노트 요금제",
  domain: "clovanote.naver.com",
  kind: "origin" as const,
};

/** groundingChunks의 vertexaisearch 리다이렉트 — 만료되면 404다 */
const REDIRECT_CITATION = {
  uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa",
  title: "협업 도구 시장 리포트 2026",
  domain: "statista.com",
  kind: "redirect" as const,
};

const REDIRECT_CITATION_NO_TITLE = {
  uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb",
  domain: "clovanote.naver.com",
  kind: "redirect" as const,
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
  // fatal(c1·c4) 전건 커버리지 — 원장 없는 솔루션은 이제 파이프라인을 통과할 수 없으므로
  // 픽스처도 그 계약을 지킨다 (step 2~5가 e2e·cli·orchestrator 픽스처에 한 것과 동형)
  remedies: [
    {
      respondsTo: "c1",
      strategy: "bypass",
      remedy: "요약이 아니라 실행 추적으로 전장을 옮긴다.",
    },
    {
      respondsTo: "c4",
      strategy: "defend",
      remedy: "수정 피드백 플라이휠이 복제 비용을 올린다.",
    },
  ],
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
  communityVoices: [
    {
      source: "youtube",
      title: "회의록 자동화 후기",
      url: "https://youtube.com/watch?v=abc",
      text: "회의 끝나고 정리에 한 시간씩 써요",
      authorName: "user1",
      score: 42,
    },
    {
      source: "hackernews",
      title: "Ask HN: meeting notes tools",
      url: "https://news.ycombinator.com/item?id=42",
      text: "Summaries are commoditized. Action tracking is where the pain is.",
      authorName: "hn_user",
      score: 88,
    },
    {
      source: "naver",
      title: "회의록 정리 팁 공유합니다",
      url: "https://cafe.naver.com/pm/1",
      text: "요약은 되는데 누가 뭘 하기로 했는지는 결국 손으로 옮겨 적어요...",
      authorName: "기획자모임",
      extra: "검색 스니펫",
    },
  ],
  painPointEvidence: ["회의록 작성에 주당 3시간"],
  sources: ["https://vertexaisearch.google.com/redirect/very-long-url-aaaaaa"],
  researchCoverage: [],
  citations: [REDIRECT_CITATION, REDIRECT_CITATION_NO_TITLE, ORIGIN_CITATION],
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

  // 링크 박탈 (ADR-013): competitors[].url은 LLM이 타이핑한 URL이라 실측 60%가 죽어 있다
  it("경쟁사 URL에는 링크가 없고 URL 문자열만 텍스트로 남는다", () => {
    const [competitor] = makeCompetitors(1);
    render(<CompetitorTable competitors={[competitor]} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText(competitor.url!)).toBeDefined();
    expect(screen.queryByText("바로가기")).toBeNull();
  });

  it("URL이 없는 경쟁사는 —로 표기한다", () => {
    render(
      <CompetitorTable
        competitors={[{ name: "경쟁사", description: "설명" }]}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
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

  it("summary 문자열에 경쟁사·유저 목소리 건수와 소스별 내역·인용 개수를 표기한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const summary = container.querySelector("summary")?.textContent ?? "";
    expect(summary).toContain("경쟁 서비스 9개");
    expect(summary).toContain("유저 목소리 3건");
    expect(summary).toContain(
      `${SOURCE_LABELS.youtube} 1 · ${SOURCE_LABELS.hackernews} 1 · ${SOURCE_LABELS.naver} 1`,
    );
    expect(summary).toContain("인용 3개");
  });

  it("세 소스의 목소리를 각각 소스 뱃지와 함께 접힌 영역에 렌더링한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const details = container.querySelector("details");

    for (const voice of marketContext.communityVoices) {
      const card = container.querySelector(
        `[data-voice-source="${voice.source}"]`,
      );
      expect(card, `누락된 소스 카드: ${voice.source}`).not.toBeNull();
      expect(card?.textContent).toContain(voice.text);
      expect(card?.textContent).toContain(SOURCE_LABELS[voice.source]);
      expect(details?.contains(card!)).toBe(true);
    }
  });

  it("목소리를 소스별 그룹(라벨 · 건수)으로 묶는다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    for (const source of ["youtube", "hackernews", "naver"] as const) {
      const group = container.querySelector(`[data-voice-group="${source}"]`);
      expect(group, `누락된 소스 그룹: ${source}`).not.toBeNull();
      expect(group?.textContent).toContain(`${SOURCE_LABELS[source]} · 1건`);
    }
  });

  it("목소리가 없는 소스는 그룹째 렌더링하지 않는다", () => {
    const { container } = render(
      <MarketContextSection
        context={{
          ...marketContext,
          communityVoices: marketContext.communityVoices.filter(
            (voice) => voice.source === "youtube",
          ),
        }}
      />,
    );
    expect(container.querySelector('[data-voice-group="youtube"]')).not.toBeNull();
    expect(container.querySelector('[data-voice-group="naver"]')).toBeNull();
    expect(
      container.querySelector('[data-voice-group="hackernews"]'),
    ).toBeNull();
  });

  it("네이버 목소리의 extra(검색 스니펫) 표시를 노출한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const naverCard = container.querySelector('[data-voice-source="naver"]');
    expect(naverCard?.textContent).toContain("검색 스니펫");
  });

  it("citations를 '출처'와 분리된 '검색 인용' 소제목으로 접힌 영역에 렌더링한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const details = container.querySelector("details");

    // 출처(LLM 자기보고)와 검색 인용(코드 추출)은 별개 목록이다 (ADR-012)
    const sourcesHeading = screen.getByText(/^출처/);
    const citationsHeading = screen.getByText("검색 인용");
    expect(details?.contains(sourcesHeading)).toBe(true);
    expect(details?.contains(citationsHeading)).toBe(true);

    expect(
      container.querySelector('[data-citation-list="origin"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-citation-list="redirect"]'),
    ).not.toBeNull();
  });

  it("citations만 있고 나머지 원시 배열이 비어도 <details>를 렌더링한다", () => {
    const { container } = render(
      <MarketContextSection
        context={{
          ...marketContext,
          trends: [],
          competitors: [],
          communityVoices: [],
          painPointEvidence: [],
          sources: [],
        }}
      />,
    );
    expect(container.querySelector("details")).not.toBeNull();
    expect(
      container.querySelectorAll('[data-citation-list="origin"] a').length,
    ).toBe(1);
  });

  // ── 링크 박탈 (ADR-013): 클릭 가능한 링크는 코드가 API 응답에서 주입한 것뿐이다 ──

  it("sources 항목에는 링크가 하나도 없다 — LLM이 타이핑한 URL이다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const list = container.querySelector("[data-source-list]");
    expect(list).not.toBeNull();

    // URL 문자열 자체는 남기되(독자가 직접 검색할 수 있게) 클릭 가능성은 약속하지 않는다
    expect(list!.textContent).toContain(marketContext.sources[0]);
    expect(within(list as HTMLElement).queryAllByRole("link")).toHaveLength(0);
  });

  it("강등된 출처가 미검증임을 스크린리더에도 알린다", () => {
    render(<MarketContextSection context={marketContext} />);
    // 목록의 접근 가능한 이름과 소제목 양쪽에서 미검증임이 드러난다
    expect(screen.getByRole("list", { name: /미검증/ })).toBeDefined();
    expect(screen.getByText(/LLM 자기보고 · 미검증/)).toBeDefined();
  });

  it("접기 요약줄의 출처 건수도 검증됐다고 오해시키지 않는다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const summary = container.querySelector("summary")?.textContent ?? "";
    expect(summary).toContain("미검증 출처 1개");
  });

  it("kind가 origin인 citation만 링크이고 href가 uri와 일치한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const origins = within(
      container.querySelector('[data-citation-list="origin"]') as HTMLElement,
    ).getAllByRole("link");

    expect(origins).toHaveLength(1);
    expect(origins[0].getAttribute("href")).toBe(ORIGIN_CITATION.uri);
    expect(origins[0].textContent).toBe(ORIGIN_CITATION.title);
    expect(origins[0].getAttribute("target")).toBe("_blank");
    expect(origins[0].getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("kind가 redirect인 citation은 링크가 아니고 만료 가능함을 고지한다", () => {
    const { container } = render(
      <MarketContextSection context={marketContext} />,
    );
    const redirects = container.querySelector(
      '[data-citation-list="redirect"]',
    ) as HTMLElement;

    expect(within(redirects).queryAllByRole("link")).toHaveLength(0);
    expect(redirects.textContent).toContain(REDIRECT_CITATION.title);
    // title이 없으면 domain으로 폴백한다
    expect(redirects.textContent).toContain(REDIRECT_CITATION_NO_TITLE.domain);
    expect(redirects.textContent).toContain("만료 가능");
  });

  it("communityVoices의 출처는 링크로 남는다 — 코드가 수집 API에서 주입한 사실이다", () => {
    render(<MarketContextSection context={marketContext} />);
    for (const voice of marketContext.communityVoices) {
      const link = screen.getByRole("link", { name: voice.title });
      expect(link.getAttribute("href")).toBe(voice.url);
    }
  });

  // ── 자료조사 커버리지 (ADR-013): 수집되지 않은 소스를 침묵으로 숨기지 않는다 ──

  describe("자료조사 커버리지", () => {
    const coverage: SourceCoverage[] = [
      { source: "youtube", status: "collected", count: 12 },
      { source: "hackernews", status: "collected", count: 0 },
      { source: "naver", status: "unconfigured", count: 0 },
    ];

    function renderCovered(overrides: Partial<MarketContext> = {}) {
      return render(
        <MarketContextSection
          context={{ ...marketContext, researchCoverage: coverage, ...overrides }}
        />,
      );
    }

    it("키가 없어 조사조차 안 한 소스를 미설정 상태로 렌더링한다", () => {
      const { container } = renderCovered();
      const naver = container.querySelector(
        '[data-coverage-source="naver"]',
      ) as HTMLElement;

      expect(naver).not.toBeNull();
      expect(naver.getAttribute("data-coverage-status")).toBe("unconfigured");
      expect(naver.textContent).toContain(SOURCE_LABELS.naver);
      expect(naver.textContent).toContain("미설정");
    });

    it("세 상태(collected N건 · collected 0건 · unconfigured)를 서로 다른 텍스트로 구분한다", () => {
      const { container } = renderCovered();
      const textOf = (source: string) =>
        container.querySelector(`[data-coverage-source="${source}"]`)
          ?.textContent ?? "";

      expect(textOf("youtube")).toContain("12건");
      // "조사했는데 0건"은 시장 신호다 — "미설정"으로 뭉개면 안 된다
      expect(textOf("hackernews")).toContain("0건");
      expect(textOf("hackernews")).not.toContain("미설정");
      expect(textOf("naver")).not.toContain("0건");
    });

    it("수집 실패는 사유(error)와 함께 보여준다", () => {
      const { container } = renderCovered({
        researchCoverage: [
          { source: "naver", status: "failed", count: 0, error: "quota exceeded" },
        ],
      });
      const naver = container.querySelector(
        '[data-coverage-source="naver"]',
      ) as HTMLElement;

      expect(naver.getAttribute("data-coverage-status")).toBe("failed");
      expect(naver.textContent).toContain("수집 실패");
      expect(naver.textContent).toContain("quota exceeded");
    });

    it("커버리지는 접히지 않은 본문에 있다 — 근거의 범위를 먼저 알린다", () => {
      const { container } = renderCovered();
      const list = container.querySelector("[data-coverage-list]");
      expect(container.querySelector("details")?.contains(list!)).toBe(false);
    });

    it("citations가 0건이면 인용이 없다는 사실을 명시한다", () => {
      const { container } = renderCovered({ citations: [] });
      const note = container.querySelector(
        '[data-citation-coverage="empty"]',
      ) as HTMLElement;

      expect(note).not.toBeNull();
      expect(note.textContent).toContain("인용 없음");
    });

    it("researchCoverage가 비면(구 run) 커버리지 영역을 렌더링하지 않는다", () => {
      const { container } = render(
        <MarketContextSection context={marketContext} />,
      );
      expect(container.querySelector("[data-coverage-list]")).toBeNull();
      expect(container.querySelector("[data-citation-coverage]")).toBeNull();
    });

    it("접기 요약줄의 소스별 내역이 0건·미설정 소스를 더 이상 숨기지 않는다", () => {
      const { container } = renderCovered({
        communityVoices: marketContext.communityVoices.filter(
          (voice) => voice.source === "youtube",
        ),
      });
      const summary = container.querySelector("summary")?.textContent ?? "";
      expect(summary).toContain(
        `${SOURCE_LABELS.youtube} 1 · ${SOURCE_LABELS.hackernews} 0 · ${SOURCE_LABELS.naver} 미설정`,
      );
    });
  });

  it("구 형식(youtubeVoices) run도 승격 후 목소리를 렌더링한다 (ADR-012 하위호환)", () => {
    const legacy = MarketContextSchema.parse(legacyContextFixture);
    const { container } = render(<MarketContextSection context={legacy} />);

    const details = container.querySelector("details");
    expect(details).not.toBeNull();

    const cards = container.querySelectorAll('[data-voice-source="youtube"]');
    expect(cards.length).toBe(legacy.communityVoices.length);
    expect(cards.length).toBeGreaterThan(0);
    expect(details?.contains(cards[0])).toBe(true);
    expect(cards[0].textContent).toContain(legacy.communityVoices[0].text);
    expect(cards[0].textContent).toContain(SOURCE_LABELS.youtube);
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

  it("communityVoices가 비면 접힌 영역에 '수집된 유저 목소리 없음'을 표시하고 voicesInsight는 본문에 남긴다", () => {
    const { container } = render(
      <MarketContextSection
        context={{ ...marketContext, communityVoices: [] }}
      />,
    );
    const details = container.querySelector("details");
    const emptyVoices = screen.getByText("수집된 유저 목소리 없음");
    expect(details?.contains(emptyVoices)).toBe(true);

    const voicesInsightNode = screen.getByText(marketContext.voicesInsight);
    expect(details?.contains(voicesInsightNode)).toBe(false);
  });

  it("원시 배열이 모두 비고 citations도 비면 <details> 자체를 렌더링하지 않는다", () => {
    const { container } = render(
      <MarketContextSection
        context={{
          ...marketContext,
          trends: [],
          competitors: [],
          communityVoices: [],
          painPointEvidence: [],
          sources: [],
          citations: [],
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
