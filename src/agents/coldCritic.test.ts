import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  CriticismSchema,
  DIALECTIC_AXES,
  SEVERITY_SCORE_BANDS,
  type Criticism,
  toPromptContext,
  type MarketContext,
  type Thesis,
} from "../types/index.js";
import {
  COLD_CRITIC_SYSTEM_PROMPT,
  runColdCritic,
  type ColdCriticDeps,
} from "./coldCritic.js";

const IDEA = "반려견 산책 대행 매칭 서비스";

const MARKET_CONTEXT: MarketContext = {
  ideaTitle: "반려견 산책 대행 매칭 서비스",
  briefing:
    "1인 가구 반려동물 양육이 늘며 펫 시장이 성장 중이다. 도그메이트 등 매칭 플랫폼이 회당 2만원대로 시장을 선점했다.",
  marketSizeIndicators: ["1인 가구 반려동물 양육 가구 지속 증가"],
  competitorInsight:
    "매칭 기능 자체는 평준화됐고, 경쟁은 산책자 신뢰도 검증에서 벌어진다.",
  voicesInsight:
    "반려인은 산책 대행 자체보다 '내가 못 해준다'는 죄책감을 더 크게 말한다.",
  trends: ["펫 시장 성장", "1인 가구 반려동물 양육 증가"],
  competitors: [
    {
      name: "도그메이트",
      description: "펫시터 매칭 플랫폼",
      url: "https://dogmate.example.com",
      pricingHint: "회당 2만원대",
    },
  ],
  communityVoices: [
    {
      source: "youtube",
      title: "강아지 산책 브이로그",
      url: "https://www.youtube.com/watch?v=abc123",
      text: "산책 시킬 시간이 없어서 너무 미안해요...",
      authorName: "user1",
      score: 3,
    },
  ],
  painPointEvidence: ["바쁜 직장인은 산책 시간 확보가 어렵다"],
  sources: ["https://example.com/pet-market"],
  citations: [
    {
      uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz",
      title: "펫 시장 리포트",
      domain: "example.com",
      kind: "redirect",
    },
  ],
};

const THESIS: Thesis = {
  points: [
    {
      id: "t1",
      axis: "painPoint",
      claim: "산책 시간 부족은 반려인이 매일 겪는 반복 고통이다",
      rationale: "댓글 '산책 시킬 시간이 없어서 너무 미안해요...'가 뒷받침한다",
    },
    {
      id: "t2",
      axis: "bm",
      claim: "죄책감 해소에는 회당 2만원의 지불 의사가 이미 검증됐다",
      rationale: "도그메이트가 회당 2만원대로 시장을 운영 중이다",
    },
    {
      id: "t3",
      axis: "copycat",
      claim: "반려견별 산책·건강 데이터는 복제 불가능한 해자가 된다",
      rationale: "기존 매칭 플랫폼은 산책 이력 데이터를 축적하지 않는다",
    },
  ],
  revenueModel: "산책 대행 수수료 + 반려견 건강 리포트 구독의 이중 수익 구조",
  growthLevers: ["산책 인증 사진 공유 바이럴", "펫 커머스 크로스셀"],
  marketTailwinds: ["1인 가구 반려동물 양육 증가"],
  bestCaseScenario: "2년 내 월 활성 10만 가구 달성",
  winningThesis: "죄책감이라는 강한 감정 트리거가 반복 결제를 이끈다",
};

