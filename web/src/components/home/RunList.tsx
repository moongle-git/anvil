"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RunDisplayStatus, RunSummary } from "@anvil/runStore";
import {
  Button,
  EmptyState,
  ErrorState,
  RUN_STATUS_LABELS,
  RunStatusBadge,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";

// 빈 상태에서 클릭 한 번으로 폼을 채우는 예시 아이디어
const EXAMPLE_IDEAS = [
  "회의 녹음을 자동으로 요약하고 할 일을 뽑아주는 서비스",
  "반려식물의 물주기·분갈이 시기를 알려주는 앱",
  "냉장고 속 재료로 오늘 점심 메뉴를 추천해주는 서비스",
];

// 필터 select에 노출할 상태 순서
const FILTER_STATUSES: RunDisplayStatus[] = [
  "completed",
  "running",
  "waiting",
  "stalled",
  "error",
];

const INPUT_CLASS =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none";

interface RunListProps {
  onPickExample: (idea: string) => void;
}

export function RunList({ onPickExample }: RunListProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState<"" | RunDisplayStatus>("");
  // null = 최초 로딩 미완료 (빈 배열과 구분해 온보딩 빈 상태 플래시를 막는다)
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 과도한 요청을 피하도록 검색어를 300ms 디바운스한다
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const params = new URLSearchParams();
  if (debouncedQuery.trim() !== "") {
    params.set("q", debouncedQuery.trim());
  }
  if (status !== "") {
    params.set("status", status);
  }
  const url = `/api/runs${params.toString() ? `?${params.toString()}` : ""}`;

  useEffect(() => {
    let ignore = false;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("실행 이력을 불러오지 못했습니다.");
        }
        const data = (await res.json()) as { runs: RunSummary[] };
        if (!ignore) {
          setRuns(data.runs);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(
            err instanceof Error ? err.message : "실행 이력을 불러오지 못했습니다.",
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [url, reloadKey]);

  function toggleSelect(runId: string) {
    setSelected((prev) => {
      if (prev.includes(runId)) {
        return prev.filter((id) => id !== runId);
      }
      // 2개 초과 선택 시 가장 오래된 선택을 해제한다
      return [...prev, runId].slice(-2);
    });
  }

  async function handleResume(runId: string) {
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      if (!res.ok) {
        throw new Error("이어서 실행에 실패했습니다.");
      }
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "이어서 실행에 실패했습니다.");
    }
  }

  const hasFilter = debouncedQuery.trim() !== "" || status !== "";
  const compareReady = selected.length === 2;

  // 최초 로딩이 실패하면 에러 카드 + 다시 시도
  if (runs === null && error !== null) {
    return (
      <ErrorState
        message={error}
        onRetry={() => {
          setError(null);
          setReloadKey((key) => key + 1);
        }}
      />
    );
  }

  // 최초 로딩 미완료: 온보딩/목록을 성급히 그리지 않는다
  if (runs === null) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">불러오는 중…</p>
    );
  }

  const loadedRuns = runs ?? [];

  // 실행 이력이 하나도 없는 최초 사용자 → 온보딩 빈 상태 (검색/필터 UI 없이)
  if (!error && loadedRuns.length === 0 && !hasFilter) {
    return (
      <EmptyState
        title="아직 실행된 컨설팅이 없습니다"
        description="아이디어를 입력해 첫 컨설팅을 시작해 보세요. 아래 예시로 시작해도 좋아요."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLE_IDEAS.map((example) => (
              <Button
                key={example}
                variant="secondary"
                onClick={() => onPickExample(example)}
              >
                {example}
              </Button>
            ))}
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="아이디어 검색"
          placeholder="아이디어 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={INPUT_CLASS}
        />
        <select
          aria-label="상태 필터"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as "" | RunDisplayStatus)
          }
          className={INPUT_CLASS}
        >
          <option value="">전체</option>
          {FILTER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {RUN_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <div className="ml-auto">
          <Button
            variant="secondary"
            disabled={!compareReady}
            onClick={() =>
              router.push(`/compare?a=${selected[0]}&b=${selected[1]}`)
            }
          >
            비교하기{selected.length > 0 ? ` (${selected.length}/2)` : ""}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {loadedRuns.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          조건에 맞는 실행 이력이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {loadedRuns.map((run) => {
            const resumable = run.status === "error" || run.status === "stalled";
            return (
              <li key={run.runId} className="flex items-center gap-4 py-4">
                {run.status === "completed" ? (
                  <input
                    type="checkbox"
                    aria-label={`${run.idea} 비교 선택`}
                    checked={selected.includes(run.runId)}
                    onChange={() => toggleSelect(run.runId)}
                    className="h-4 w-4 accent-neutral-900"
                  />
                ) : (
                  <span className="w-4" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/runs/${run.runId}`}
                    className="text-[15px] font-medium text-neutral-900 underline-offset-4 hover:underline"
                  >
                    {run.idea}
                  </Link>
                  <p className="mt-0.5 text-xs tabular-nums text-neutral-500">
                    {formatDateTime(run.createdAt)}
                  </p>
                </div>
                <RunStatusBadge status={run.status} />
                {resumable ? (
                  <Button
                    variant="secondary"
                    onClick={() => handleResume(run.runId)}
                  >
                    이어서 실행
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
