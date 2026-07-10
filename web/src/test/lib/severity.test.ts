import { describe, expect, it } from "vitest";
import type {
  Criticism,
  CriticismPoint,
  CriticismSeverity,
  DialecticAxis,
} from "@anvil/types";
import { countSeverities } from "@/lib/severity";

const SCORE_IN_BAND: Record<CriticismSeverity, number> = {
  fatal: 80,
  major: 50,
  minor: 20,
};

function point(
  id: string,
  axis: DialecticAxis,
  severity: CriticismSeverity,
): CriticismPoint {
  return {
    id,
    axis,
    claim: "주장",
    evidence: "근거",
    severity,
    riskScore: SCORE_IN_BAND[severity],
    riskKeyword: "키워드",
  };
}

describe("countSeverities", () => {
  it("points 전체를 순회해 severity별 개수를 센다", () => {
    const criticism: Criticism = {
      points: [
        point("c1", "painPoint", "fatal"),
        point("c2", "painPoint", "minor"),
        point("c3", "bm", "major"),
        point("c4", "bm", "major"),
        point("c5", "copycat", "fatal"),
        point("c6", "copycat", "minor"),
        point("c7", "copycat", "minor"),
      ],
      verdict: "판정",
    };

    expect(countSeverities(criticism)).toEqual({
      fatal: 2,
      major: 2,
      minor: 3,
    });
  });

  it("등장하지 않는 severity는 0으로 집계한다", () => {
    const criticism: Criticism = {
      points: [
        point("c1", "painPoint", "minor"),
        point("c2", "bm", "minor"),
        point("c3", "copycat", "minor"),
      ],
      verdict: "판정",
    };

    expect(countSeverities(criticism)).toEqual({ fatal: 0, major: 0, minor: 3 });
  });

  it("points가 비어도 throw하지 않는다", () => {
    expect(countSeverities({ points: [], verdict: "판정" })).toEqual({
      fatal: 0,
      major: 0,
      minor: 0,
    });
  });
});
