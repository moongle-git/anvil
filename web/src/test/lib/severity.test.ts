import { describe, expect, it } from "vitest";
import type { Criticism, CriticismPoint, CriticismSeverity } from "@anvil/types";
import { countSeverities } from "@/lib/severity";

function point(severity: CriticismSeverity): CriticismPoint {
  return { claim: "주장", evidence: "근거", severity };
}

describe("countSeverities", () => {
  it("3축 전체를 합산해 severity별 개수를 센다", () => {
    const criticism: Criticism = {
      painPointReality: [point("fatal"), point("minor")],
      bmWeakness: [point("major"), point("major")],
      copycatRisk: [point("fatal"), point("minor"), point("minor")],
      verdict: "판정",
    };
    expect(countSeverities(criticism)).toEqual({
      fatal: 2,
      major: 2,
      minor: 3,
    });
  });

  it("한 축에만 항목이 있어도 나머지는 0으로 집계한다", () => {
    const criticism: Criticism = {
      painPointReality: [point("minor")],
      bmWeakness: [point("minor")],
      copycatRisk: [point("minor")],
      verdict: "판정",
    };
    expect(countSeverities(criticism)).toEqual({ fatal: 0, major: 0, minor: 3 });
  });
});
