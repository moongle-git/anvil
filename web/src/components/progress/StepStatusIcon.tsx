export type StepVisualStatus = "completed" | "running" | "error" | "pending";

const STATUS_LABELS: Record<StepVisualStatus, string> = {
  completed: "완료",
  running: "진행중",
  error: "실패",
  pending: "대기",
};

// 인라인 SVG(strokeWidth 1.5, 20px). 아이콘 컨테이너 없이 색으로 상태를 표현한다.
export function StepStatusIcon({ status }: { status: StepVisualStatus }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    role: "img",
    "aria-label": STATUS_LABELS[status],
  };

  if (status === "completed") {
    return (
      <svg {...common} className="shrink-0 text-green-600">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.5 2.5 4.5-5.5" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg {...common} className="shrink-0 text-red-600">
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6m0-6-6 6" />
      </svg>
    );
  }
  if (status === "running") {
    return (
      <svg {...common} className="shrink-0 animate-spin text-blue-700">
        <circle cx="12" cy="12" r="9" className="opacity-25" />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
    );
  }
  return (
    <svg {...common} className="shrink-0 text-neutral-300">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
