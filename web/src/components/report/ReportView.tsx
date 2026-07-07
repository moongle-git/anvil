"use client";

import { useState } from "react";
import type { CriticismPoint } from "@anvil/types";
import { formatDateTime, SEVERITY_ORDER, summarizeSeverity } from "@/lib/client/format";
import type { Criticism, RunDetail } from "@/lib/client/types";
import {
  Button,
  Card,
  Collapsible,
  EmptyState,
  SectionHeading,
  SEVERITY_LABELS,
  SeverityBadge,
} from "@/components/ui";

const CRITICISM_SECTIONS: Array<{
  key: keyof Pick<Criticism, "painPointReality" | "bmWeakness" | "copycatRisk">;
  title: string;
}> = [
  { key: "painPointReality", title: "페인포인트의 허구성" },
  { key: "bmWeakness", title: "수익 모델의 취약성" },
  { key: "copycatRisk", title: "카피캣 리스크" },
];

const STEP_NAV: Array<{ id: string; label: string }> = [
  { id: "market-context", label: "시장 맥락" },
  { id: "criticism", label: "냉정한 비판" },
  { id: "solution", label: "AI 네이티브 재설계" },
  { id: "business-model", label: "비즈니스 모델" },
];

function CriticismCard({ point }: { point: CriticismPoint }) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={point.severity} />
        <h4 className="text-base font-semibold text-neutral-900">{point.claim}</h4>
      </div>
      <Collapsible summary="근거 보기">{point.evidence}</Collapsible>
    </Card>
  );
}

function MissingReportData() {
  return (
    <EmptyState
      title="리포트 데이터를 불러올 수 없습니다"
      description="완료된 run이지만 구조화 JSON 산출물이 부족합니다."
    />
  );
}

