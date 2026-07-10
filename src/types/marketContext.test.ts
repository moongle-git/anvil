import { describe, expect, it } from "vitest";
import {
  CompetitorServiceSchema,
  MarketContextSchema,
  YoutubeVoiceSchema,
} from "./marketContext.js";

describe("CompetitorServiceSchema", () => {
  it("필수 필드만 있는 경쟁 서비스를 허용한다", () => {
    const result = CompetitorServiceSchema.safeParse({
      name: "Planta",
      description: "식물 관리 리마인더 앱",
    });
    expect(result.success).toBe(true);
  });

  it("url·pricingHint 옵셔널 필드를 허용한다", () => {
    const result = CompetitorServiceSchema.safeParse({
      name: "Planta",
      description: "식물 관리 리마인더 앱",
      url: "https://getplanta.com",
      pricingHint: "구독 월 $7.99",
    });
    expect(result.success).toBe(true);
  });

  it("URL 형식이 아닌 url을 거부한다", () => {
    const result = CompetitorServiceSchema.safeParse({
      name: "Planta",
      description: "식물 관리 리마인더 앱",
      url: "getplanta 홈페이지",
    });
    expect(result.success).toBe(false);
  });

  it("빈 name을 거부한다", () => {
    const result = CompetitorServiceSchema.safeParse({
      name: "",
      description: "식물 관리 리마인더 앱",
    });
    expect(result.success).toBe(false);
  });
});

describe("YoutubeVoiceSchema", () => {
  const validVoice = {
    videoTitle: "식물 키우기 실패하는 이유",
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    comment: "저도 물주기 타이밍을 계속 놓쳐서 다 죽였어요...",
  };

  it("필수 필드만 있는 유저 목소리를 허용한다", () => {
    expect(YoutubeVoiceSchema.safeParse(validVoice).success).toBe(true);
  });

  it("authorName·likeCount 옵셔널 필드를 허용한다", () => {
    const result = YoutubeVoiceSchema.safeParse({
      ...validVoice,
      authorName: "plantlover99",
      likeCount: 42,
    });
    expect(result.success).toBe(true);
  });

  it("URL 형식이 아닌 videoUrl을 거부한다", () => {
    const result = YoutubeVoiceSchema.safeParse({
      ...validVoice,
      videoUrl: "유튜브 영상",
    });
    expect(result.success).toBe(false);
  });

  it("음수 likeCount를 거부한다", () => {
    const result = YoutubeVoiceSchema.safeParse({
      ...validVoice,
      likeCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it("빈 comment를 거부한다", () => {
    const result = YoutubeVoiceSchema.safeParse({ ...validVoice, comment: "" });
    expect(result.success).toBe(false);
  });
});

describe("MarketContextSchema", () => {
  const validContext = {
    ideaTitle: "AI 기반 반려식물 관리 서비스",
    briefing:
      "반려식물 시장은 팬데믹 이후 연 10% 성장했다. 무료 리마인더 앱이 시장을 선점했고, 유료 전환은 진단 정확도에 달려 있다.",
    marketSizeIndicators: ["국내 반려식물 시장 연 10% 성장"],
    competitorInsight:
      "리마인더 기능은 무료로 평준화됐고, 유료 경쟁은 사진 기반 진단 정확도에서 벌어진다.",
    voicesInsight:
      "유저는 물주기 타이밍보다 '이미 시들기 시작한 뒤에야 알아차린다'는 늦은 감지를 더 큰 고통으로 말한다.",
    trends: ["반려식물 시장은 팬데믹 이후 연 10% 성장 중"],
    competitors: [
      { name: "Planta", description: "식물 관리 리마인더 앱" },
    ],
    youtubeVoices: [
      {
        videoTitle: "식물 키우기 실패하는 이유",
        videoUrl: "https://www.youtube.com/watch?v=abc123",
        comment: "저도 물주기 타이밍을 계속 놓쳐서 다 죽였어요...",
      },
    ],
    painPointEvidence: ["물주기 주기를 기억하지 못해 식물을 죽이는 사례 다수"],
    sources: ["https://example.com/plant-market-report"],
  };

  it("유효한 MarketContext를 허용한다", () => {
    expect(MarketContextSchema.safeParse(validContext).success).toBe(true);
  });

  it("빈 배열 필드를 허용한다 (수집 결과가 없을 수 있음)", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      competitors: [],
      youtubeVoices: [],
    });
    expect(result.success).toBe(true);
  });

  it("marketSizeIndicators가 빈 배열이어도 허용한다 (지표를 못 찾는 아이디어가 있다)", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      marketSizeIndicators: [],
    });
    expect(result.success).toBe(true);
  });

  it("youtubeVoices가 빈 배열이어도 허용한다 (quota 초과 시 발생)", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      youtubeVoices: [],
    });
    expect(result.success).toBe(true);
  });

  it.each(["briefing", "competitorInsight", "voicesInsight"] as const)(
    "빈 %s를 거부한다 (Summary에 노출되는 정제된 인사이트)",
    (field) => {
      const result = MarketContextSchema.safeParse({
        ...validContext,
        [field]: "",
      });
      expect(result.success).toBe(false);
    },
  );

  it.each(["briefing", "competitorInsight", "voicesInsight"] as const)(
    "%s가 빠지면 거부한다",
    (field) => {
      const withoutField: Record<string, unknown> = { ...validContext };
      delete withoutField[field];
      expect(MarketContextSchema.safeParse(withoutField).success).toBe(false);
    },
  );

  it("빈 ideaTitle을 거부한다", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      ideaTitle: "",
    });
    expect(result.success).toBe(false);
  });

  it("trends에 빈 문자열이 섞이면 거부한다", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      trends: ["유효한 트렌드", ""],
    });
    expect(result.success).toBe(false);
  });

  it("필수 필드가 빠지면 거부한다", () => {
    const withoutSources: Record<string, unknown> = { ...validContext };
    delete withoutSources.sources;
    expect(MarketContextSchema.safeParse(withoutSources).success).toBe(false);
  });
});
