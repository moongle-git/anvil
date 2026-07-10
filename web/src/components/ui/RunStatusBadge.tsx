import type { RunDisplayStatus } from "@anvil/runStore";
import { Badge, type BadgeTone } from "./Badge";

// 한국어 라벨 매핑의 단일 소스 — 이후 step은 이 상수를 재사용한다
export const RUN_STATUS_LABELS: Record<RunDisplayStatus, string> = {
  completed: "완료",
  error: "실패",
  waiting: "답변 대기",
  running: "진행중",
  stalled: "중단됨",
};

// run 상태 → 시맨틱 톤 (완료=success / 실패=danger / 답변 대기=warning / 진행중=info / 중단=neutral)
const STATUS_TONES: Record<RunDisplayStatus, BadgeTone> = {
  completed: "success",
  error: "danger",
  waiting: "warning",
  running: "info",
  stalled: "neutral",
};

interface RunStatusBadgeProps {
  status: RunDisplayStatus;
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  return (
    <Badge tone={STATUS_TONES[status]} data-status={status}>
      {RUN_STATUS_LABELS[status]}
    </Badge>
  );
}
