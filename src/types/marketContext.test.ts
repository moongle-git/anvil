import { describe, expect, it } from "vitest";
import {
  CitationSchema,
  CODE_INJECTED_CONTEXT_KEYS,
  CommunityVoiceSchema,
  CompetitorServiceSchema,
  MarketContextDraftSchema,
  MarketContextObjectSchema,
  MarketContextSchema,
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

describe("CitationSchema", () => {
  it("uri만 있는 인용을 허용한다", () => {
    const result = CitationSchema.safeParse({
      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    });
    expect(result.success).toBe(true);
  });

  it("title·domain 옵셔널 필드를 허용한다", () => {
    const result = CitationSchema.safeParse({
      uri: "https://example.com/report",
      title: "2026 반려식물 시장 리포트",
      domain: "example.com",
    });
    expect(result.success).toBe(true);
  });

  it("URL 형식이 아닌 uri를 거부한다", () => {
    expect(CitationSchema.safeParse({ uri: "출처 미상" }).success).toBe(false);
  });
});

describe("CommunityVoiceSchema", () => {
  const validVoice = {
    source: "youtube",
    title: "식물 키우기 실패하는 이유",
    url: "https://www.youtube.com/watch?v=abc123",
    text: "저도 물주기 타이밍을 계속 놓쳐서 다 죽였어요...",
  };

  it("필수 필드만 있는 유저 목소리를 허용한다", () => {
    expect(CommunityVoiceSchema.safeParse(validVoice).success).toBe(true);
  });

  it("authorName·score·extra 옵셔널 필드를 허용한다", () => {
    const result = CommunityVoiceSchema.safeParse({
      ...validVoice,
      authorName: "plantlover99",
      score: 42,
      extra: "검색 스니펫",
    });
    expect(result.success).toBe(true);
  });

  it.each(["youtube", "hackernews", "naver"] as const)(
    "source가 %s인 목소리를 허용한다",
    (source) => {
      const result = CommunityVoiceSchema.safeParse({ ...validVoice, source });
      expect(result.success).toBe(true);
    },
  );

  it("미지의 source를 거부한다", () => {
    const result = CommunityVoiceSchema.safeParse({
      ...validVoice,
      source: "reddit",
    });
    expect(result.success).toBe(false);
  });

  it("URL 형식이 아닌 url을 거부한다", () => {
    const result = CommunityVoiceSchema.safeParse({
      ...validVoice,
      url: "유튜브 영상",
    });
    expect(result.success).toBe(false);
  });

  it("음수 score를 거부한다", () => {
    const result = CommunityVoiceSchema.safeParse({ ...validVoice, score: -1 });
    expect(result.success).toBe(false);
  });

  it("빈 text를 거부한다", () => {
    const result = CommunityVoiceSchema.safeParse({ ...validVoice, text: "" });
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
    competitors: [{ name: "Planta", description: "식물 관리 리마인더 앱" }],
    communityVoices: [
      {
        source: "youtube",
        title: "식물 키우기 실패하는 이유",
        url: "https://www.youtube.com/watch?v=abc123",
        text: "저도 물주기 타이밍을 계속 놓쳐서 다 죽였어요...",
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
      communityVoices: [],
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

  it("communityVoices가 빈 배열이어도 허용한다 (전 소스 실패 시 발생)", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      communityVoices: [],
    });
    expect(result.success).toBe(true);
  });

  it("communityVoices의 미지 source를 거부한다", () => {
    const result = MarketContextSchema.safeParse({
      ...validContext,
      communityVoices: [
        { ...validContext.communityVoices[0], source: "reddit" },
      ],
    });
    expect(result.success).toBe(false);
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

  describe("citations (코드 주입 필드)", () => {
    it("citations 키가 없으면 빈 배열로 채운다", () => {
      const parsed = MarketContextSchema.parse(validContext);
      expect(parsed.citations).toEqual([]);
    });

    it("주입된 citations를 보존한다", () => {
      const citations = [
        { uri: "https://example.com/a", title: "A", domain: "example.com" },
      ];
      const parsed = MarketContextSchema.parse({ ...validContext, citations });
      expect(parsed.citations).toEqual(citations);
    });

    it("citations는 LLM이 채우는 draft 스키마에 없다", () => {
      expect(Object.keys(MarketContextDraftSchema.shape)).not.toContain(
        "citations",
      );
      expect(CODE_INJECTED_CONTEXT_KEYS).toContain("citations");
    });

    it("draft 키 + 코드 주입 키 = 최종 스키마 키 전체", () => {
      const union = new Set([
        ...Object.keys(MarketContextDraftSchema.shape),
        ...CODE_INJECTED_CONTEXT_KEYS,
      ]);
      expect(union).toEqual(new Set(Object.keys(MarketContextObjectSchema.shape)));
    });
  });

  // ADR-012 하위호환: 구 context.json은 youtubeVoices[]를 갖는다.
  // .default([])만으로는 zod의 strip 정책이 구 키를 조용히 버려 목소리가 소실된다.
  describe("구 run 하위호환 (youtubeVoices → communityVoices 승격)", () => {
    const legacyVoice = {
      videoTitle: "식물 키우기 실패하는 이유",
      videoUrl: "https://www.youtube.com/watch?v=abc123",
      comment: "저도 물주기 타이밍을 계속 놓쳐서 다 죽였어요...",
      authorName: "plantlover99",
      likeCount: 42,
    };
    const legacyContext = (() => {
      const withoutNewVoices: Record<string, unknown> = { ...validContext };
      delete withoutNewVoices.communityVoices;
      return { ...withoutNewVoices, youtubeVoices: [legacyVoice] };
    })();

    it("youtubeVoices만 있는 구 context를 parse하고 communityVoices로 승격한다", () => {
      const parsed = MarketContextSchema.parse(legacyContext);

      expect(parsed.communityVoices).toEqual([
        {
          source: "youtube",
          title: legacyVoice.videoTitle,
          url: legacyVoice.videoUrl,
          text: legacyVoice.comment,
          authorName: legacyVoice.authorName,
          score: legacyVoice.likeCount,
        },
      ]);
    });

    it("승격 결과에 구 youtubeVoices 키가 남지 않는다", () => {
      const parsed = MarketContextSchema.parse(legacyContext);
      expect(parsed).not.toHaveProperty("youtubeVoices");
    });

    it("옵셔널 필드가 없는 구 목소리도 승격한다", () => {
      const parsed = MarketContextSchema.parse({
        ...legacyContext,
        youtubeVoices: [
          {
            videoTitle: "제목",
            videoUrl: "https://www.youtube.com/watch?v=xyz",
            comment: "댓글 원문",
          },
        ],
      });
      expect(parsed.communityVoices[0].authorName).toBeUndefined();
      expect(parsed.communityVoices[0].score).toBeUndefined();
    });

    it("빈 youtubeVoices[]는 빈 communityVoices[]가 된다", () => {
      const parsed = MarketContextSchema.parse({
        ...legacyContext,
        youtubeVoices: [],
      });
      expect(parsed.communityVoices).toEqual([]);
    });

    it("communityVoices가 이미 있으면 승격이 개입하지 않는다 (신 형식 라운드트립)", () => {
      const parsed = MarketContextSchema.parse(validContext);
      expect(parsed.communityVoices).toEqual(validContext.communityVoices);
    });

    it("둘 다 있으면 communityVoices가 이긴다", () => {
      const parsed = MarketContextSchema.parse({
        ...validContext,
        youtubeVoices: [legacyVoice],
      });
      expect(parsed.communityVoices).toEqual(validContext.communityVoices);
      expect(parsed).not.toHaveProperty("youtubeVoices");
    });

    it("손상된 구 목소리는 throw가 아니라 검증 실패로 처리한다 (loadStepOutput이 null로 흡수)", () => {
      const result = MarketContextSchema.safeParse({
        ...legacyContext,
        youtubeVoices: [{ videoTitle: "제목", videoUrl: "URL이 아님" }],
      });
      expect(result.success).toBe(false);
    });

    it("객체가 아닌 입력은 승격 없이 zod 타입 에러로 흘려보낸다", () => {
      for (const input of [null, undefined, 42, "문자열", []]) {
        expect(() => MarketContextSchema.safeParse(input)).not.toThrow();
        expect(MarketContextSchema.safeParse(input).success).toBe(false);
      }
    });
  });
});
