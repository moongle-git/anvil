import { describe, expect, it } from "vitest";
import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  type Criticism,
  type CriticismPoint,
  type DialecticAxis,
  type ThesisPoint,
} from "@anvil/types";
import { buildRiskProfile, groupPointsByAxis, indexById } from "@/lib/risk";

function point(
  id: string,
  axis: DialecticAxis,
  riskScore: number,
  riskKeyword: string,
): CriticismPoint {
  return {
    id,
    axis,
    claim: `주장 ${id}`,
    evidence: `근거 ${id}`,
    severity: riskScore >= 67 ? "fatal" : riskScore >= 34 ? "major" : "minor",
    riskScore,
    riskKeyword,
  };
}

function criticismOf(points: CriticismPoint[]): Criticism {
  return { points, verdict: "反의 소결론" };
}

describe("buildRiskProfile", () => {
  it("DIALECTIC_AXES 순서로 항상 3개 원소를 반환한다", () => {
    const profile = buildRiskProfile(
      criticismOf([
        point("c1", "copycat", 70, "플랫폼 흡수"),
        point("c2", "painPoint", 20, "약한 통증"),
        point("c3", "bm", 50, "가격 침식"),
      ]),
    );

    expect(profile.map((axisScore) => axisScore.axis)).toEqual([
      ...DIALECTIC_AXES,
    ]);
    expect(profile.map((axisScore) => axisScore.label)).toEqual(
      DIALECTIC_AXES.map((axis) => DIALECTIC_AXIS_LABELS[axis]),
    );
  });

  it("축 점수는 평균이 아니라 최댓값이다 — fatal 하나가 minor 셋에 희석되면 안 된다", () => {
    const profile = buildRiskProfile(
      criticismOf([
        point("c1", "bm", 30, "낮음"),
        point("c2", "bm", 90, "치명적 침식"),
        point("c3", "bm", 50, "중간"),
        point("c4", "painPoint", 10, "미미"),
        point("c5", "copycat", 10, "미미"),
      ]),
    );
    const bm = profile.find((axisScore) => axisScore.axis === "bm");

    expect(bm?.score).toBe(90);
    expect(bm?.keyword).toBe("치명적 침식");
  });

  it("동점이면 배열에서 먼저 나온 point의 keyword를 쓴다 (결정적 동작)", () => {
    const profile = buildRiskProfile(
      criticismOf([
        point("c1", "copycat", 80, "먼저"),
        point("c2", "copycat", 80, "나중"),
        point("c3", "painPoint", 10, "미미"),
        point("c4", "bm", 10, "미미"),
      ]),
    );

    expect(
      profile.find((axisScore) => axisScore.axis === "copycat")?.keyword,
    ).toBe("먼저");
  });

  it("point가 없는 축은 score 0 · keyword 빈 문자열이고 throw하지 않는다", () => {
    // CriticismSchema의 refine이 막지만, 구버전·손상 데이터가 들어올 수 있다
    const profile = buildRiskProfile(criticismOf([point("c1", "bm", 40, "가격")]));

    expect(() => buildRiskProfile(criticismOf([]))).not.toThrow();
    expect(profile.find((axisScore) => axisScore.axis === "painPoint")).toEqual({
      axis: "painPoint",
      label: DIALECTIC_AXIS_LABELS.painPoint,
      score: 0,
      keyword: "",
    });
    expect(profile.find((axisScore) => axisScore.axis === "copycat")?.score).toBe(
      0,
    );
  });

  it("같은 입력에 같은 출력을 낸다 (순수 함수)", () => {
    const criticism = criticismOf([
      point("c1", "painPoint", 55, "번들 흡수"),
      point("c2", "bm", 88, "가격 침식"),
      point("c3", "copycat", 82, "플랫폼 흡수"),
    ]);

    expect(buildRiskProfile(criticism)).toEqual(buildRiskProfile(criticism));
  });
});

describe("groupPointsByAxis", () => {
  it("세 축 키를 모두 갖고, 빈 축은 빈 배열이다", () => {
    const grouped = groupPointsByAxis([point("c1", "bm", 40, "가격")]);

    expect(Object.keys(grouped).sort()).toEqual([...DIALECTIC_AXES].sort());
    expect(grouped.bm.map((p) => p.id)).toEqual(["c1"]);
    expect(grouped.painPoint).toEqual([]);
    expect(grouped.copycat).toEqual([]);
  });

  it("같은 축의 point는 원래 순서를 유지한다", () => {
    const grouped = groupPointsByAxis([
      point("c1", "bm", 40, "첫째"),
      point("c2", "painPoint", 10, "다른 축"),
      point("c3", "bm", 90, "둘째"),
    ]);

    expect(grouped.bm.map((p) => p.id)).toEqual(["c1", "c3"]);
  });

  it("ThesisPoint에도 쓸 수 있다 (제네릭)", () => {
    const thesisPoints: ThesisPoint[] = [
      { id: "t1", axis: "painPoint", claim: "낙관", rationale: "근거" },
    ];
    const grouped = groupPointsByAxis(thesisPoints);

    expect(grouped.painPoint[0]?.rationale).toBe("근거");
    expect(grouped.bm).toEqual([]);
  });
});

describe("indexById", () => {
  it("id로 원소를 찾는다", () => {
    const thesisPoints: ThesisPoint[] = [
      { id: "t1", axis: "painPoint", claim: "낙관 1", rationale: "근거 1" },
      { id: "t2", axis: "bm", claim: "낙관 2", rationale: "근거 2" },
    ];

    expect(indexById(thesisPoints).get("t2")?.claim).toBe("낙관 2");
  });

  it("존재하지 않는 id는 undefined다 (끊어진 rebuts 참조)", () => {
    expect(indexById([{ id: "t1" }]).get("t999")).toBeUndefined();
    expect(indexById([]).get("t1")).toBeUndefined();
  });
});
