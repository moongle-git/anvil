"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RunDisplayStatus, RunSummary } from "@/lib/client/types";
import { formatDateTime } from "@/lib/client/format";
import {
  Button,
  Card,
  EmptyState,
  RUN_STATUS_LABELS,
  RunStatusBadge,
  TextAreaField,
} from "@/components/ui";

type StatusFilter = RunDisplayStatus | "";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "", label: "전체" },
  { value: "completed", label: RUN_STATUS_LABELS.completed },
  { value: "running", label: RUN_STATUS_LABELS.running },
  { value: "stalled", label: RUN_STATUS_LABELS.stalled },
  { value: "error", label: RUN_STATUS_LABELS.error },
];

const EXAMPLE_IDEAS = [
  "AI 회의록 요약 및 액션아이템 자동 추적 서비스",
  "동네 상권을 위한 재고 예측 SaaS",
  "개인 지식 관리를 대신 정리하는 에이전트",
];

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // 응답 본문이 JSON이 아니면 아래 기본 문구를 쓴다.
  }
  return "요청을 처리하지 못했습니다.";
}

export function HomePage() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [runsError, setRunsError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const trimmedIdea = idea.trim();
  const hasFilters = query.trim() !== "" || status !== "";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (query !== "") {
      params.set("q", query);
    }
    if (status !== "") {
      params.set("status", status);
    }

    async function loadRuns() {
      setIsLoadingRuns(true);
      setRunsError("");
      try {
        const suffix = params.toString();
        const response = await fetch(`/api/runs${suffix ? `?${suffix}` : ""}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await readError(response));
        }
        const body = (await response.json()) as { runs: RunSummary[] };
        setRuns(body.runs);
      } catch (error) {
        if (!controller.signal.aborted) {
          setRunsError(error instanceof Error ? error.message : "run 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingRuns(false);
        }
      }
    }

    loadRuns();
    return () => controller.abort();
  }, [query, status]);

  const completedIds = useMemo(
    () => new Set(runs.filter((run) => run.status === "completed").map((run) => run.runId)),
    [runs],
  );
  const compareSelectedIds = useMemo(
    () => selectedIds.filter((id) => completedIds.has(id)),
    [completedIds, selectedIds],
  );

  async function submitIdea(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (trimmedIdea === "" || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idea: trimmedIdea }),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const body = (await response.json()) as { runId: string };
      router.push(`/runs/${body.runId}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "컨설팅을 시작하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resumeRun(runId: string) {
    setResumingId(runId);
    setRunsError("");
    try {
      const response = await fetch(`/api/runs/${runId}/resume`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      router.push(`/runs/${runId}`);
    } catch (error) {
      setRunsError(error instanceof Error ? error.message : "실행을 재개하지 못했습니다.");
    } finally {
      setResumingId(null);
    }
  }

  function toggleCompare(runId: string) {
    setSelectedIds((current) => {
      const visibleCurrent = current.filter((id) => completedIds.has(id));
      if (visibleCurrent.includes(runId)) {
        return visibleCurrent.filter((id) => id !== runId);
      }
      if (visibleCurrent.length >= 2) {
        return visibleCurrent;
      }
      return [...visibleCurrent, runId];
    });
  }

  function moveToCompare() {
    if (compareSelectedIds.length !== 2) {
      return;
    }
    router.push(`/compare?a=${encodeURIComponent(compareSelectedIds[0])}&b=${encodeURIComponent(compareSelectedIds[1])}`);
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
            새 컨설팅 시작
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-neutral-500">
            검증하고 싶은 AI 서비스 아이디어를 입력하세요.
          </p>
        </div>
        <Card>
          <form className="space-y-4" onSubmit={submitIdea}>
            <TextAreaField
              label="아이디어"
              rows={5}
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              placeholder="예: 회의 후 액션아이템을 자동으로 추적하는 AI 에이전트"
            />
            {submitError ? (
              <p className="text-sm text-red-700" role="alert">
                {submitError}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={trimmedIdea === "" || isSubmitting}>
                {isSubmitting ? "시작 중" : "컨설팅 시작"}
              </Button>
              {EXAMPLE_IDEAS.map((example) => (
                <Button
                  key={example}
                  type="button"
                  variant="text"
                  onClick={() => setIdea(example)}
                >
                  {example}
                </Button>
              ))}
            </div>
          </form>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-neutral-900">run 이력</h2>
          </div>
          <Button
            variant="secondary"
            onClick={moveToCompare}
            disabled={compareSelectedIds.length !== 2}
          >
            비교하기
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-500">
            아이디어 검색
            <input
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="키워드"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-500">
            상태
            <select
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-[15px] text-neutral-900 focus:border-neutral-900 focus:outline-none"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {runsError ? (
          <p className="text-sm text-red-700" role="alert">
            {runsError}
          </p>
        ) : null}

        {isLoadingRuns ? (
          <p className="text-sm text-neutral-500">run 목록을 불러오는 중입니다.</p>
        ) : runs.length === 0 ? (
          <EmptyState
            title={hasFilters ? "조건에 맞는 run이 없습니다" : "아직 실행된 컨설팅이 없습니다"}
            description={
              hasFilters
                ? "검색어 또는 상태 필터를 조정해 보세요."
                : "아이디어를 입력해 첫 컨설팅을 시작해 보세요."
            }
            action={
              hasFilters ? null : (
                <div className="flex flex-wrap justify-center gap-2">
                  {EXAMPLE_IDEAS.slice(0, 3).map((example) => (
                    <Button key={example} variant="secondary" onClick={() => setIdea(example)}>
                      {example}
                    </Button>
                  ))}
                </div>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto border-y border-neutral-200">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="text-xs font-medium text-neutral-500">
                <tr className="border-b border-neutral-200">
                  <th className="w-16 px-3 py-3">비교</th>
                  <th className="px-3 py-3">아이디어</th>
                  <th className="w-44 px-3 py-3">실행 일시</th>
                  <th className="w-28 px-3 py-3">상태</th>
                  <th className="w-28 px-3 py-3">동작</th>
                </tr>
              </thead>
              <tbody className="text-[15px]">
                {runs.map((run) => {
                  const canCompare = run.status === "completed";
                  const canResume = run.status === "error" || run.status === "stalled";
                  return (
                    <tr key={run.runId} className="border-b border-neutral-100 last:border-b-0">
                      <td className="px-3 py-4">
                        {canCompare ? (
                          <input
                            aria-label={`${run.idea} 비교 선택`}
                            type="checkbox"
                            checked={compareSelectedIds.includes(run.runId)}
                            onChange={() => toggleCompare(run.runId)}
                          />
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <Link
                          href={`/runs/${run.runId}`}
                          className="font-medium text-neutral-900 underline-offset-4 hover:underline"
                        >
                          {run.idea}
                        </Link>
                      </td>
                      <td className="px-3 py-4 text-xs tabular-nums text-neutral-500">
                        {formatDateTime(run.createdAt)}
                      </td>
                      <td className="px-3 py-4">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="px-3 py-4">
                        {canResume ? (
                          <Button
                            variant="secondary"
                            onClick={() => resumeRun(run.runId)}
                            disabled={resumingId === run.runId}
                          >
                            이어서 실행
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
