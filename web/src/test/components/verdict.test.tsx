import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RECOMMENDATION_LABELS,
  RECOMMENDATION_SCORE_BANDS,
  RECOMMENDATIONS,
  type Verdict,
} from "@anvil/types";
import { SEVERITY_LABELS } from "@/components/ui";
import { OrderedList } from "@/lib/richText";
import { SurvivalGauge } from "@/components/report/SurvivalGauge";
import { VerdictSection } from "@/components/report/VerdictSection";

afterEach(cleanup);

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
    {
      keyword: "해자 미확보",
      severity: "fatal",
      note: "진입점 선점 전에는 카피 방어가 약하다.",
    },
  ],
  conditions: ["6개월 내 팀 3곳 유료 전환", "실행 추적 리텐션 40% 이상"],
};

describe("SurvivalGauge", () => {
  it("role='meter'와 aria-value* 속성을 노출한다", () => {
    render(<SurvivalGauge score={55} recommendation="pivot" />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("55");
    expect(meter.getAttribute("aria-valuemin")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
  });

  it("data-recommendation은 prop을 그대로 반영한다", () => {
    for (const rec of RECOMMENDATIONS) {
      render(
        <SurvivalGauge
          score={RECOMMENDATION_SCORE_BANDS[rec].min}
          recommendation={rec}
        />,
      );
      expect(screen.getByRole("meter").getAttribute("data-recommendation")).toBe(
        rec,
      );
      cleanup();
    }
  });

  // 게이지 색은 recommendation prop이 아니라 점수 밴드에서 파생된다(UI_GUIDE).
  // recommendation을 고정해도 점수 경계에서 밴드가 바뀌는지로 경계 동작을 검증한다.
  it("점수 밴드 경계(0/39/40/69/70/100)에서 파생 밴드가 기대대로 바뀐다", () => {
    const cases: { score: number; band: string }[] = [
      { score: 0, band: "abandon" },
      { score: 39, band: "abandon" },
      { score: 40, band: "pivot" },
      { score: 69, band: "pivot" },
      { score: 70, band: "proceed" },
      { score: 100, band: "proceed" },
    ];
    for (const { score, band } of cases) {
      render(<SurvivalGauge score={score} recommendation="pivot" />);
      const meter = screen.getByRole("meter");
      expect(meter.getAttribute("data-score-band")).toBe(band);
      // prop은 고정("pivot")인데 밴드는 점수 따라 바뀐다 = 밴드가 점수 파생임을 증명
      expect(meter.getAttribute("data-recommendation")).toBe("pivot");
      expect(meter.getAttribute("data-survival-score")).toBe(String(score));
      cleanup();
    }
  });

  it("점수 0과 100에서 throw하지 않는다", () => {
    expect(() =>
      render(<SurvivalGauge score={0} recommendation="abandon" />),
    ).not.toThrow();
    cleanup();
    expect(() =>
      render(<SurvivalGauge score={100} recommendation="proceed" />),
    ).not.toThrow();
  });
});

describe("VerdictSection", () => {
  it("headline과 rationale을 렌더링한다", () => {
    render(<VerdictSection verdict={verdict} />);
    expect(screen.getByText(verdict.headline)).toBeDefined();
    expect(screen.getByText(verdict.rationale)).toBeDefined();
  });

  it("recommendation 3종 모두 RECOMMENDATION_LABELS의 한국어 라벨을 노출한다", () => {
    for (const rec of RECOMMENDATIONS) {
      render(
        <VerdictSection
          verdict={{
            ...verdict,
            recommendation: rec,
            survivalScore: RECOMMENDATION_SCORE_BANDS[rec].min,
          }}
        />,
      );
      expect(screen.getByText(RECOMMENDATION_LABELS[rec])).toBeDefined();
      cleanup();
    }
  });

  it("잔존 리스크의 keyword·severity 라벨을 노출하고 data-severity를 단다", () => {
    const { container } = render(<VerdictSection verdict={verdict} />);
    for (const risk of verdict.residualRisks) {
      expect(screen.getByText(risk.keyword)).toBeDefined();
      expect(
        container.querySelector(`[data-severity="${risk.severity}"]`),
      ).not.toBeNull();
    }
    expect(screen.getByText(SEVERITY_LABELS.major)).toBeDefined();
    expect(screen.getByText(SEVERITY_LABELS.fatal)).toBeDefined();
  });

  it("생존 조건을 번호 목록(<ol>)으로 렌더링한다", () => {
    const { container } = render(<VerdictSection verdict={verdict} />);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(container.querySelectorAll("ol > li").length).toBe(
      verdict.conditions.length,
    );
    expect(screen.getByText("6개월 내 팀 3곳 유료 전환")).toBeDefined();
  });

  // 생존 조건 목록은 공용 번호 목록 규격을 그대로 쓴다. 클래스를 손으로 복제하면
  // 合 섹션(renderRichText)과 간격이 갈려 한 리포트에 두 종류의 번호 목록이 생긴다.
  it("생존 조건 <ol>이 공용 번호 목록과 같은 규격을 쓴다", () => {
    const { container } = render(<VerdictSection verdict={verdict} />);
    const { container: shared } = render(<OrderedList items={["조건"]} />);

    expect(container.querySelector("ol")?.className).toBe(
      shared.querySelector("ol")?.className,
    );
  });

  it("생존 조건의 볼드 라벨을 본문과 다른 블록으로 분리한다", () => {
    const { container } = render(
      <VerdictSection
        verdict={{
          ...verdict,
          conditions: ["**리텐션:** 실행 추적 리텐션 40% 이상"],
        }}
      />,
    );

    const label = container.querySelector("ol > li")?.firstElementChild;
    expect(label?.tagName).toBe("STRONG");
    expect(label?.textContent).toBe("리텐션:");
    expect(label?.nextElementSibling?.tagName).toBe("DIV");
    expect(container.textContent).not.toContain("**");
  });

  it("SurvivalGauge를 최종 판정 점수와 함께 렌더링한다", () => {
    render(<VerdictSection verdict={verdict} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("55");
  });

  it("verdict가 없으면 최종 판정 이전 실행 안내 EmptyState를 보여주고 throw하지 않는다", () => {
    expect(() =>
      render(<VerdictSection verdict={undefined} />),
    ).not.toThrow();
    expect(screen.getByText(/최종 판정 단계 이전/)).toBeDefined();
  });

  it("id='verdict' 앵커(H2)가 존재하고 섹션이 aria-labelledby로 연결된다", () => {
    const { container } = render(<VerdictSection verdict={verdict} />);
    const anchor = container.querySelector("#verdict");
    expect(anchor?.tagName).toBe("H2");
    expect(container.querySelector("section")?.getAttribute("aria-labelledby")).toBe(
      "verdict",
    );
  });

  it("criticism.verdict(反 소결론)를 렌더링하지 않는다 (ADR-010, 최종 판정의 유일 소스는 verdict.json)", () => {
    // VerdictSection은 Verdict만 받는다 — 反 소결론을 섞지 않는다.
    const { container } = render(<VerdictSection verdict={verdict} />);
    expect(container.textContent).not.toContain("反의 소결론");
  });
});
