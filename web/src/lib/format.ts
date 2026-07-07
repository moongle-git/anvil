// 경과 시간(ms)을 "M분 S초"(1분 미만은 "S초")로. 음수는 0초로 클램프.
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}초` : `${minutes}분 ${seconds}초`;
}

// 실행 일시를 로컬(ko-KR) 포맷으로. 파싱 불가 시 원본을 그대로 반환한다.
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
