import { describe, expect, it } from "vitest";
import {
  axisLabelPositions,
  radarVertices,
  toPolygonPoints,
} from "@/lib/radar";

const SIZE = 200;
const CENTER = SIZE / 2;

describe("radarVertices", () => {
  it("첫 축은 12시 방향(중심 바로 위)에서 시작한다", () => {
    const [first] = radarVertices([100, 100, 100], SIZE);

    expect(first.x).toBe(CENTER); // 중심과 같은 x
    expect(first.y).toBeLessThan(CENTER); // 중심보다 위(값이 작을수록 위)
  });

  it("모든 값이 0이면 모든 꼭짓점이 중심 좌표다", () => {
    const vertices = radarVertices([0, 0, 0], SIZE);

    expect(vertices).toHaveLength(3);
    for (const vertex of vertices) {
      expect(vertex).toEqual({ x: CENTER, y: CENTER });
    }
  });

  it("음수와 maxValue 초과 값은 0~maxValue로 클램프된다", () => {
    // -50 → 0, 120 → 100. 같은 인덱스면 클램프된 값과 좌표가 같아야 한다.
    const clamped = radarVertices([0, 100, 50], SIZE);
    const outOfRange = radarVertices([-50, 120, 50], SIZE);

    expect(outOfRange).toEqual(clamped);
  });

  it("빈 배열은 빈 배열을 반환하고 throw하지 않는다", () => {
    expect(() => radarVertices([], SIZE)).not.toThrow();
    expect(radarVertices([], SIZE)).toEqual([]);
  });

  it("좌표는 소수점 2자리로 반올림된다 (결정적 출력)", () => {
    const vertices = radarVertices([30, 60, 90], SIZE);

    for (const { x, y } of vertices) {
      expect(x).toBe(Math.round(x * 100) / 100);
      expect(y).toBe(Math.round(y * 100) / 100);
    }
  });
});

describe("toPolygonPoints", () => {
  it("'x,y x,y ...' 형태의 문자열을 만든다", () => {
    expect(
      toPolygonPoints([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5, y: 6 },
      ]),
    ).toBe("1,2 3,4 5,6");
  });

  it("빈 정점 배열은 빈 문자열이다", () => {
    expect(toPolygonPoints([])).toBe("");
  });

  it("같은 입력에 항상 같은 문자열을 낸다 (결정성)", () => {
    const a = toPolygonPoints(radarVertices([30, 60, 90], SIZE));
    const b = toPolygonPoints(radarVertices([30, 60, 90], SIZE));

    expect(a).toBe(b);
    // 소수점 3자리 이상 부동소수 잔재가 없다
    expect(a).not.toMatch(/\d\.\d{3,}/);
  });
});

describe("axisLabelPositions", () => {
  it("축 개수만큼 좌표를 반환하고 첫 라벨은 중심 위쪽이다", () => {
    const positions = axisLabelPositions(3, SIZE);

    expect(positions).toHaveLength(3);
    expect(positions[0].x).toBe(CENTER);
    expect(positions[0].y).toBeLessThan(CENTER);
  });

  it("count가 0 이하면 빈 배열이다", () => {
    expect(axisLabelPositions(0, SIZE)).toEqual([]);
  });

  it("라벨은 데이터 폴리곤보다 바깥에 놓인다", () => {
    const [outerVertex] = radarVertices([100, 100, 100], SIZE);
    const [labelPos] = axisLabelPositions(3, SIZE);

    // 12시 방향에서 라벨 y가 데이터 정점 y보다 위(더 작다)여야 바깥이다
    expect(labelPos.y).toBeLessThan(outerVertex.y);
  });
});
