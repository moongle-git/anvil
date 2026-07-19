import {
  SIGNAL_TYPE_LABELS,
  type Citation,
  type ResolvedCapitalSignal,
} from "@anvil/types";
import { Badge } from "./Badge";

/**
 * 자본 신호 하나를 렌더한다. 후보 선택 화면과 리포트의 "이 주제의 출처"가 같은 것을 쓴다 —
 * 렌더러가 갈리면 사용자가 고를 때 본 근거와 리포트에 실린 근거가 달라진다.
 *
 * 출처 링크 규율은 ADR-013 그대로다: origin(urlContext가 실제로 읽어낸 원본)만 href를 갖고,
 * redirect(만료되는 vertexaisearch 리다이렉트)는 텍스트로 남는다. domain은 두 경우 모두
 * 노출한다 — 통신사인지 개인 블로그인지는 코드가 아니라 사람이 판단할 몫이다.
 */

const META = "text-xs text-neutral-500";

function citationLabel(citation: Citation): string {
  return citation.title ?? citation.domain ?? citation.uri;
}

function SignalSource({ citation }: { citation: Citation }) {
  const label = citationLabel(citation);
  const domain =
    citation.domain !== undefined && citation.domain !== label
      ? citation.domain
      : undefined;

  return (
    <span
      data-citation-kind={citation.kind}
      className={`inline-flex flex-wrap items-center gap-2 ${META}`}
    >
      <span>출처</span>
      {citation.kind === "origin" ? (
        <a
          href={citation.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-blue-700 underline-offset-4 hover:underline"
        >
          {label}
        </a>
      ) : (
        <span
          title="만료되면 404가 되는 검색 리다이렉트라 링크를 걸지 않았습니다"
          className="break-all"
        >
          {label}
        </span>
      )}
      {domain !== undefined ? <span>{domain}</span> : null}
      {citation.kind === "redirect" ? (
        <Badge tone="neutral">만료 가능</Badge>
      ) : null}
    </span>
  );
}

export function CapitalSignalItem({
  signal,
}: {
  signal: ResolvedCapitalSignal;
}) {
  const dates = [`관측 ${signal.observedAt}`];
  // 시행일은 규제 신호의 값어치 그 자체다 — 미래여도(오히려 미래일수록) 보여야 한다
  if (signal.effectiveAt !== undefined) {
    dates.push(`시행 ${signal.effectiveAt}`);
  }

  return (
    <li
      data-signal-type={signal.signalType}
      className="flex flex-col gap-2 border-l-2 border-neutral-300 py-1 pl-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{SIGNAL_TYPE_LABELS[signal.signalType]}</Badge>
        <span className={`${META} tabular-nums`}>{dates.join(" · ")}</span>
      </div>
      <p className="text-[15px] leading-[1.8] text-neutral-700">
        {signal.statement}
      </p>
      {/* 출처 원문은 코드가 대조할 수 없다(step 2 조사 결론 — groundingSupports는 모델 자신의
          응답 텍스트다). 사람이 눈으로 보는 것이 유일한 검증 수단이라 접지 않고 그대로 싣는다 */}
      {signal.quote !== undefined ? (
        <blockquote className="border-l-2 border-neutral-300 py-1 pl-4 text-[15px] leading-[1.8] text-neutral-500">
          {signal.quote}
        </blockquote>
      ) : null}
      <SignalSource citation={signal.citation} />
    </li>
  );
}

export function CapitalSignalList({
  signals,
}: {
  signals: readonly ResolvedCapitalSignal[];
}) {
  return (
    <ul className="flex flex-col gap-4">
      {signals.map((signal, index) => (
        <CapitalSignalItem key={`${signal.citation.uri}-${index}`} signal={signal} />
      ))}
    </ul>
  );
}
