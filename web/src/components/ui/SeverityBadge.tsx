import type { CriticismSeverity } from "@anvil/types";
import { Badge, type BadgeTone } from "./Badge";

// 한국어 라벨 매핑의 단일 소스 — 이후 step은 이 상수를 재사용한다
export const SEVERITY_LABELS: Record<CriticismSeverity, string> = {
  fatal: "치명적",
  major: "중대",
  minor: "경미",
};

// severity → 시맨틱 톤. 색상 클래스가 아니라 "의미"를 매핑한다 (Badge가 톤을 색으로 변환).
const SEVERITY_TONES: Record<CriticismSeverity, BadgeTone> = {
  fatal: "danger",
  major: "warning",
  minor: "neutral",
};

interface SeverityBadgeProps {
  severity: CriticismSeverity;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <Badge tone={SEVERITY_TONES[severity]} data-severity={severity}>
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}
