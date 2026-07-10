import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  type Criticism,
  type Thesis,
} from "@anvil/types";
import { DialecticSplit } from "@/components/report/DialecticSplit";
import { LEVER_BOLD_LEADIN } from "../richTextFixtures";

// vitest globals가 꺼져 있어 Testing Library auto-cleanup이 등록되지 않는다
afterEach(cleanup);

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
  growthLevers: [LEVER_BOLD_LEADIN, "캘린더 생태계 번들"],
  marketTailwinds: ["원격근무 확산", "AI 요약 수요 증가"],
  bestCaseScenario: "2년 내 팀 침투율 20% 달성 시 카테고리 리더.",
  winningThesis: "회의 데이터 진입점을 선점하면 실행 추적 시장을 장악한다.",
};

// c1(painPoint)은 유효한 rebuts(t1) + **볼드** claim, c3(copycat)은 끊어진 rebuts(t999)
const criticism: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      rebuts: "t1",
      claim: "**페인포인트**가 약하다",
      evidence: "무료 대안이 이미 넘쳐난다.",
      severity: "fatal",
      riskScore: 80,
      riskKeyword: "약한 통증",
    },
    {
      id: "c2",
      axis: "bm",
      rebuts: "t2",
      claim: "BM이 취약하다",
      evidence: "번들 흡수로 유료화 명분이 좁다.",
      severity: "major",
      riskScore: 50,
      riskKeyword: "가격 침식",
    },
    {
      id: "c3",
      axis: "copycat",
      rebuts: "t999",
      claim: "카피가 쉽다",
      evidence: "기술적 해자가 없다.",
      severity: "fatal",
      riskScore: 78,
      riskKeyword: "복제 용이",
    },
  ],
  verdict: "현재 구조로는 시장에서 살아남기 어렵다.",
};

