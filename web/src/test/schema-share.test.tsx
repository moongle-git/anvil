import { describe, expect, it } from "vitest";
import { MarketContextSchema } from "@anvil/types";
import legacyContextFixture from "@/test/fixtures/2026-07-01T09-00-00-000Z-ai-meeting-notes-fx01/context.json";

describe("루트 src/types 스키마 공유 (ADR-006)", () => {
  it("MarketContextSchema가 유효한 fixture를 parse한다", () => {
    const fixture = {
      ideaTitle: "AI 회의록 요약 서비스",
      briefing: "요약 기능이 플랫폼 번들로 흡수되며 유료화 명분이 좁아진다.",
      marketSizeIndicators: [],
      competitorInsight: "무료 티어가 지배해 요약 단독 포지션은 소진됐다.",
      voicesInsight: "지불 의사는 요약이 아니라 그 다음 단계에 남는다.",
      trends: ["AI 요약 도구 수요 증가"],
      competitors: [
        {
          name: "클로바노트",
          description: "음성 인식 기반 회의록 서비스",
          url: "https://clovanote.naver.com",
          pricingHint: "무료",
        },
      ],
      communityVoices: [
        {
          source: "youtube",
          title: "회의록 자동화 후기",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          text: "회의 끝나고 정리하는 데 한 시간씩 걸려요",
          authorName: "user1",
          score: 12,
        },
      ],
      painPointEvidence: ["회의록 수동 작성에 주당 3시간 소모"],
      sources: ["https://example.com/report"],
    };

    const parsed = MarketContextSchema.parse(fixture);
    expect(parsed.ideaTitle).toBe("AI 회의록 요약 서비스");
    expect(parsed.competitors).toHaveLength(1);
    expect(parsed.citations).toEqual([]);
  });
});

// fx01은 디스크에 남아 있는 구버전 run을 시뮬레이션한다 (ADR-012 하위호환).
// 새 형식으로 갈아엎으면 승격 경로가 어느 테스트에도 걸리지 않는다 — 이 fixture는 구 형식으로 유지한다.
describe("구버전 run 하위호환 (ADR-012)", () => {
  it("디스크의 youtubeVoices 구 fixture를 communityVoices로 승격해 parse한다", () => {
    const legacy = legacyContextFixture as Record<string, unknown>;
    expect(legacy).toHaveProperty("youtubeVoices");
    expect(legacy).not.toHaveProperty("communityVoices");

    const parsed = MarketContextSchema.parse(legacy);

    const legacyVoices = legacy.youtubeVoices as {
      videoTitle: string;
      videoUrl: string;
      comment: string;
      likeCount?: number;
    }[];
    expect(parsed.communityVoices).toHaveLength(legacyVoices.length);
    expect(parsed.communityVoices[0]).toEqual({
      source: "youtube",
      title: legacyVoices[0].videoTitle,
      url: legacyVoices[0].videoUrl,
      text: legacyVoices[0].comment,
      authorName: expect.any(String),
      score: legacyVoices[0].likeCount,
    });
    // 구 run이 빈 리포트가 되지 않는다 — 목소리가 소실되지 않았다
    expect(parsed).not.toHaveProperty("youtubeVoices");
  });
});