const CRITICISM: Criticism = {
  points: [
    {
      id: "c1",
      axis: "painPoint",
      rebuts: "t1",
      claim: "산책 대행 수요는 죄책감 해소용 일시 수요다",
      evidence: "댓글 '산책 시킬 시간이 없어서 너무 미안해요...'는 지불 의사가 아니라 죄책감 표현이다",
      severity: "major",
      riskScore: 55,
      riskKeyword: "일시 수요",
    },
    {
      id: "c2",
      axis: "bm",
      rebuts: "t2",
      claim: "회당 2만원대 시장에서 수수료 마진이 남지 않는다",
      evidence: "도그메이트가 이미 회당 2만원대로 운영 중이다",
      severity: "fatal",
      riskScore: 82,
      riskKeyword: "마진 부재",
    },
    {
      id: "c3",
      axis: "copycat",
      rebuts: "t3",
      claim: "기존 펫시터 플랫폼이 기능 하나로 카피 가능하다",
      evidence: "도그메이트 등 기존 매칭 플랫폼이 존재한다",
      severity: "major",
      riskScore: 60,
      riskKeyword: "낮은 진입장벽",
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

    const result = await runColdCritic(deps, IDEA, MARKET_CONTEXT, THESIS);

    expect(result).toEqual(CRITICISM);
    expect(CriticismSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.schema).toBe(CriticismSchema);
  });

  it("시스템 프롬프트에 페르소나·3축 비판 기준·근거 인용 강제·severity 판정 기준이 포함된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runColdCritic(deps, IDEA, MARKET_CONTEXT, THESIS);

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

    // 낙관론(Thesis) 반박 지시
    expect(system).toContain("Thesis");
    expect(system).toContain("낙관");
  });

  it("유저 프롬프트에 아이디어 원문·MarketContext·Thesis 전체가 유실 없이 직렬화된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runColdCritic(deps, IDEA, MARKET_CONTEXT, THESIS);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    // 아이디어 원문
    expect(prompt).toContain(IDEA);

    // MarketContext·Thesis 전체 JSON 직렬화 — 필드 하나도 유실되면 안 된다
    expect(prompt).toContain(
      JSON.stringify(toPromptContext(MARKET_CONTEXT), null, 2),
    );
    // citations는 코드가 만든 출처 메타데이터라 하류 논증에 쓰이지 않는다 —
    // 4개 프롬프트에 같은 리다이렉트 URL 뭉치가 중복해 실리는 것을 막는다
    expect(prompt).not.toContain("citations");
    expect(prompt).not.toContain("grounding-api-redirect");
    // sources(LLM 자기보고)는 남는다 — 하류에 맥락을 준다
    expect(prompt).toContain(MARKET_CONTEXT.sources[0]);
    expect(prompt).toContain(JSON.stringify(THESIS, null, 2));

    // 개별 데이터 포함 재확인 (경쟁 서비스·댓글 원문·트렌드·낙관 논지)
    expect(prompt).toContain("도그메이트");
    expect(prompt).toContain("회당 2만원대");
    expect(prompt).toContain("산책 시킬 시간이 없어서 너무 미안해요...");
    expect(prompt).toContain("펫 시장 성장");
    expect(prompt).toContain("죄책감이라는 강한 감정 트리거가 반복 결제를 이끈다");
  });

  it("유저 프롬프트에 Thesis points의 id가 노출되어 rebuts 대상이 된다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runColdCritic(deps, IDEA, MARKET_CONTEXT, THESIS);

    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    // rebuts에 적을 id는 프롬프트에 직렬화된 Thesis JSON에서 읽어야 한다
    for (const point of THESIS.points) {
      expect(prompt).toContain(`"id": "${point.id}"`);
    }
    expect(prompt).toContain("rebuts");
  });
});

describe("COLD_CRITIC_SYSTEM_PROMPT (points 출력 계약)", () => {
  it.each(DIALECTIC_AXES)("axis 값 %s를 명시한다", (axis) => {
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain(axis);
  });

  // 프롬프트에 박힌 숫자가 스키마 상수와 어긋나면 Gemini가 3회 재시도 후 실패한다.
  // 하드코딩 두 벌이 갈라지지 않도록 상수에서 읽어 검증한다.
  it.each(Object.entries(SEVERITY_SCORE_BANDS))(
    "severity %s의 riskScore 밴드 경계를 상수 그대로 담는다",
    (severity, band) => {
      expect(COLD_CRITIC_SYSTEM_PROMPT).toContain(
        `${severity}: ${band.min}~${band.max}`,
      );
    },
  );

  it("rebuts·riskScore·riskKeyword 작성 규칙을 담는다", () => {
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("rebuts");
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("riskScore");
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("riskKeyword");
    // riskKeyword는 문장이 아니라 짧은 명사구다
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("명사구");
  });

  it("verdict가 反의 소결론이며 리포트의 최종 판정이 아님을 명시한다 (ADR-010)", () => {
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("소결론");
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("최종 판정이 아니다");
  });

  it("세 축을 각각 최소 1개씩 덮으라고 지시한다", () => {
    expect(COLD_CRITIC_SYSTEM_PROMPT).toContain("최소 1개");
  });
});