export function ReportView({ detail }: { detail: RunDetail }) {
  const [showAllCompetitors, setShowAllCompetitors] = useState(false);
  const { context, criticism, solution } = detail;

  if (!context || !criticism || !solution) {
    return <MissingReportData />;
  }

  const severityCounts = summarizeSeverity(criticism);
  const visibleCompetitors = showAllCompetitors
    ? context.competitors
    : context.competitors.slice(0, 8);

  return (
    <article className="space-y-10">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
              {context.ideaTitle}
            </h1>
            <p className="text-xs tabular-nums text-neutral-500">
              실행 {formatDateTime(detail.state.createdAt)}
            </p>
          </div>
          {detail.hasReport ? (
            <a
              href={`/api/runs/${encodeURIComponent(detail.state.runId)}/report`}
              className="inline-flex rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              report.md 다운로드
            </a>
          ) : null}
        </div>

        <Card className="space-y-4 bg-neutral-50">
          <div className="flex flex-wrap gap-2">
            {SEVERITY_ORDER.map((severity) => (
              <span
                key={severity}
                className="inline-flex items-center gap-1 rounded-sm border border-neutral-200 bg-white px-2 py-1 text-xs font-medium text-neutral-700"
              >
                {SEVERITY_LABELS[severity]} {severityCounts[severity]}
              </span>
            ))}
          </div>
          <p className="text-[17px] leading-relaxed text-neutral-900">
            {criticism.verdict}
          </p>
        </Card>
      </header>

      <div className="grid gap-8 lg:grid-cols-[180px_1fr]">
        <nav className="top-6 h-fit overflow-x-auto border-y border-neutral-200 py-3 lg:sticky lg:border-y-0 lg:border-l lg:py-0 lg:pl-4">
          <div className="flex gap-4 whitespace-nowrap lg:flex-col lg:gap-2">
            {STEP_NAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-sm font-medium text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="space-y-12">
          <section className="space-y-6">
            <SectionHeading id="market-context">① 시장 맥락</SectionHeading>
            <div className="max-w-3xl space-y-3">
              <h3 className="text-base font-semibold text-neutral-900">트렌드</h3>
              <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-neutral-700">
                {context.trends.map((trend) => (
                  <li key={trend}>{trend}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold text-neutral-900">경쟁 서비스</h3>
              <div className="overflow-x-auto border-y border-neutral-200">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className="text-xs font-medium text-neutral-500">
                    <tr className="border-b border-neutral-200">
                      <th className="w-40 px-3 py-3">이름</th>
                      <th className="px-3 py-3">설명</th>
                      <th className="w-44 px-3 py-3">가격 힌트</th>
                    </tr>
                  </thead>
                  <tbody className="text-[15px]">
                    {visibleCompetitors.map((competitor) => (
                      <tr
                        key={competitor.name}
                        className="border-b border-neutral-100 last:border-b-0"
                      >
                        <td className="px-3 py-4 font-medium text-neutral-900">
                          {competitor.url ? (
                            <a
                              href={competitor.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline-offset-4 hover:underline"
                            >
                              {competitor.name}
                            </a>
                          ) : (
                            competitor.name
                          )}
                        </td>
                        <td className="px-3 py-4 leading-relaxed text-neutral-700">
                          {competitor.description}
                        </td>
                        <td className="px-3 py-4">
                          {competitor.pricingHint ? (
                            <span className="inline-flex rounded-sm border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
                              {competitor.pricingHint}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {context.competitors.length > 8 ? (
                <Button
                  variant="text"
                  onClick={() => setShowAllCompetitors((value) => !value)}
                >
                  {showAllCompetitors ? "접기" : "더보기"}
                </Button>
              ) : null}
            </div>

            <div className="space-y-3">
              <h3 className="text-base font-semibold text-neutral-900">
                YouTube 실제 목소리
              </h3>
              <div className="grid gap-3">
                {context.youtubeVoices.map((voice) => (
                  <Card key={`${voice.videoUrl}-${voice.comment}`} className="p-5">
                    <blockquote className="border-l-2 border-neutral-300 pl-4 text-[15px] leading-relaxed text-neutral-700">
                      {voice.comment}
                    </blockquote>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <a
                        href={voice.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-blue-700 underline-offset-4 hover:underline"
                      >
                        {voice.videoTitle}
                      </a>
                      {voice.authorName ? <span>{voice.authorName}</span> : null}
                      {voice.likeCount !== undefined ? (
                        <span>좋아요 {voice.likeCount.toLocaleString("ko-KR")}</span>
                      ) : null}
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            <div className="max-w-3xl space-y-3">
              <h3 className="text-base font-semibold text-neutral-900">
                페인포인트 근거
              </h3>
              <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-neutral-700">
                {context.painPointEvidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            </div>

            <Collapsible summary="출처">
              <ul className="space-y-2">
                {context.sources.map((source) => (
                  <li key={source}>
                    <a
                      href={source}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline-offset-4 hover:underline"
                    >
                      {source}
                    </a>
                  </li>
                ))}
              </ul>
            </Collapsible>
          </section>

          <section className="space-y-6">
            <SectionHeading id="criticism">② 냉정한 비판</SectionHeading>
            {CRITICISM_SECTIONS.map((section) => (
              <div key={section.key} className="space-y-3">
                <h3 className="text-base font-semibold text-neutral-900">
                  {section.title}
                </h3>
                <div className="grid gap-3">
                  {criticism[section.key].map((point) => (
                    <CriticismCard key={point.claim} point={point} />
                  ))}
                </div>
              </div>
            ))}
            <Card className="border-neutral-300 bg-neutral-50">
              <p className="text-[17px] leading-relaxed text-neutral-900">
                {criticism.verdict}
              </p>
            </Card>
          </section>

          <section className="max-w-3xl space-y-6">
            <SectionHeading id="solution">③ AI 네이티브 재설계</SectionHeading>
            <p className="text-[18px] leading-relaxed text-neutral-900">
              {solution.revisedConcept}
            </p>
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-neutral-900">
                  최소 입력
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">
                  {solution.minimalInput}
                </p>
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-900">
                  에이전트 워크플로우
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">
                  {solution.agenticWorkflow}
                </p>
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-900">
                  데이터 플라이휠
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-neutral-700">
                  {solution.dataFlywheel}
                </p>
              </div>
            </div>
          </section>

          <section className="max-w-3xl space-y-4">
            <SectionHeading id="business-model">④ 비즈니스 모델</SectionHeading>
            <p className="text-[15px] leading-relaxed text-neutral-700">
              {solution.monetization}
            </p>
          </section>

        </div>
      </div>
    </article>
  );
}
