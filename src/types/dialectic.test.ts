import { describe, expect, it } from "vitest";
import {
  DIALECTIC_AXES,
  DIALECTIC_AXIS_LABELS,
  DialecticAxisSchema,
  SEVERITY_SCORE_BANDS,
  coversAllAxes,
  hasUniqueIds,
  isWithinBand,
  type CriticismSeverity,
} from "./dialectic.js";

describe("DialecticAxisSchema", () => {
  it.each([...DIALECTIC_AXES])("축 '%s'를 허용한다", (axis) => {
    expect(DialecticAxisSchema.parse(axis)).toBe(axis);
  });

  it("정의되지 않은 축을 거부한다", () => {
    expect(DialecticAxisSchema.safeParse("painPointReality").success).toBe(
      false,
    );
  });
});

describe("DIALECTIC_AXIS_LABELS", () => {
  it("모든 축에 한국어 라벨이 빠짐없이 대응한다", () => {
    for (const axis of DIALECTIC_AXES) {
      expect(DIALECTIC_AXIS_LABELS[axis]).toBeTruthy();
    }
    expect(Object.keys(DIALECTIC_AXIS_LABELS).sort()).toEqual(
      [...DIALECTIC_AXES].sort(),
    );
  });

  it("어느 한쪽 입장도 담지 않는 중립어를 쓴다 (正/反 공용 헤더)", () => {
    for (const label of Object.values(DIALECTIC_AXIS_LABELS)) {
      expect(label).not.toMatch(/허구성|취약성|리스크$/);
    }
  });
});

describe("SEVERITY_SCORE_BANDS", () => {
  const severities: CriticismSeverity[] = ["minor", "major", "fatal"];

  it("모든 severity에 점수 밴드가 빠짐없이 대응한다", () => {
    for (const severity of severities) {
      expect(SEVERITY_SCORE_BANDS[severity]).toBeDefined();
    }
    expect(Object.keys(SEVERITY_SCORE_BANDS).sort()).toEqual(
      [...severities].sort(),
    );
  });

  it("0~100을 빈틈·겹침 없이 분할한다", () => {
    expect(SEVERITY_SCORE_BANDS.minor.min).toBe(0);
    expect(SEVERITY_SCORE_BANDS.fatal.max).toBe(100);
    expect(SEVERITY_SCORE_BANDS.major.min).toBe(
      SEVERITY_SCORE_BANDS.minor.max + 1,
    );
    expect(SEVERITY_SCORE_BANDS.fatal.min).toBe(
      SEVERITY_SCORE_BANDS.major.max + 1,
    );
  });
});

describe("isWithinBand", () => {
  it("경계값을 포함한다", () => {
    expect(isWithinBand(34, SEVERITY_SCORE_BANDS.major)).toBe(true);
    expect(isWithinBand(66, SEVERITY_SCORE_BANDS.major)).toBe(true);
  });

  it("밴드를 벗어난 점수를 거부한다", () => {
    expect(isWithinBand(33, SEVERITY_SCORE_BANDS.major)).toBe(false);
    expect(isWithinBand(67, SEVERITY_SCORE_BANDS.major)).toBe(false);
  });
});

describe("coversAllAxes", () => {
  it("세 축을 모두 덮으면 true", () => {
    expect(
      coversAllAxes([
        { axis: "painPoint" },
        { axis: "bm" },
        { axis: "copycat" },
      ]),
    ).toBe(true);
  });

  it("한 축이라도 빠지면 false", () => {
    expect(coversAllAxes([{ axis: "painPoint" }, { axis: "bm" }])).toBe(false);
  });

  it("같은 축이 여러 개여도 나머지 축이 있으면 true", () => {
    expect(
      coversAllAxes([
        { axis: "painPoint" },
        { axis: "painPoint" },
        { axis: "bm" },
        { axis: "copycat" },
      ]),
    ).toBe(true);
  });

  it("빈 배열은 false", () => {
    expect(coversAllAxes([])).toBe(false);
  });
});

describe("hasUniqueIds", () => {
  it("id가 모두 고유하면 true", () => {
    expect(hasUniqueIds([{ id: "t1" }, { id: "t2" }])).toBe(true);
  });

  it("id가 중복되면 false", () => {
    expect(hasUniqueIds([{ id: "t1" }, { id: "t1" }])).toBe(false);
  });
});
