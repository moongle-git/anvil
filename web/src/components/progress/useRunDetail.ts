"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunDetail } from "@/lib/client/types";

export interface UseRunDetailResult {
  detail: RunDetail | null;
  isLoading: boolean;
  error: string;
  notFound: boolean;
  refresh: () => void;
}

interface DetailState {
  key: string;
  detail: RunDetail | null;
  error: string;
  notFound: boolean;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // 응답 본문이 JSON이 아니면 기본 문구를 쓴다.
  }
  return "run 정보를 불러오지 못했습니다.";
}

export function useRunDetail(
  runId: string,
  intervalMs = 2000,
): UseRunDetailResult {
  const [state, setState] = useState<DetailState>({
    key: "",
    detail: null,
    error: "",
    notFound: false,
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const requestKey = `${runId}\n${refreshToken}`;

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
          signal: controller.signal,
        });
        if (response.status === 404) {
          setState({ key: requestKey, detail: null, notFound: true, error: "" });
          window.clearInterval(timer);
          return;
        }
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        const body = (await response.json()) as RunDetail;
        setState({ key: requestKey, detail: body, notFound: false, error: "" });
        if (body.status === "completed") {
          window.clearInterval(timer);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            detail: null,
            notFound: false,
            error:
              loadError instanceof Error
                ? loadError.message
                : "run 정보를 불러오지 못했습니다.",
          });
        }
      }
    }

    const timer = window.setInterval(load, intervalMs);
    void load();

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [intervalMs, requestKey, runId]);

  const isCurrentResponse = state.key === requestKey;
  return {
    detail: isCurrentResponse ? state.detail : null,
    isLoading: !isCurrentResponse,
    error: isCurrentResponse ? state.error : "",
    notFound: isCurrentResponse ? state.notFound : false,
    refresh,
  };
}