describe("DialecticSplit", () => {
  it("세 축을 DIALECTIC_AXES 순서로 렌더링한다", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    const axisRows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-axis-row]"),
    ).map((el) => el.getAttribute("data-axis-row"));

    expect(axisRows).toEqual([...DIALECTIC_AXES]);
  });

  it("각 축 블록 안에는 자기 축의 point만 나온다 (bm 블록에 painPoint 없음)", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    const bmRow = container.querySelector<HTMLElement>(
      '[data-axis-row="bm"]',
    );
    const axes = Array.from(
      bmRow?.querySelectorAll<HTMLElement>("[data-axis]") ?? [],
    ).map((el) => el.getAttribute("data-axis"));

    expect(axes.length).toBeGreaterThan(0);
    expect(axes.every((axis) => axis === "bm")).toBe(true);
  });

  it("각 축 소제목은 DIALECTIC_AXIS_LABELS에서만 온다", () => {
    render(<DialecticSplit thesis={thesis} criticism={criticism} />);

    for (const axis of DIALECTIC_AXES) {
      expect(
        screen.getAllByText(DIALECTIC_AXIS_LABELS[axis]).length,
      ).toBeGreaterThan(0);
    }
  });

  it("rebuts가 유효한 id면 대응 thesis claim이 비판 카드 안에 나온다", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    const c1 = container.querySelector<HTMLElement>(
      '[data-criticism-id="c1"]',
    );
    expect(c1?.getAttribute("data-rebuts")).toBe("t1");
    expect(c1?.textContent).toContain("회의 정리 통증은 실재한다");
  });

  it("rebuts가 존재하지 않는 id(t999)를 가리켜도 throw하지 않고 반박 칩 없이 렌더링한다", () => {
    expect(() =>
      render(<DialecticSplit thesis={thesis} criticism={criticism} />),
    ).not.toThrow();

    const c3 = document.querySelector<HTMLElement>(
      '[data-criticism-id="c3"]',
    );
    // t3의 claim(회의 데이터 진입점…)은 존재하지만 t999는 없으므로 칩에 실리지 않는다
    expect(c3?.textContent).not.toContain("이 낙관을 반박");
    expect(c3?.textContent).not.toContain("회의 데이터 진입점이 해자가 된다");
  });

  it("thesis가 undefined여도 throw하지 않고 反만 렌더링하며 좌측은 빈 상태다", () => {
    expect(() =>
      render(<DialecticSplit thesis={undefined} criticism={criticism} />),
    ).not.toThrow();

    // 反 카드는 정상 렌더링
    expect(
      document.querySelector('[data-criticism-id="c1"]'),
    ).not.toBeNull();
    // 正 카드는 없다
    expect(document.querySelector("[data-thesis-id]")).toBeNull();
    // 좌측 컬럼 빈 상태 안내
    expect(screen.getByText("낙관 가설 데이터가 없습니다")).toBeDefined();
  });

  it("criticism이 undefined여도 throw하지 않고 좌측(正)만 렌더링한다", () => {
    expect(() =>
      render(<DialecticSplit thesis={thesis} criticism={undefined} />),
    ).not.toThrow();

    expect(document.querySelector('[data-thesis-id="t1"]')).not.toBeNull();
    expect(document.querySelector("[data-criticism-id]")).toBeNull();
    expect(screen.getByText("비판 데이터가 없습니다")).toBeDefined();
  });

  it("thesis·criticism 둘 다 없으면 섹션 전체를 빈 상태 하나로 대체한다", () => {
    render(<DialecticSplit thesis={undefined} criticism={undefined} />);

    expect(screen.getByText("정반합 데이터가 없습니다")).toBeDefined();
    expect(document.querySelector("[data-thesis-id]")).toBeNull();
    expect(document.querySelector("[data-criticism-id]")).toBeNull();
  });

  it("비판 카드가 RiskScoreBadge의 data-risk-score·data-risk-keyword를 노출한다", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    const c1 = container.querySelector<HTMLElement>(
      '[data-criticism-id="c1"]',
    );
    const badge = c1?.querySelector("[data-risk-score]");

    expect(badge?.getAttribute("data-risk-score")).toBe("80");
    expect(badge?.getAttribute("data-risk-keyword")).toBe("약한 통증");
  });

  it("evidence와 rationale은 기본으로 접혀 있고 클릭하면 열린다", () => {
    render(<DialecticSplit thesis={thesis} criticism={criticism} />);

    const summaries = screen.getAllByText("근거 보기");
    // 正 3개(rationale) + 反 3개(evidence)
    expect(summaries.length).toBe(6);

    const details = summaries[0].closest("details");
    expect(details?.open).toBe(false);

    fireEvent.click(summaries[0]);
    expect(details?.open).toBe(true);
  });

  it("**볼드** 마크다운이 화면에 ** 문자 그대로 노출되지 않는다 (renderInline 사용)", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    const c1 = container.querySelector<HTMLElement>(
      '[data-criticism-id="c1"]',
    );
    expect(c1?.textContent).not.toContain("**");
    expect(c1?.querySelector("strong")?.textContent).toBe("페인포인트");
  });

  it("id='thesis'와 id='antithesis' 앵커가 존재한다 (목차 네비 타겟)", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    expect(container.querySelector("#thesis")).not.toBeNull();
    expect(container.querySelector("#antithesis")).not.toBeNull();
  });

  it("컬럼 헤더가 <h2> 시맨틱을 갖고 섹션 aria-labelledby 연결이 유효하다", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    const thesisHeading = screen.getByRole("heading", {
      level: 2,
      name: "② 낙관적 가설 (正)",
    });
    const antithesisHeading = screen.getByRole("heading", {
      level: 2,
      name: "③ 냉정한 비판 (反)",
    });
    expect(thesisHeading.id).toBe("thesis");
    expect(antithesisHeading.id).toBe("antithesis");

    const section = container.querySelector("section#dialectic");
    const labelledby = section?.getAttribute("aria-labelledby")?.split(/\s+/);
    expect(labelledby).toContain("thesis");
    expect(labelledby).toContain("antithesis");
  });

  it("正의 서사 보강 아코디언 안의 볼드 리드인을 <strong>으로 렌더링한다 (** 노출 금지)", () => {
    const { container } = render(
      <DialecticSplit thesis={thesis} criticism={criticism} />,
    );

    // growthLevers 첫 항목이 **볼드 리드인:**으로 시작한다
    expect(container.querySelectorAll("li > strong").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("**");
  });
});
