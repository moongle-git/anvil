import type { CriticismSeverity } from "@anvil/types";

// 한국어 라벨 매핑의 단일 소스 — 이후 step은 이 상수를 재사용한다
export const SEVERITY_LABELS: Record<CriticismSeverity, string> = {
  fatal: "치명적",
  major: "중대",
  minor: "경미",
};

// UI_GUIDE 시맨틱 색상: 옅은 배경 + 진한 텍스트로 문서 톤 유지
const SEVERITY_CLASSES: Record<CriticismSeverity, string> = {
  fatal: "border-red-200 bg-red-50 text-red-700",
  major: "border-amber-200 bg-amber-50 text-amber-700",
  minor: "border-gray-200 bg-gray-50 text-gray-600",
};

interface SeverityBadgeProps {
  severity: CriticismSeverity;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[severity]}`}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
