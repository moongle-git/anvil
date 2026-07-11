import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DIALECTIC_AXIS_LABELS, type CriticismSeverity } from "@anvil/types";
import { SEVERITY_LABELS } from "@/components/ui";
import { RiskRadar } from "@/components/report/RiskRadar";
import { RiskScoreBadge } from "@/components/report/RiskScoreBadge";
import type { RiskAxisScore } from "@/lib/risk";

// vitest globals가 꺼져 있어 Testing Library auto-cleanup이 등록되지 않는다
afterEach(cleanup);

const ALL_SEVERITIES: CriticismSeverity[] = ["fatal", "major", "minor"];

const PROFILE: RiskAxisScore[] = [
  { axis: "painPoint", label: DIALECTIC_AXIS_LABELS.painPoint, score: 45, keyword: "약한 통증" },
  { axis: "bm", label: DIALECTIC_AXIS_LABELS.bm, score: 88, keyword: "가격 침식" },
  { axis: "copycat", label: DIALECTIC_AXIS_LABELS.copycat, score: 70, keyword: "플랫폼 흡수" },
];

describe("RiskRadar", () => {
  it("profile의 축 개수만큼 data-axis 요소를 렌더링한다", () => {
    const { container } = render(
      <RiskRadar profile={PROFILE} maxSeverity="fatal" />,
    );

    expect(container.querySelectorAll("[data-axis]")).toHaveLength(
      PROFILE.length,
    );
    // 각 축이 정확히 한 번씩 노출된다
    for (const { axis } of PROFILE) {
      expect(container.querySelectorAll(`[data-axis="${axis}"]`)).toHaveLength(1);
    }
  });

  it("루트의 data-max-severity가 prop과 일치한다", () => {
    render(<RiskRadar profile={PROFILE} maxSeverity="major" />);

    expect(
      document
        .querySelector("[data-max-severity]")
        ?.getAttribute("data-max-severity"),
    ).toBe("major");
  });

  it("role='img'와 축 이름을 포함한 aria-label을 제공한다", () => {
    render(<RiskRadar profile={PROFILE} maxSeverity="fatal" />);

    const chart = screen.getByRole("img");
    const ariaLabel = chart.getAttribute("aria-label") ?? "";
    for (const { label } of PROFILE) {
      expect(ariaLabel).toContain(label);
    }
  });

  it("sr-only 목록에 세 축의 라벨과 점수가 모두 텍스트로 존재한다 (스크린리더 접근성)", () => {
    render(<RiskRadar profile={PROFILE} maxSeverity="fatal" />);

    const list = screen.getByRole("list", { name: "축별 리스크 점수" });
    for (const { label, score } of PROFILE) {
      expect(list.textContent).toContain(label);
      expect(list.textContent).toContain(String(score));
    }
  });

  it("figure 카드로 감싸고 '축별 최고 위험도' 캡션을 노출한다", () => {
    render(<RiskRadar profile={PROFILE} maxSeverity="fatal" />);

    const figure = screen.getByRole("figure");
    expect(figure.querySelector("figcaption")?.textContent).toBe(
      "축별 최고 위험도",
    );
  });

  it("img role은 SVG 하나뿐이다 — figure가 img role을 중복 부여하지 않는다", () => {
    render(<RiskRadar profile={PROFILE} maxSeverity="fatal" />);

    // getByRole은 단수 조회다: figure에 role='img'가 붙으면 여기서 깨진다
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img").tagName.toLowerCase()).toBe("svg");
  });

  it("figcaption을 추가해도 [data-axis]는 SVG 축 라벨 3개뿐이다", () => {
    const { container } = render(
      <RiskRadar profile={PROFILE} maxSeverity="fatal" />,
    );

    const axisNodes = container.querySelectorAll("[data-axis]");
    expect(axisNodes).toHaveLength(3);
    for (const node of axisNodes) {
      expect(node.tagName.toLowerCase()).toBe("text");
    }
  });

  it("모든 점수가 0이어도 throw하지 않고 렌더링된다", () => {
    const zeroed: RiskAxisScore[] = PROFILE.map((axisScore) => ({
      ...axisScore,
      score: 0,
      keyword: "",
    }));

    expect(() =>
      render(<RiskRadar profile={zeroed} maxSeverity="minor" />),
    ).not.toThrow();
    expect(screen.getByRole("img")).toBeDefined();
  });
});

describe("RiskScoreBadge", () => {
  it("severity 한국어 라벨·{score}/100·keyword를 모두 노출한다", () => {
    render(<RiskScoreBadge severity="fatal" score={88} keyword="가격 침식" />);

    expect(screen.getByText(SEVERITY_LABELS.fatal)).toBeDefined();
    expect(screen.getByText("88/100")).toBeDefined();
    expect(screen.getByText("가격 침식")).toBeDefined();
  });

  it("키워드는 severity 뱃지 바깥에 분리 노출된다", () => {
    render(<RiskScoreBadge severity="major" score={55} keyword="번들 흡수" />);

    // 뱃지(severity 라벨) 안에 키워드가 들어가지 않는다
    const badge = document.querySelector('[data-severity="major"]');
    expect(badge?.textContent).not.toContain("번들 흡수");
    expect(screen.getByText("번들 흡수")).toBeDefined();
  });

  it("data-risk-score·data-risk-keyword가 prop과 일치한다", () => {
    const { container } = render(
      <RiskScoreBadge severity="major" score={55} keyword="번들 흡수" />,
    );
    const root = container.querySelector("[data-risk-score]");

    expect(root?.getAttribute("data-risk-score")).toBe("55");
    expect(root?.getAttribute("data-risk-keyword")).toBe("번들 흡수");
  });

  it("severity 3종 모두에 대해 렌더링이 성공한다 (exhaustive)", () => {
    for (const severity of ALL_SEVERITIES) {
      expect(() =>
        render(<RiskScoreBadge severity={severity} score={40} keyword="키워드" />),
      ).not.toThrow();
      expect(screen.getByText(SEVERITY_LABELS[severity])).toBeDefined();
      cleanup();
    }
  });
});
