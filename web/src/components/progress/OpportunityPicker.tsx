"use client";

import { useState, type ReactNode } from "react";
import {
  HORIZON_LABELS,
  type Opportunities,
  type Opportunity,
} from "@anvil/types";
import {
  Badge,
  Button,
  CapitalSignalItem,
  CapitalSignalList,
  Card,
  EmptyState,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";

interface OpportunityPickerProps {
  runId: string;
  opportunities: Opportunities;
  onSubmitted?: () => void;
  /** 상세 헤더 메타 줄에 놓이는 계보 (RunDetailClient가 소유한다) */
  lineage?: ReactNode;
  /** 상세 헤더에 놓이는 삭제 컨트롤 (RunDetailClient가 소유한다) */
  deleteControl?: ReactNode;
}

const MINOR = "text-sm font-medium text-neutral-500";
const BODY = "text-[15px] leading-[1.8] text-neutral-700";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={MINOR}>{label}</h3>
      <p className={BODY}>{children}</p>
    </div>
  );
}

/**
 * 후보 카드 하나.
 *
 * **점수·순위·추천 뱃지가 없다.** 데이터에 그런 필드가 없고(opportunity.ts), UI가 만들어내면
 * 파이프라인이 완주하기도 전에 결론을 노출하는 것이 된다 (ADR-008·ADR-010 — 판정은 5절의 일이다).
 * 정렬도 모델이 낸 순서 그대로 둔다.
 */
function CandidateCard({
  candidate,
  selected,
  submitting,
  onPick,
  onCancel,
  onConfirm,
}: {
  candidate: Opportunity;
  selected: boolean;
  submitting: boolean;
  onPick: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Card
      data-candidate-id={candidate.id}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-neutral-900">
            {candidate.title}
          </h2>
          <Badge tone="neutral">{HORIZON_LABELS[candidate.horizon]}</Badge>
        </div>
        <p className={BODY}>{candidate.whatItIs}</p>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="왜 지금인가">{candidate.whyNow}</Field>
        <Field label="누가 돈을 내나">{candidate.whoPays}</Field>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className={MINOR}>근거 신호</h3>
        <CapitalSignalList signals={candidate.signals} />
      </div>

      {/* 불리한 증거는 접지 않는다. 유리한 신호만 펼쳐 두면 사용자가 편향된 상태로 주제를
          고르게 되고, 그 편향이 시장 맥락부터 판정까지 전부에 주입된다 (ADR-017의 원장과 같은 감각:
          반대 증거는 부록이 아니라 판단의 근거다). */}
      <div data-counter-signal="" className="flex flex-col gap-3">
        <h3 className={MINOR}>반대 증거</h3>
        <ul className="flex flex-col gap-4">
          <CapitalSignalItem signal={candidate.counterSignal} />
        </ul>
      </div>

      {selected ? (
        // 확인 줄은 콜아웃이 아니라 액션 줄이다 (UI_GUIDE 삭제 버튼과 같은 규격). Danger는
        // 쓰지 않는다 — 이 액션은 파괴적이지 않고, 되돌릴 수 없고 비용이 들 뿐이다.
        <div
          data-select-confirm=""
          className="flex flex-wrap items-center gap-3"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !submitting) {
              onCancel();
            }
          }}
        >
          <span className="text-sm text-neutral-700">
            이 주제로 컨설팅을 시작합니다. 시작하면 되돌릴 수 없고 API 비용이
            발생합니다.
          </span>
          <Button disabled={submitting} onClick={onConfirm}>
            {submitting ? "시작하는 중…" : "시작"}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={onCancel}>
            취소
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="secondary" onClick={onPick}>
            이 주제로 진행
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * 후보 선택 화면 (trend-scout이 waiting인 스카우트 run).
 *
 * QuestionForm이 인터뷰 답변을 받는 자리와 같은 위치·같은 흐름이다: 제출하면
 * POST /api/runs/{id}/selection이 아티팩트를 기록하고 파이프라인을 재개하며,
 * 폴링(useRunDetail)이 waiting→running 전이를 잡아 진행 뷰로 전환한다.
 *
 * 카드 클릭 한 번으로 시작하지 않는 이유: 이후 단계는 되돌릴 수 없고 실비가 나간다.
 */
export function OpportunityPicker({
  runId,
  opportunities,
  onSubmitted,
  lineage,
  deleteControl,
}: OpportunityPickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(candidateId: string) {
    if (submitting || submitted) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "주제 선택에 실패했습니다.");
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "주제 선택에 실패했습니다.");
      setSubmitting(false);
    }
  }

  const header = (
    <header className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          검증할 주제를 골라주세요
        </h1>
        <p className="text-sm leading-relaxed text-neutral-500">
          탐색 범위: {opportunities.scope} · 탐색 시점{" "}
          {formatDateTime(opportunities.searchedAt)}
        </p>
        {lineage}
      </div>
      {deleteControl}
    </header>
  );

  if (submitted) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card className="border-amber-200 bg-amber-50">
          <p className={BODY}>주제를 선택했습니다. 분석을 시작합니다…</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      <p className={`max-w-3xl ${BODY}`}>
        아래는 최근 자본 흐름에서 찾은 후보입니다. 순서는 탐색이 낸 그대로이며
        우열을 뜻하지 않습니다. 각 후보의 근거 신호와{" "}
        <strong className="font-medium text-neutral-900">반대 증거</strong>를 함께
        읽고 고르세요.
      </p>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {opportunities.candidates.length === 0 ? (
        <EmptyState
          title="후보가 없습니다"
          description="이 탐색은 후보를 만들지 않았습니다. 다른 범위로 새 탐색을 시작하세요."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {opportunities.candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              selected={selectedId === candidate.id}
              submitting={submitting}
              onPick={() => setSelectedId(candidate.id)}
              onCancel={() => setSelectedId(null)}
              onConfirm={() => void submit(candidate.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
