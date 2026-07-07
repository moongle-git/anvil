"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunDetail } from "@/lib/server/runs";

export interface UseRunDetailResult {
  detail: RunDetail | null;
  notFound: boolean;
  error: string | null;
  restart: () => void;
}

// GET /api/runs/{id}를 주기 폴링한다 (ADR-007: SSE/WebSocket 대신 폴링).
// running일 때만 다음 폴링을 예약하고, completed/error/stalled·404면 멈춘다.
// restart()는 resume 후 폴링을 다시 시작하는 데 쓴다.
export function useRunDetail(
  runId: string,
  intervalMs = 2000,
): UseRunDetailResult {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const restart = useCallback(() => {
    setNotFound(false);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      let res: Response;
      try {
        res = await fetch(`/api/runs/${runId}`);
      } catch {
        if (cancelled) return;
        setError("진행 상태를 불러오지 못했습니다.");
        timer = setTimeout(poll, intervalMs);
        return;
      }
      if (cancelled) return;

      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        setError("진행 상태를 불러오지 못했습니다.");
        timer = setTimeout(poll, intervalMs);
        return;
      }

      const data = (await res.json()) as RunDetail;
      if (cancelled) return;
      setDetail(data);
      setError(null);
      // 실행 중일 때만 계속 폴링한다 (completed/error/stalled는 사용자 액션 대기).
      if (data.status === "running") {
        timer = setTimeout(poll, intervalMs);
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [runId, intervalMs, nonce]);

  return { detail, notFound, error, restart };
}
