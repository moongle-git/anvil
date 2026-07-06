import type { RunDisplayStatus } from "@anvil/runStore";

// 한국어 라벨 매핑의 단일 소스 — 이후 step은 이 상수를 재사용한다
export const RUN_STATUS_LABELS: Record<RunDisplayStatus, string> = {
  completed: "완료",
  error: "실패",
  running: "진행중",
  stalled: "중단됨",
};

// UI_GUIDE 시맨틱 색상: 완료 green-600 / 실패 red-600 / 진행중 blue-700 / 중단 중립 gray
const STATUS_CLASSES: Record<RunDisplayStatus, string> = {
  completed: "border-green-200 bg-green-50 text-green-700",
  error: "border-red-200 bg-red-50 text-red-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  stalled: "border-gray-200 bg-gray-50 text-gray-600",
};

interface RunStatusBadgeProps {
  status: RunDisplayStatus;
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}
