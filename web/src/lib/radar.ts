export interface Point2D {
  x: number;
  y: number;
}

// 라벨을 놓을 여백(px). 최대 데이터 반지름은 size/2에서 이 값을 뺀 값이다.
const LABEL_MARGIN = 28;
// 라벨은 바깥 격자 링보다 조금 밖에 놓는다 (최대 반지름 * 이 배율).
const LABEL_OFFSET = 1.12;
const DEFAULT_MAX_VALUE = 100;

function maxRadius(size: number): number {
  return Math.max(0, size / 2 - LABEL_MARGIN);
}

// SVG 출력이 결정적이도록 소수점 2자리로 반올림한다. -0은 0으로 정규화한다.
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

// 첫 축은 12시(-90°)에서 시작해 시계방향으로 돈다. SVG는 y가 아래로 커진다.
function polar(
  center: number,
  radius: number,
  index: number,
  count: number,
): Point2D {
  const angle = ((-90 + (360 / count) * index) * Math.PI) / 180;
  return {
    x: round2(center + radius * Math.cos(angle)),
    y: round2(center + radius * Math.sin(angle)),
  };
}

/**
 * n각형 레이더의 꼭짓점 좌표. 첫 축은 12시 방향(-90°)에서 시작해 시계방향으로 돈다.
 * @param values 0~maxValue 점수 배열
 * @param size   SVG viewBox 한 변의 길이
 * @param maxValue 척도의 최댓값 (기본 100)
 */
export function radarVertices(
  values: readonly number[],
  size: number,
  maxValue: number = DEFAULT_MAX_VALUE,
): Point2D[] {
  if (values.length === 0) return [];

  const center = size / 2;
  const radius = maxRadius(size);
  const count = values.length;

  return values.map((raw, index) => {
    // 음수·maxValue 초과는 클램프한다. 0이면 중심점이 된다.
    const clamped = Math.min(maxValue, Math.max(0, raw));
    const ratio = maxValue === 0 ? 0 : clamped / maxValue;
    return polar(center, radius * ratio, index, count);
  });
}

/** SVG polygon의 points 속성 문자열 ("x1,y1 x2,y2 …") */
export function toPolygonPoints(vertices: readonly Point2D[]): string {
  return vertices.map((vertex) => `${vertex.x},${vertex.y}`).join(" ");
}

/** 축 라벨을 놓을 바깥쪽 좌표 (최대 반지름 * labelOffset) */
export function axisLabelPositions(count: number, size: number): Point2D[] {
  if (count <= 0) return [];

  const center = size / 2;
  const radius = maxRadius(size) * LABEL_OFFSET;
  const positions: Point2D[] = [];
  for (let index = 0; index < count; index += 1) {
    positions.push(polar(center, radius, index, count));
  }
  return positions;
}
