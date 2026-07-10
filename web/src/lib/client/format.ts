import type { Criticism, CriticismSeverity } from "./types";

export const SEVERITY_ORDER: CriticismSeverity[] = ["fatal", "major", "minor"];

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}초`;
  }
  return `${minutes}분 ${seconds.toString().padStart(2, "0")}초`;
}

export function summarizeSeverity(criticism?: Criticism): Record<CriticismSeverity, number> {
  const counts: Record<CriticismSeverity, number> = {
    fatal: 0,
    major: 0,
    minor: 0,
  };
  if (!criticism) {
    return counts;
  }

  for (const point of criticism.points) {
    counts[point.severity] += 1;
  }
  return counts;
}
