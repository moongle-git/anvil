export type StepVisualStatus =
  | "completed"
  | "running"
  | "error"
  | "waiting"
  | "pending";

const STATUS_LABELS: Record<StepVisualStatus, string> = {
  completed: "완료",
  running: "진행중",
  error: "실패",
  waiting: "답변 대기",
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
  if (status === "waiting") {
    // 답변 대기 — 물음표 원 (amber)
    return (
      <svg {...common} className="shrink-0 text-amber-600">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.7" />
        <path d="M12 16.5h.01" />
      </svg>
    );
  }
  return (
    <svg {...common} className="shrink-0 text-neutral-300">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
