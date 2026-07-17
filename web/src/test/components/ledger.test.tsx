import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REMEDY_STRATEGY_LABELS,
  REMEDY_VERDICT_LABELS,
  type Criticism,
  type Solution,
  type Verdict,
} from "@anvil/types";
import { SolutionSection } from "@/components/report/SolutionSection";
import { VerdictSection } from "@/components/report/VerdictSection";

afterEach(cleanup);

// fatal 2건(c1·c4) + major 1건(c3) + minor 1건(c2). 원장은 fatal만 싣는다 —
// 전건 커버리지를 강제받는 것이 fatal뿐이기 때문이다 (ADR-017).
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
  verdict: "현재 구조로는 살아남기 어렵다.",
};

const solution: Solution = {
  revisedConcept: "회의를 자동 관측해 실행을 추적한다.",
  minimalInput: "회의 링크만 제공한다.",
  agenticWorkflow: "관측 → 요약 → 액션 추출.",
  dataFlywheel: "수정 피드백이 품질을 높인다.",
  monetization: "팀 단위 구독.",
  synthesis: "실행 추적이 해자다.",
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

const verdict: Verdict = {
  survivalScore: 65,
  recommendation: "pivot",
  headline: "실행 추적으로 재편하면 생존 가능성이 열린다.",
  rationale: "핵심 가치를 옮기면 번들 흡수를 우회할 수 있다.",
  residualRisks: [
    {
      keyword: "번들 흡수",
      severity: "major",
      note: "대형 협업 도구가 요약을 번들로 흡수할 수 있다.",
    },
  ],
  conditions: ["6개월 내 팀 3곳 유료 전환"],
  remedyAudits: [
    {
      criticismId: "c1",
      assessment: "solid",
      note: "전장을 옮겨 비판이 성립하지 않게 만들었다.",
    },
    {
      criticismId: "c4",
      assessment: "restated",
      note: "플라이휠을 수식어만 붙여 다시 주장했다.",
    },
  ],
};

/** 원장 표의 본문 행 — data-criticism-id로 지목한다 */
function ledgerRows(): HTMLElement[] {
  const ledger = document.querySelector("[data-remedy-ledger]");
  return Array.from(
    ledger?.querySelectorAll<HTMLElement>("tbody tr[data-criticism-id]") ?? [],
  );
}

describe("결함↔해결책 원장 — 5절 (판정)", () => {
  it("원장 표와 요약 줄을 렌더링한다", () => {
    render(
      <VerdictSection
        verdict={verdict}
        criticism={criticism}
        solution={solution}
      />,
    );

    expect(screen.getByRole("heading", { name: "결함↔해결책 원장" })).toBeDefined();
    // 요약 숫자는 전부 원장에서 파생된다 — 따로 세면 표와 어긋나는 두 번째 진실이 생긴다
    expect(
      screen.getByText(
        `비판이 제기한 치명적 결함 2건 → 해결책 2건 (${REMEDY_VERDICT_LABELS.solid} 1 · ${REMEDY_VERDICT_LABELS.restated} 1)`,
      ),
    ).toBeDefined();

    const table = screen.getByRole("table");
    for (const header of ["비판", "재설계의 해결책", "판정의 감사"]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeDefined();
    }
  });

  it("fatal마다 비판·해결책·감사를 한 행으로 나란히 놓는다", () => {
    render(
      <VerdictSection
        verdict={verdict}
        criticism={criticism}
        solution={solution}
      />,
    );

    const rows = ledgerRows();
    expect(rows.map((row) => row.dataset.criticismId)).toEqual(["c1", "c4"]);

    const [first] = rows;
    expect(within(first).getByText("약한 통증")).toBeDefined();
    expect(
      within(first).getByText(REMEDY_STRATEGY_LABELS.bypass),
    ).toBeDefined();
    expect(
      within(first).getByText("요약이 아니라 실행 추적으로 전장을 옮긴다."),
    ).toBeDefined();
    // 감사 결과가 처음이자 유일하게 등장하는 곳이 5절이다
    expect(within(first).getByText(REMEDY_VERDICT_LABELS.solid)).toBeDefined();
    expect(
      within(first).getByText("전장을 옮겨 비판이 성립하지 않게 만들었다."),
    ).toBeDefined();
  });

  it("fatal이 아닌 비판(major·minor)은 원장에 오르지 않는다", () => {
    render(
      <VerdictSection
        verdict={verdict}
        criticism={criticism}
        solution={solution}
      />,
    );

    const ids = ledgerRows().map((row) => row.dataset.criticismId);
    expect(ids).not.toContain("c2");
    expect(ids).not.toContain("c3");
  });

  it("감사 라벨은 src/types를 단일 소스로 쓴다 (web에서 중복 정의하지 않는다)", () => {
    render(
      <VerdictSection
        verdict={{
          ...verdict,
          remedyAudits: [
            { criticismId: "c1", assessment: "solid", note: "유효하다." },
            { criticismId: "c4", assessment: "dismissed", note: "기각했다." },
          ],
        }}
        criticism={criticism}
        solution={solution}
      />,
    );

    const badges = document.querySelectorAll("[data-remedy-assessment]");
    expect(
      Array.from(badges).map((badge) => [
        badge.getAttribute("data-remedy-assessment"),
        badge.textContent,
      ]),
    ).toEqual([
      ["solid", REMEDY_VERDICT_LABELS.solid],
      ["dismissed", REMEDY_VERDICT_LABELS.dismissed],
    ]);
  });

  it("원장은 잔존 리스크보다 앞에 온다 (판정의 근거이지 부록이 아니다)", () => {
    const { container } = render(
      <VerdictSection
        verdict={verdict}
        criticism={criticism}
        solution={solution}
      />,
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("결함↔해결책 원장")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("결함↔해결책 원장")).toBeLessThan(
      text.indexOf("잔존 리스크"),
    );
    // rationale 뒤 — 판정의 논거를 읽은 다음에 그 근거를 본다
    expect(text.indexOf(verdict.rationale)).toBeLessThan(
      text.indexOf("결함↔해결책 원장"),
    );
  });

  it("재설계가 침묵한 fatal은 '해결책 없음'으로 표시된다", () => {
    render(
      <VerdictSection
        verdict={{
          ...verdict,
          remedyAudits: [
            {
              criticismId: "c1",
              assessment: "solid",
              note: "전장을 옮겼다.",
            },
          ],
        }}
        criticism={criticism}
        // c4에 대해 아무 말도 하지 않는다
        solution={{ ...solution, remedies: [solution.remedies[0]] }}
      />,
    );

    const rows = ledgerRows();
    expect(rows.map((row) => row.dataset.criticismId)).toEqual(["c1", "c4"]);
    expect(within(rows[1]).getByText("해결책 없음")).toBeDefined();
    // 침묵을 해결책으로 세지 않는다
    expect(
      screen.getByText(
        `비판이 제기한 치명적 결함 2건 → 해결책 1건 (${REMEDY_VERDICT_LABELS.solid} 1)`,
      ),
    ).toBeDefined();
  });

  it("remedyAudits가 비면 감사 열 없이 해결책만 보여준다", () => {
    render(
      <VerdictSection
        verdict={{ ...verdict, remedyAudits: [] }}
        criticism={criticism}
        solution={solution}
      />,
    );

    const table = screen.getByRole("table");
    // 전부 "—"인 열은 정보가 아니라 잡음이다
    expect(
      within(table).queryByRole("columnheader", { name: "판정의 감사" }),
    ).toBeNull();
    expect(
      within(table).getByRole("columnheader", { name: "재설계의 해결책" }),
    ).toBeDefined();
    expect(ledgerRows().length).toBe(2);
  });

  it("원장이 없는 구 run은 블록을 통째로 생략한다 (빈 표가 아니다)", () => {
    render(
      <VerdictSection
        verdict={{ ...verdict, remedyAudits: [] }}
        criticism={criticism}
        solution={{ ...solution, remedies: [] }}
      />,
    );

    expect(document.querySelector("[data-remedy-ledger]")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/치명적 결함/)).toBeNull();
    // 나머지 판정은 정상 렌더링된다
    expect(screen.getByText("잔존 리스크")).toBeDefined();
  });

  it("criticism이 없는 구 run에서도 판정은 정상 렌더링된다", () => {
    render(<VerdictSection verdict={verdict} solution={solution} />);

    expect(document.querySelector("[data-remedy-ledger]")).toBeNull();
    expect(screen.getByText("잔존 리스크")).toBeDefined();
  });

  it("criticism에 없는 id를 참조해도 throw하지 않고 조용히 드롭한다", () => {
    expect(() =>
      render(
        <VerdictSection
          verdict={{
            ...verdict,
            remedyAudits: [
              { criticismId: "c99", assessment: "solid", note: "유령 감사" },
            ],
          }}
          criticism={criticism}
          solution={{
            ...solution,
            remedies: [
              {
                respondsTo: "c99",
                strategy: "defend",
                remedy: "유령 해결책",
              },
            ],
          }}
        />,
      ),
    ).not.toThrow();

    // 렌더링은 검증기가 아니다 — 유령 참조는 드롭되고 fatal 2건은 침묵으로 남는다
    expect(screen.queryByText("유령 해결책")).toBeNull();
    expect(screen.queryByText("유령 감사")).toBeNull();
    expect(ledgerRows().map((row) => row.dataset.criticismId)).toEqual([
      "c1",
      "c4",
    ]);
  });
});

