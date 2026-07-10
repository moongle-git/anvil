import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  SolutionSchema,
  type Criticism,
  type MarketContext,
  type Solution,
  type Thesis,
} from "../types/index.js";
import {
  runSolutionDesigner,
  type SolutionDesignerDeps,
} from "./solutionDesigner.js";

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
  marketTailwinds: ["1인 가구 반려동물 양육 증가"],
  bestCaseScenario: "2년 내 월 활성 10만 가구 달성",
  winningThesis: "죄책감이라는 강한 감정 트리거가 반복 결제를 이끈다",
};

const CRITICISM: Criticism = {
  painPointReality: [
    {
      claim: "산책 대행 수요는 죄책감 해소용 일시 수요다",
      evidence:
        "댓글 '산책 시킬 시간이 없어서 너무 미안해요...'는 지불 의사가 아니라 죄책감 표현이다",
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

const SOLUTION: Solution = {
  minimalInput: "스마트 목줄 센서 데이터로 산책 필요 시점을 자동 감지한다",
  agenticWorkflow: "백그라운드 에이전트가 산책자 매칭과 일정 조율을 자율 수행한다",
  dataFlywheel: "반려견별 산책 패턴·건강 데이터가 축적되어 매칭 정확도가 높아진다",
  monetization: "산책 대행이 아닌 반려견 건강 리포트 구독으로 과금한다",
  revisedConcept:
    "죄책감 해소가 아닌 반려견 건강 관리 서비스로 재정의하여 fatal 비판에 대응한다",
  synthesis:
    "낙관론의 감정 트리거와 반론의 마진 한계를 종합하면, 산책 대행이 아니라 감정을 데이터로 전환하는 건강 관리 구독이 승부처다",
};

interface FakeDeps {
  deps: SolutionDesignerDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

function fakeDeps(): FakeDeps {
  const generateStructured = vi.fn().mockResolvedValue(SOLUTION);
  return {
    deps: { gemini: { generateStructured } as unknown as GeminiService },
    generateStructured,
  };
}

describe("runSolutionDesigner", () => {
  it("grounding 없이 Solution 스키마로 Gemini를 호출하고 결과를 반환한다", async () => {
    const { deps, generateStructured } = fakeDeps();

    const result = await runSolutionDesigner(
      deps,
      IDEA,
      MARKET_CONTEXT,
      CRITICISM,
      THESIS,
    );

    expect(result).toEqual(SOLUTION);
    expect(SolutionSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.useGrounding).toBe(false);
    expect(params.schema).toBe(SolutionSchema);
  });

  it("시스템 프롬프트에 4대 설계 원칙·비판 수용 강제·정반합 종합 강제 문구가 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runSolutionDesigner(deps, IDEA, MARKET_CONTEXT, CRITICISM, THESIS);

    const system = generateStructured.mock.calls[0][0]
      .systemInstruction as string;

    // 4대 설계 원칙 (Solution 스키마 필드 대응)
    expect(system).toContain("Minimal Input");
    expect(system).toContain("Zero UI");
    expect(system).toContain("Agentic Workflow");
    expect(system).toContain("Data Flywheel");
    expect(system).toContain("Monetization");
    expect(system).toContain("ROI");

    // 비판 수용 강제
    expect(system).toContain("fatal");
    expect(system).toContain("major");
    expect(system).toContain("revisedConcept");
    expect(system).toContain("금지");

    // 정반합 종합 강제
    expect(system).toContain("synthesis");
    expect(system).toContain("종합");
  });

  it("유저 프롬프트에 아이디어 원문·MarketContext·Thesis·Criticism 전체가 유실 없이 직렬화된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runSolutionDesigner(deps, IDEA, MARKET_CONTEXT, CRITICISM, THESIS);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    // 아이디어 원문
    expect(prompt).toContain(IDEA);

    // MarketContext·Thesis·Criticism 전체 JSON 직렬화 — 필드 하나도 유실되면 안 된다
    expect(prompt).toContain(JSON.stringify(MARKET_CONTEXT, null, 2));
    expect(prompt).toContain(JSON.stringify(THESIS, null, 2));
    expect(prompt).toContain(JSON.stringify(CRITICISM, null, 2));

    // 개별 데이터 포함 재확인 (비판 claim·evidence·verdict, 낙관 논지)
    expect(prompt).toContain("산책 대행 수요는 죄책감 해소용 일시 수요다");
    expect(prompt).toContain("도그메이트가 이미 회당 2만원대로 운영 중이다");
    expect(prompt).toContain("현 구조로는 사업 성립이 어렵다");
    expect(prompt).toContain("죄책감이라는 강한 감정 트리거가 반복 결제를 이끈다");
  });
});
