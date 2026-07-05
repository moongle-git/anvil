import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  CriticismSchema,
  type Criticism,
  type MarketContext,
} from "../types/index.js";
import { runColdCritic, type ColdCriticDeps } from "./coldCritic.js";

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

const CRITICISM: Criticism = {
  painPointReality: [
    {
      claim: "산책 대행 수요는 죄책감 해소용 일시 수요다",
      evidence: "댓글 '산책 시킬 시간이 없어서 너무 미안해요...'는 지불 의사가 아니라 죄책감 표현이다",
      severity: "major",
    },
  ],
  bmWeakness: [
    {
      claim: "회당 2만원대 시장에서 수수료 마진이 남지 않는다",
      evidence: "도그메이트가 이미 회당 2만원대로 운영 중이다",
      severity: "fatal",
    },
  ],
  copycatRisk: [
    {
      claim: "기존 펫시터 플랫폼이 기능 하나로 카피 가능하다",
      evidence: "도그메이트 등 기존 매칭 플랫폼이 존재한다",
      severity: "major",
    },
  ],
  verdict: "현 구조로는 사업 성립이 어렵다",
};

interface FakeDeps {
  deps: ColdCriticDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

function fakeDeps(): FakeDeps {
  const generateStructured = vi.fn().mockResolvedValue(CRITICISM);
  return {
    deps: { gemini: { generateStructured } as unknown as GeminiService },
    generateStructured,
  };
}

describe("runColdCritic", () => {
  it("grounding 없이 Criticism 스키마로 Gemini를 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await runColdCritic(deps, IDEA, MARKET_CONTEXT);

    expect(result).toEqual(CRITICISM);
    expect(CriticismSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.useGrounding).toBe(false);
    expect(params.schema).toBe(CriticismSchema);
  });

  it("시스템 프롬프트에 페르소나·3축 비판 기준·근거 인용 강제·severity 판정 기준이 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runColdCritic(deps, IDEA, MARKET_CONTEXT);

    const system = generateStructured.mock.calls[0][0]
      .systemInstruction as string;

    // 페르소나: 냉혹한 시장 분석가, 완충 표현 금지
    expect(system).toContain("20년");
    expect(system).toContain("시장 분석가");

    // 3축 비판 기준
    expect(system).toContain("페인포인트의 허구성");
    expect(system).toContain("수익 모델");
    expect(system).toContain("카피캣 리스크");

    // 근거 인용 강제
    expect(system).toContain("evidence");
    expect(system).toContain("금지");

    // severity 판정 기준
    expect(system).toContain("fatal");
    expect(system).toContain("major");
    expect(system).toContain("minor");
  });

  it("유저 프롬프트에 아이디어 원문과 MarketContext 전체가 유실 없이 직렬화된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runColdCritic(deps, IDEA, MARKET_CONTEXT);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    // 아이디어 원문
    expect(prompt).toContain(IDEA);

    // MarketContext 전체 JSON 직렬화 — 필드 하나도 유실되면 안 된다
    expect(prompt).toContain(JSON.stringify(MARKET_CONTEXT, null, 2));

    // 개별 데이터 포함 재확인 (경쟁 서비스·댓글 원문·트렌드)
    expect(prompt).toContain("도그메이트");
    expect(prompt).toContain("회당 2만원대");
    expect(prompt).toContain("산책 시킬 시간이 없어서 너무 미안해요...");
    expect(prompt).toContain("펫 시장 성장");
  });
});
