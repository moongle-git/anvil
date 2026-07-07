"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDateTime, SEVERITY_ORDER, summarizeSeverity } from "@/lib/client/format";
import type { RunDetail } from "@/lib/client/types";
import { Card, EmptyState, SEVERITY_LABELS } from "@/components/ui";

interface ComparePageProps {
  runA?: string;
  runB?: string;
}

interface CompareState {
  key: string;
  a: RunDetail | null;
  b: RunDetail | null;
  error: string;
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

async function fetchRun(runId: string, signal: AbortSignal): Promise<RunDetail> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { signal });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as RunDetail;
}

function SeveritySummary({ detail }: { detail: RunDetail }) {
  const counts = summarizeSeverity(detail.criticism);
  return (
    <div className="flex flex-wrap gap-2">
      {SEVERITY_ORDER.map((severity) => (
        <span
          key={severity}
          className="inline-flex rounded-sm border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-medium text-neutral-700"
        >
          {SEVERITY_LABELS[severity]} {counts[severity]}
        </span>
      ))}
    </div>
  );
}

function CompareCell({ detail, children }: { detail: RunDetail; children: React.ReactNode }) {
  return (
    <Card className="min-h-full p-5">
      <h3 className="mb-3 text-sm font-medium text-neutral-500">
        {detail.context?.ideaTitle ?? detail.state.idea}
      </h3>
      {children}
    </Card>
  );
}

function CompareRow({
  label,
  a,
  b,
  render,
}: {
  label: string;
  a: RunDetail;
  b: RunDetail;
  render: (detail: RunDetail) => React.ReactNode;
}) {
  return (
    <section className="grid gap-3 border-t border-neutral-200 py-5 lg:grid-cols-[150px_1fr_1fr]">
      <h2 className="text-sm font-medium text-neutral-500">{label}</h2>
      <CompareCell detail={a}>{render(a)}</CompareCell>
      <CompareCell detail={b}>{render(b)}</CompareCell>
    </section>
  );
}

export function ComparePage({ runA, runB }: ComparePageProps) {
  const [state, setState] = useState<CompareState>({
    key: "",
    a: null,
    b: null,
    error: "",
  });
  const missingParams = !runA || !runB || runA === runB;
  const requestKey = missingParams ? "" : `${runA}\n${runB}`;

  useEffect(() => {
    if (missingParams || !runA || !runB) {
      return;
    }

    const controller = new AbortController();

    Promise.all([fetchRun(runA, controller.signal), fetchRun(runB, controller.signal)])
      .then(([a, b]) => {
        setState({ key: requestKey, a, b, error: "" });
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            a: null,
            b: null,
            error: error instanceof Error ? error.message : "run 정보를 불러오지 못했습니다.",
          });
        }
      });

    return () => controller.abort();
  }, [missingParams, requestKey, runA, runB]);

  const isCurrentResponse = state.key === requestKey;
  const isLoading = requestKey !== "" && !isCurrentResponse;
  const currentError = isCurrentResponse ? state.error : "";
  const currentA = isCurrentResponse ? state.a : null;
  const currentB = isCurrentResponse ? state.b : null;

  const blockingRun = useMemo(() => {
    if (!currentA || !currentB) {
      return null;
    }
    if (currentA.status !== "completed") {
      return currentA;
    }
    if (currentB.status !== "completed") {
      return currentB;
    }
    return null;
  }, [currentA, currentB]);

  if (missingParams) {
    return (
      <EmptyState
        title="비교할 run 두 개가 필요합니다"
        description="홈에서 완료된 run 두 개를 선택해 비교를 시작하세요."
      />
    );
  }

  if (isLoading) {
    return <p className="text-sm text-neutral-500">비교 데이터를 불러오는 중입니다.</p>;
  }

  if (currentError) {
    return (
      <p className="text-sm text-red-700" role="alert">
        {currentError}
      </p>
    );
  }

  if (!currentA || !currentB) {
    return null;
  }

  if (blockingRun) {
    return (
      <EmptyState
        title="완료된 run만 비교할 수 있습니다"
        description={`${blockingRun.state.idea} run은 아직 완료되지 않았습니다.`}
      />
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          run 비교
        </h1>
      </header>

      <div>
        <CompareRow
          label="실행 정보"
          a={currentA}
          b={currentB}
          render={(detail) => (
            <dl className="space-y-2 text-[15px] leading-relaxed text-neutral-700">
              <div>
                <dt className="text-xs font-medium text-neutral-500">실행 일시</dt>
                <dd className="tabular-nums">{formatDateTime(detail.state.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-neutral-500">runId</dt>
                <dd className="break-all text-xs text-neutral-500">{detail.state.runId}</dd>
              </div>
            </dl>
          )}
        />
        <CompareRow
          label="severity"
          a={currentA}
          b={currentB}
          render={(detail) => <SeveritySummary detail={detail} />}
        />
        <CompareRow
          label="verdict"
          a={currentA}
          b={currentB}
          render={(detail) => (
            <p className="text-[15px] leading-relaxed text-neutral-700">
              {detail.criticism?.verdict ?? "verdict 없음"}
            </p>
          )}
        />
        <CompareRow
          label="revisedConcept"
          a={currentA}
          b={currentB}
          render={(detail) => (
            <p className="text-[15px] leading-relaxed text-neutral-700">
              {detail.solution?.revisedConcept ?? "revisedConcept 없음"}
            </p>
          )}
        />
        <CompareRow
          label="monetization"
          a={currentA}
          b={currentB}
          render={(detail) => (
            <p className="text-[15px] leading-relaxed text-neutral-700">
              {detail.solution?.monetization ?? "monetization 없음"}
            </p>
          )}
        />
      </div>
    </div>
  );
}