describe("결함↔해결책 원장 — 4절 (재설계)", () => {
  it("해결책을 전략 라벨과 함께 렌더링한다", () => {
    render(<SolutionSection solution={solution} criticism={criticism} />);

    expect(
      screen.getByRole("heading", {
        name: "치명적 결함에 대한 해결책 (재설계의 주장 · 미검증)",
      }),
    ).toBeDefined();

    const claims = document.querySelector("[data-remedy-claims]");
    const items = Array.from(
      claims?.querySelectorAll<HTMLElement>("li[data-criticism-id]") ?? [],
    );
    expect(items.map((item) => item.dataset.criticismId)).toEqual(["c1", "c4"]);
    expect(within(items[0]).getByText(REMEDY_STRATEGY_LABELS.bypass)).toBeDefined();
    expect(
      within(items[0]).getByText("요약이 아니라 실행 추적으로 전장을 옮긴다."),
    ).toBeDefined();
  });

  // ★ ADR-008의 안전벨트. 감사 결과가 4절에 뜨면 독자가 5절 전에 결론을 알게 되고,
  // 그 순간 正/反 대립은 읽을 이유가 없는 장식이 된다.
  it("감사 결과를 렌더링하지 않는다 (결론 누설 금지)", () => {
    const { container } = render(
      <SolutionSection solution={solution} criticism={criticism} />,
    );
    const text = container.textContent ?? "";

    for (const label of Object.values(REMEDY_VERDICT_LABELS)) {
      expect(text).not.toContain(label);
    }
    for (const audit of verdict.remedyAudits) {
      expect(text).not.toContain(audit.note);
    }
    expect(container.querySelector("[data-remedy-assessment]")).toBeNull();
    // 점수·권고 같은 다른 결론도 새지 않는다
    expect(text).not.toContain(String(verdict.survivalScore));
    expect(text).not.toContain(verdict.headline);
  });

  it("해결책이 자기보고임을 밝히고 감사는 5절로 미룬다", () => {
    const { container } = render(
      <SolutionSection solution={solution} criticism={criticism} />,
    );
    const text = container.textContent ?? "";

    expect(text).toContain("검증된 사실이 아닙니다");
    expect(text).toContain("5절 최종 판정이 항목별로 감사합니다");
  });

  it("침묵한 fatal은 실패로 낙인찍지 않고 사실만 적는다", () => {
    render(
      <SolutionSection
        solution={{ ...solution, remedies: [solution.remedies[0]] }}
        criticism={criticism}
      />,
    );

    const item = document.querySelector<HTMLElement>(
      "[data-remedy-claims] li[data-criticism-id='c4']",
    );
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText("해결책 없음")).toBeDefined();
    expect(item?.textContent).toContain(
      "재설계는 이 결함에 대해 아무 말도 하지 않았습니다.",
    );
  });

  it("원장이 없는 구 run은 블록을 통째로 생략한다 (빈 표가 아니다)", () => {
    const { container } = render(
      <SolutionSection
        solution={{ ...solution, remedies: [] }}
        criticism={criticism}
      />,
    );

    expect(container.querySelector("[data-remedy-claims]")).toBeNull();
    expect(container.textContent).not.toContain("해결책 없음");
    // 나머지 재설계는 정상 렌더링된다
    expect(screen.getByText("재설계된 컨셉")).toBeDefined();
  });

  it("criticism이 없는 구 run에서도 재설계는 정상 렌더링된다", () => {
    const { container } = render(<SolutionSection solution={solution} />);

    expect(container.querySelector("[data-remedy-claims]")).toBeNull();
    expect(screen.getByText("재설계된 컨셉")).toBeDefined();
  });

  it("criticism에 없는 id를 참조해도 throw하지 않고 조용히 드롭한다", () => {
    expect(() =>
      render(
        <SolutionSection
          solution={{
            ...solution,
            remedies: [
              { respondsTo: "c99", strategy: "defend", remedy: "유령 해결책" },
            ],
          }}
          criticism={criticism}
        />,
      ),
    ).not.toThrow();

    expect(screen.queryByText("유령 해결책")).toBeNull();
  });
});
