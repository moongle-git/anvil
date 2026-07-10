import type { MarketContext, YoutubeVoice } from "@anvil/types";
import { Collapsible, EmptyState, SectionHeading } from "@/components/ui";
import { renderInline, renderRichText } from "@/lib/richText";
import { CompetitorTable } from "./CompetitorTable";

const LIST =
  "list-disc space-y-2 pl-5 text-[15px] leading-[1.8] text-neutral-700 marker:text-neutral-400";

function YoutubeVoiceCard({ voice }: { voice: YoutubeVoice }) {
  return (
    <figure className="border-l-2 border-neutral-300 pl-4">
      <blockquote className="text-[15px] leading-[1.8] text-neutral-700">
        {voice.comment}
      </blockquote>
      <figcaption className="mt-2 text-xs text-neutral-500">
        {voice.authorName ? <span>{voice.authorName}</span> : null}
        {voice.likeCount !== undefined ? (
          <span>
            {voice.authorName ? " · " : ""}좋아요 {voice.likeCount}
          </span>
        ) : null}
        {voice.authorName || voice.likeCount !== undefined ? " · " : ""}
        <a
          href={voice.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline-offset-4 hover:underline"
        >
          {voice.videoTitle}
        </a>
      </figcaption>
    </figure>
  );
}

function Subheading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold text-neutral-900">{children}</h3>
  );
}

// 접힌 근거 자료 summary는 정보 밀도를 위해 건수를 노출한다(UI_GUIDE). 0인 항목은 뺀다.
function evidenceSummary(context: MarketContext): string {
  const parts: string[] = [];
  if (context.competitors.length > 0)
    parts.push(`경쟁 서비스 ${context.competitors.length}개`);
  if (context.youtubeVoices.length > 0)
    parts.push(`유저 목소리 ${context.youtubeVoices.length}건`);
  if (context.trends.length > 0) parts.push(`트렌드 ${context.trends.length}건`);
  if (context.sources.length > 0)
    parts.push(`출처 ${context.sources.length}개`);
  return parts.length > 0 ? `근거 자료 — ${parts.join(" · ")}` : "근거 자료";
}

// 5단계 서사의 1단계. 본문은 정제된 인사이트만, 원시 배열은 아코디언 안으로 (PRD 출력 원칙).
// 톤은 건조한 팩트 — 낙관도 비관도 없다.
export function MarketContextSection({
  context,
}: {
  context?: MarketContext;
}) {
  if (context === undefined) {
    // 구버전 run은 새 스키마 검증에 실패해 context 필드가 생략된다 (ADR-011)
    return (
      <section aria-labelledby="market" className="flex max-w-3xl flex-col gap-6">
        <SectionHeading id="market">① 실시간 시장 맥락</SectionHeading>
        <EmptyState
          title="시장 맥락 데이터가 없습니다"
          description="이 실행에는 시장 맥락 산출물이 포함되어 있지 않습니다."
        />
      </section>
    );
  }

  const hasRawEvidence =
    context.trends.length > 0 ||
    context.competitors.length > 0 ||
    context.youtubeVoices.length > 0 ||
    context.painPointEvidence.length > 0 ||
    context.sources.length > 0;

  return (
    <section aria-labelledby="market" className="flex max-w-3xl flex-col gap-6">
      <SectionHeading id="market">① 실시간 시장 맥락</SectionHeading>

      {/* 리드 문단: 건조한 팩트 브리핑 */}
      {renderRichText(context.briefing)}

      {/* 지표를 못 찾는 정상 상황이 있으므로 빈 배열이면 소제목째 생략한다 */}
      {context.marketSizeIndicators.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Subheading>시장 규모 지표</Subheading>
          <ul className={LIST}>
            {context.marketSizeIndicators.map((indicator) => (
              <li key={indicator}>{renderInline(indicator)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Subheading>경쟁 구도</Subheading>
        {renderRichText(context.competitorInsight)}
      </div>

      <div className="flex flex-col gap-2">
        <Subheading>타겟 유저의 목소리</Subheading>
        {renderRichText(context.voicesInsight)}
      </div>

      {hasRawEvidence ? (
        <Collapsible summary={evidenceSummary(context)}>
          <div className="flex flex-col gap-6">
            {context.trends.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Subheading>트렌드</Subheading>
                <ul className={LIST}>
                  {context.trends.map((trend) => (
                    <li key={trend}>{renderInline(trend)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {context.competitors.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Subheading>경쟁 서비스</Subheading>
                <CompetitorTable competitors={context.competitors} />
              </div>
            ) : null}

            <div className="flex flex-col gap-4">
              <Subheading>실제 유저 목소리</Subheading>
              {context.youtubeVoices.length > 0 ? (
                <div className="flex flex-col gap-4">
                  {context.youtubeVoices.map((voice, index) => (
                    <YoutubeVoiceCard
                      key={`${voice.videoUrl}-${index}`}
                      voice={voice}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[15px] leading-[1.8] text-neutral-500">
                  수집된 YouTube 목소리 없음
                </p>
              )}
            </div>

            {context.painPointEvidence.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Subheading>페인포인트 근거</Subheading>
                <ul className={LIST}>
                  {context.painPointEvidence.map((evidence) => (
                    <li key={evidence}>{renderInline(evidence)}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {context.sources.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Subheading>출처</Subheading>
                <ul className="flex flex-col gap-1">
                  {context.sources.map((source, index) => (
                    <li key={`${source}-${index}`}>
                      <a
                        href={source}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-sm text-blue-700 underline-offset-4 hover:underline"
                      >
                        {source}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Collapsible>
      ) : null}
    </section>
  );
}
