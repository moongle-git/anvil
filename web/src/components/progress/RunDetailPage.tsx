"use client";

import { useState } from "react";
import { ReportView } from "@/components/report/ReportView";
import { Button, EmptyState } from "@/components/ui";
import { ProgressView } from "./ProgressView";
import { useRunDetail } from "./useRunDetail";

interface RunDetailPageProps {
  runId: string;
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
  return "실행을 재개하지 못했습니다.";
}

export function RunDetailPage({ runId }: RunDetailPageProps) {
  const { detail, error, isLoading, notFound, refresh } = useRunDetail(runId);
  const [isResuming, setIsResuming] = useState(false);
  const [resumeError, setResumeError] = useState("");

  async function resume() {
    setIsResuming(true);
    setResumeError("");
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/resume`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      refresh();
    } catch (resumeFailure) {
      setResumeError(
        resumeFailure instanceof Error
          ? resumeFailure.message
          : "실행을 재개하지 못했습니다.",
      );
    } finally {
      setIsResuming(false);
    }
  }

  if (isLoading && detail === null) {
    return <p className="text-sm text-neutral-500">run 정보를 불러오는 중입니다.</p>;
  }

  if (notFound) {
    return (
      <EmptyState
        title="run을 찾을 수 없습니다"
        description="요청한 실행 기록이 존재하지 않거나 state.json을 읽을 수 없습니다."
      />
    );
  }

  if (error && detail === null) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
        <Button variant="secondary" onClick={refresh}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  if (detail.status === "completed") {
    return <ReportView detail={detail} />;
  }

  return (
    <ProgressView
      detail={detail}
      onResume={resume}
      isResuming={isResuming}
      resumeError={resumeError}
    />
  );
}
