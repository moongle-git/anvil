import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  ThesisSchema,
  type MarketContext,
  type Thesis,
} from "../types/index.js";
import { runThesis, type ThesisDeps } from "./thesis.js";

const IDEA = "반려견 산책 대행 매칭 서비스";

const MARKET_CONTEXT: MarketContext = {
  ideaTitle: "반려견 산책 대행 매칭 서비스",
  trends: ["펫 시장 성장", "1인 가구 반려동물 양육 증가"],
  competitors: [
    {
      name: "도그메이트",
      description: "펫시터 매칭 플랫폼",
      url: "https://dogmate.example.com",
      pricingHint: "회당 2만원대",
    },
  ],
  youtubeVoices: [
    {
      videoTitle: "강아지 산책 브이로그",
      videoUrl: "https://www.youtube.com/watch?v=abc123",
      comment: "산책 시킬 시간이 없어서 너무 미안해요...",
      authorName: "user1",
      likeCount: 3,
    },
  ],
  painPointEvidence: ["바쁜 직장인은 산책 시간 확보가 어렵다"],
  sources: ["https://example.com/pet-market"],
};

const THESIS: Thesis = {
  revenueModel: "산책 대행 수수료 + 반려견 건강 리포트 구독의 이중 수익 구조",
  growthLevers: ["산책 인증 사진 공유 바이럴", "펫 커머스 크로스셀"],
  marketTailwinds: ["1인 가구 반려동물 양육 증가", "펫 시장 지속 성장"],
  bestCaseScenario: "2년 내 월 활성 10만 가구, 구독 전환율 10% 달성",
  winningThesis: "죄책감이라는 강한 감정 트리거가 반복 결제를 이끈다",
};

interface FakeDeps {
  deps: ThesisDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

function fakeDeps(): FakeDeps {
  const generateStructured = vi.fn().mockResolvedValue(THESIS);
  return {
    deps: { gemini: { generateStructured } as unknown as GeminiService },
    generateStructured,
  };
}

describe("runThesis", () => {
  it("grounding 없이 Thesis 스키마로 Gemini를 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await runThesis(deps, IDEA, MARKET_CONTEXT);

    expect(result).toEqual(THESIS);
    expect(ThesisSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.useGrounding).toBe(false);
    expect(params.schema).toBe(ThesisSchema);
  });

  it("시스템 프롬프트에 낙관론자 페르소나와 근거 인용 강제가 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runThesis(deps, IDEA, MARKET_CONTEXT);

    const system = generateStructured.mock.calls[0][0]
      .systemInstruction as string;

    // 낙관론자 페르소나
    expect(system).toContain("성장 투자자");
    expect(system).toContain("적극 긍정");

    // 작성 항목 (Thesis 스키마 필드 대응)
    expect(system).toContain("revenueModel");
    expect(system).toContain("growthLevers");
    expect(system).toContain("marketTailwinds");
    expect(system).toContain("winningThesis");

    // 근거 인용 강제
    expect(system).toContain("MarketContext");
    expect(system).toContain("금지");
  });

  it("유저 프롬프트에 아이디어 원문과 MarketContext 전체가 유실 없이 직렬화된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runThesis(deps, IDEA, MARKET_CONTEXT);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).toContain(IDEA);
    expect(prompt).toContain(JSON.stringify(MARKET_CONTEXT, null, 2));
    expect(prompt).toContain("도그메이트");
    expect(prompt).toContain("산책 시킬 시간이 없어서 너무 미안해요...");
  });
});
