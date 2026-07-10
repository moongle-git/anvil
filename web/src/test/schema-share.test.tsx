import { describe, expect, it } from "vitest";
import { MarketContextSchema } from "@anvil/types";

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
      youtubeVoices: [
        {
          videoTitle: "회의록 자동화 후기",
          videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          comment: "회의 끝나고 정리하는 데 한 시간씩 걸려요",
          authorName: "user1",
          likeCount: 12,
        },
      ],
      painPointEvidence: ["회의록 수동 작성에 주당 3시간 소모"],
      sources: ["https://example.com/report"],
    };

    const parsed = MarketContextSchema.parse(fixture);
    expect(parsed.ideaTitle).toBe("AI 회의록 요약 서비스");
    expect(parsed.competitors).toHaveLength(1);
  });
});
