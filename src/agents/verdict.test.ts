import { describe, expect, it, vi } from "vitest";
import type { GeminiService } from "../services/gemini.js";
import {
  RECOMMENDATIONS,
  RECOMMENDATION_SCORE_BANDS,
  VerdictSchema,
  type Criticism,
  type MarketContext,
  type Solution,
  type Thesis,
  type Verdict,
} from "../types/index.js";
import {
  VERDICT_PROMPT_TEMPLATE,
  VERDICT_SYSTEM_PROMPT,
  runVerdict,
  type VerdictDeps,
} from "./verdict.js";

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
  trends: ["펫 시장 성장"],
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
  growthLevers: ["산책 인증 사진 공유 바이럴"],
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
      claim: "죄책감은 지불로 이어지지 않는다",
      evidence: "댓글은 미안함을 말할 뿐 대행 구매 의사를 말하지 않는다",
      severity: "major",
      riskScore: 55,
      riskKeyword: "약한 지불 동기",
    },
    {
      id: "c2",
      axis: "bm",
      rebuts: "t2",
      claim: "회당 2만원 수수료 모델은 단위 경제가 성립하지 않는다",
      evidence: "도그메이트가 이미 같은 가격대에서 수익을 내지 못한다",
      severity: "fatal",
      riskScore: 82,
      riskKeyword: "단위 경제 붕괴",
    },
    {
      id: "c3",
      axis: "copycat",
      rebuts: "t3",
      claim: "산책 이력 데이터는 해자가 아니다",
      evidence: "선점 플랫폼이 기능 추가로 즉시 복제할 수 있다",
      severity: "minor",
      riskScore: 20,
      riskKeyword: "해자 부재",
    },
  ],
  verdict: "현재 형태로는 단위 경제가 무너진다",
};

const SOLUTION: Solution = {
  minimalInput: "산책 밴드가 움직임을 감지해 자동으로 대행을 예약한다",
  agenticWorkflow: "에이전트가 산책자 배정과 이상 징후 보고를 자동 처리한다",
  dataFlywheel: "반려견별 활동량·건강 이력이 쌓여 보험 가격 결정에 쓰인다",
  monetization: "산책 수수료가 아닌 펫 보험 언더라이팅 수수료로 수익화한다",
  revisedConcept:
    "산책 대행 마켓플레이스가 아니라 반려견 활동량 기반 보험 언더라이터",
  synthesis:
    "수수료 전장을 떠나 활동량 데이터를 보험사에 파는 것이 단위 경제 붕괴 비판의 우회로다",
};

const VERDICT: Verdict = {
  survivalScore: 58,
  recommendation: "pivot",
  headline: "산책 대행으로는 죽고, 활동량 보험 언더라이터로는 산다",
  rationale:
    "反의 fatal 비판(단위 경제 붕괴)은 合이 보험 언더라이팅으로 전장을 옮겨 우회했다. 다만 보험사 제휴가 검증되지 않아 확신할 수 없다.",
  residualRisks: [
    {
      keyword: "보험사 제휴",
      severity: "major",
      note: "언더라이팅 수수료 모델은 보험사 1곳 이상의 제휴 없이는 매출이 0이다",
    },
  ],
  conditions: ["출시 6개월 내 보험사 1곳과 파일럿 계약 체결"],
};

interface FakeDeps {
  deps: VerdictDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

function fakeDeps(): FakeDeps {
  const generateStructured = vi.fn().mockResolvedValue(VERDICT);
  return {
    deps: { gemini: { generateStructured } as unknown as GeminiService },
    generateStructured,
  };
}

async function callVerdict(): Promise<{
  result: Verdict;
  generateStructured: ReturnType<typeof vi.fn>;
}> {
  const { deps, generateStructured } = fakeDeps();
  const result = await runVerdict(
    deps,
    IDEA,
    MARKET_CONTEXT,
    THESIS,
    CRITICISM,
    SOLUTION,
  );
  return { result, generateStructured };
}

describe("runVerdict", () => {
  it("grounding 없이 Verdict 스키마로 Gemini를 1회 호출하고 결과를 그대로 반환한다", async () => {
    const { result, generateStructured } = await callVerdict();

    expect(result).toEqual(VERDICT);
    expect(VerdictSchema.safeParse(result).success).toBe(true);

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const params = generateStructured.mock.calls[0][0];
    expect(params.schema).toBe(VerdictSchema);
    // 이 단계는 새 사실을 검색하지 않고 앞 4단계를 종합한다 (ADR-010)
    expect(params.useGrounding).toBe(false);
  });

  it("유저 프롬프트에 아이디어와 앞 4단계 산출물이 유실 없이 직렬화된다", async () => {
    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).toContain(IDEA);
    expect(prompt).toContain(JSON.stringify(MARKET_CONTEXT, null, 2));
    expect(prompt).toContain(JSON.stringify(THESIS, null, 2));
    expect(prompt).toContain(JSON.stringify(CRITICISM, null, 2));
    expect(prompt).toContain(JSON.stringify(SOLUTION, null, 2));

    // 플레이스홀더가 남아 있으면 치환이 누락된 것이다
    for (const placeholder of [
      "{idea}",
      "{marketContext}",
      "{thesis}",
      "{criticism}",
      "{solution}",
    ]) {
      expect(prompt).not.toContain(placeholder);
    }
  });

  it("프롬프트에 판정 근거가 되는 각 단계의 고유 문자열이 등장한다", async () => {
    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).toContain("도그메이트");
    expect(prompt).toContain(THESIS.winningThesis);
    expect(prompt).toContain("단위 경제 붕괴");
    expect(prompt).toContain(SOLUTION.revisedConcept);
  });
});

