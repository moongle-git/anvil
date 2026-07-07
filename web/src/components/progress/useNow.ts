"use client";

import { useEffect, useState } from "react";

// active인 동안 intervalMs마다 현재 시각(ms)을 갱신한다. 진행중 step의 경과 시간 표시용.
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}
