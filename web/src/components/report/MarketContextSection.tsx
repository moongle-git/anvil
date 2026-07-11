import {
  RESEARCH_SOURCE_IDS,
  SOURCE_LABELS,
  type CommunityVoice,
  type MarketContext,
} from "@anvil/types";
import { Badge, Collapsible, EmptyState, SectionHeading } from "@/components/ui";
import { renderInline, renderRichText } from "@/lib/richText";
import { CompetitorTable } from "./CompetitorTable";

const LIST =
  "list-disc space-y-2 pl-5 text-[15px] leading-[1.8] text-neutral-700 marker:text-neutral-400";

const LINK = "text-sm text-blue-700 underline-offset-4 hover:underline";

// 소스 뱃지는 무채색(neutral)이다. severity 팔레트를 쓰면 "네이버는 빨간색이니 위험한가"로 읽힌다 —
// 소스는 위험도가 아니다 (UI_GUIDE: 색은 데이터 의미에만).
function CommunityVoiceCard({ voice }: { voice: CommunityVoice }) {
  const meta: string[] = [];
  if (voice.authorName) meta.push(voice.authorName);
  if (voice.score !== undefined) meta.push(`좋아요 ${voice.score}`);
  // 네이버 description은 말줄임이 든 검색 스니펫이다 — 완결된 원문으로 읽히지 않게 표시한다
  if (voice.extra) meta.push(voice.extra);

  return (
    <figure
      data-voice-source={voice.source}
      // 레일 인용 규격 (UI_GUIDE): 상하 여백이 0이면 텍스트가 레일 끝에 붙어 잘린 것처럼 보인다.
      // DialecticSplit의 반박 인용(RAIL_QUOTE)과 같은 값이어야 한다 — 같은 시맨틱이다.
      className="border-l-2 border-neutral-300 py-1 pl-4"
    >
      <blockquote className="text-[15px] leading-[1.8] text-neutral-700">
        {voice.text}
      </blockquote>
      <figcaption className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <Badge tone="neutral">{SOURCE_LABELS[voice.source]}</Badge>
        {meta.length > 0 ? <span>{meta.join(" · ")}</span> : null}
        <a
          href={voice.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline-offset-4 hover:underline"
        >
          {voice.title}
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

function voicesOf(
  context: MarketContext,
  source: CommunityVoice["source"],
): CommunityVoice[] {
  return context.communityVoices.filter((voice) => voice.source === source);
}

// 소스별 수집 편중이 접힌 영역을 열기 전에도 보여야 한다 — HN 0건은 근거 편향이다.
function voiceBreakdown(context: MarketContext): string {
  const parts = RESEARCH_SOURCE_IDS.map((source) => ({
    label: SOURCE_LABELS[source],
    count: voicesOf(context, source).length,
  }))
    .filter(({ count }) => count > 0)
    .map(({ label, count }) => `${label} ${count}`);
  return parts.length === 0 ? "" : `(${parts.join(" · ")})`;
}

// 접힌 근거 자료 summary는 정보 밀도를 위해 건수를 노출한다(UI_GUIDE). 0인 항목은 뺀다.
function evidenceSummary(context: MarketContext): string {
  const parts: string[] = [];
  if (context.competitors.length > 0)
    parts.push(`경쟁 서비스 ${context.competitors.length}개`);
  if (context.communityVoices.length > 0)
    parts.push(
      `유저 목소리 ${context.communityVoices.length}건${voiceBreakdown(context)}`,
    );
  if (context.trends.length > 0) parts.push(`트렌드 ${context.trends.length}건`);
  if (context.sources.length > 0)
    parts.push(`출처 ${context.sources.length}개`);
  if (context.citations.length > 0)
    parts.push(`검색 인용 ${context.citations.length}개`);
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
    context.communityVoices.length > 0 ||
    context.painPointEvidence.length > 0 ||
    context.sources.length > 0 ||
    context.citations.length > 0;

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
              {context.communityVoices.length > 0 ? (
                <div className="flex flex-col gap-6">
                  {RESEARCH_SOURCE_IDS.map((source) => {
                    const voices = voicesOf(context, source);
                    if (voices.length === 0) return null;
                    return (
                      <div
                        key={source}
                        data-voice-group={source}
                        className="flex flex-col gap-4"
                      >
                        <h4 className="text-sm font-medium text-neutral-500">
                          {SOURCE_LABELS[source]} · {voices.length}건
                        </h4>
                        {voices.map((voice, index) => (
                          <CommunityVoiceCard
                            key={`${voice.url}-${index}`}
                            voice={voice}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[15px] leading-[1.8] text-neutral-500">
                  수집된 유저 목소리 없음
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
                        className={`break-all ${LINK}`}
                      >
                        {source}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* 출처(에이전트 자기보고)와 형제로 두되 합치지 않는다: 검색 인용은 코드가 grounding
                응답에서 추출한 것이라 정확하지만 리다이렉트 URL이라 만료된다 — 실패 모드가
                상보적이므로 무엇을 믿을지는 독자가 판단한다 (ADR-012) */}
            {context.citations.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Subheading>검색 인용</Subheading>
                <ul data-citation-list className="flex flex-col gap-1">
                  {context.citations.map((citation, index) => (
                    <li key={`${citation.uri}-${index}`}>
                      <a
                        href={citation.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`break-all ${LINK}`}
                      >
                        {citation.title ?? citation.domain ?? citation.uri}
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