describe("VERDICT_PROMPT_TEMPLATE", () => {
  it.each(["{idea}", "{marketContext}", "{thesis}", "{criticism}", "{solution}"])(
    "플레이스홀더 %s를 갖는다",
    (placeholder) => {
      expect(VERDICT_PROMPT_TEMPLATE).toContain(placeholder);
    },
  );
});

describe("VERDICT_SYSTEM_PROMPT (판정 계약)", () => {
  // 프롬프트가 스키마와 어긋나면 Gemini 출력이 refine에 걸려 재시도만 반복한다.
  // 밴드 숫자는 상수에서 읽어와 대조한다 — 하드코딩 두 벌이 갈라지는 것을 막는다.
  it.each(RECOMMENDATIONS)("권고 %s의 점수 밴드를 숫자 그대로 명시한다", (rec) => {
    const band = RECOMMENDATION_SCORE_BANDS[rec];
    expect(VERDICT_SYSTEM_PROMPT).toContain(rec);
    expect(VERDICT_SYSTEM_PROMPT).toContain(`${band.min}~${band.max}`);
  });

  it("밴드 경계 숫자가 모두 등장한다", () => {
    const boundaries = RECOMMENDATIONS.flatMap((rec) => [
      String(RECOMMENDATION_SCORE_BANDS[rec].min),
      String(RECOMMENDATION_SCORE_BANDS[rec].max),
    ]);
    for (const boundary of boundaries) {
      expect(VERDICT_SYSTEM_PROMPT).toContain(boundary);
    }
    // 이 테스트가 지키려는 값 (상수가 바뀌면 프롬프트도 함께 바뀌어야 한다)
    expect(boundaries).toEqual(
      expect.arrayContaining(["39", "40", "69", "70"]),
    );
  });

  it("판정 대상이 원본 아이디어가 아니라 合의 재설계안임을 명시한다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("revisedConcept");
    expect(VERDICT_SYSTEM_PROMPT).toContain("방어");
    expect(VERDICT_SYSTEM_PROMPT).toContain("우회");
  });

  it("최종 심사역 페르소나 — 어느 쪽 편도 들지 않는다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("심사역");
    expect(VERDICT_SYSTEM_PROMPT).toContain("낙관론자");
    expect(VERDICT_SYSTEM_PROMPT).toContain("비판가");
  });

  it("Verdict 스키마 필드별 작성 규칙을 담는다", () => {
    for (const field of Object.keys(VERDICT)) {
      expect(VERDICT_SYSTEM_PROMPT).toContain(field);
    }
    expect(VERDICT_SYSTEM_PROMPT).toContain("한 문장");
  });

  it("residualRisks는 合이 방어하지 못한 리스크만 남기도록 지시한다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("criticism.points");
    expect(VERDICT_SYSTEM_PROMPT).toContain("잔존");
    expect(VERDICT_SYSTEM_PROMPT).toContain("keyword");
    expect(VERDICT_SYSTEM_PROMPT).toContain("severity");
  });

  it("방어되지 않은 fatal이 남으면 pivot 하한 미만으로 채점하도록 강제한다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("fatal");
    expect(VERDICT_SYSTEM_PROMPT).toContain(
      `${RECOMMENDATION_SCORE_BANDS.pivot.min} 미만`,
    );
  });

  it("conditions는 검증 가능한 조건이어야 한다고 지시한다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("검증 가능");
    expect(VERDICT_SYSTEM_PROMPT).toContain("희망");
  });
});
