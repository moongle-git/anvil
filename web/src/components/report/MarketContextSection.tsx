import type { MarketContext, YoutubeVoice } from "@anvil/types";
import { Collapsible, EmptyState, SectionHeading } from "@/components/ui";
import { CompetitorTable } from "./CompetitorTable";

function YoutubeVoiceCard({ voice }: { voice: YoutubeVoice }) {
  return (
    <figure className="border-l-2 border-neutral-300 pl-4">
      <blockquote className="text-[15px] leading-relaxed text-neutral-700">
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

export function MarketContextSection({
  context,
}: {
  context?: MarketContext;
}) {
  return (
    <section aria-labelledby="market" className="flex flex-col gap-6">
      <SectionHeading id="market">① 실시간 시장 맥락</SectionHeading>

      {context === undefined ? (
        <EmptyState
          title="시장 맥락 데이터가 없습니다"
          description="이 실행에는 시장 맥락 산출물이 포함되어 있지 않습니다."
        />
      ) : (
        <>
          {context.trends.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Subheading>트렌드</Subheading>
              <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-neutral-700">
                {context.trends.map((trend) => (
                  <li key={trend}>{trend}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {context.competitors.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Subheading>유사·경쟁 서비스</Subheading>
              <CompetitorTable competitors={context.competitors} />
            </div>
          ) : null}

          {context.youtubeVoices.length > 0 ? (
            <div className="flex flex-col gap-4">
              <Subheading>타겟 유저의 실제 목소리</Subheading>
              <div className="flex flex-col gap-4">
                {context.youtubeVoices.map((voice, index) => (
                  <YoutubeVoiceCard key={`${voice.videoUrl}-${index}`} voice={voice} />
                ))}
              </div>
            </div>
          ) : null}

          {context.painPointEvidence.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Subheading>페인포인트 근거</Subheading>
              <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-neutral-700">
                {context.painPointEvidence.map((evidence) => (
                  <li key={evidence}>{evidence}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {context.sources.length > 0 ? (
            <Collapsible summary={`출처 ${context.sources.length}개`}>
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
            </Collapsible>
          ) : null}
        </>
      )}
    </section>
  );
}
