import { describe, expect, it, vi } from "vitest";
import type {
  GeminiService,
  GenerateStructuredParams,
} from "../services/gemini.js";
import {
  REMEDY_STRATEGIES,
  REMEDY_STRATEGY_LABELS,
  SolutionSchema,
  type Criticism,
  toPromptContext,
  type MarketContext,
  type Solution,
  type Thesis,
} from "../types/index.js";
import {
  SOLUTION_DESIGNER_PROMPT_TEMPLATE,
  SOLUTION_DESIGNER_THINKING_BUDGET,
  SOLUTION_DESIGNER_SYSTEM_PROMPT,
  runSolutionDesigner,
  type SolutionDesignerDeps,
} from "./solutionDesigner.js";

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
  researchCoverage: [],
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
      evidence:
        "댓글 '산책 시킬 시간이 없어서 너무 미안해요...'는 지불 의사가 아니라 죄책감 표현이다",
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

/** fatal이 c2 하나뿐인 CRITICISM으로는 "전건" 커버리지를 검증할 수 없다 */
const TWO_FATAL_CRITICISM: Criticism = {
  ...CRITICISM,
  points: CRITICISM.points.map((point) =>
    point.id === "c3"
      ? { ...point, severity: "fatal" as const, riskScore: 78 }
      : point,
  ),
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
  remedies: [
    {
      respondsTo: "c2",
      strategy: "bypass",
      remedy:
        "회당 수수료 전장을 떠나, 축적된 산책·활동 데이터를 반려견 건강 리포트 구독으로 판다",
    },
  ],
};

interface FakeDeps {
  deps: SolutionDesignerDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

/**
 * 실제 generateStructured는 넘겨받은 schema로 응답을 검증한 뒤에야 반환한다 (ADR-004).
 * fake도 그 계약을 지켜야 "어떤 스키마를 넘겼는가"가 행동으로 드러난다 — 스키마 객체
 * 동일성(toBe)을 단언하면 팩토리가 무엇을 강제하는지는 끝내 확인되지 않는다.
 */
function fakeDeps(response: unknown = SOLUTION): FakeDeps {
  const generateStructured = vi.fn(
    async (params: GenerateStructuredParams<Solution>) =>
      params.schema.parse(response),
  );
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
  });

  it("시스템 프롬프트에 4대 설계 원칙·원장 계약·정반합 종합 강제 문구가 포함된다", async () => {
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

    // MarketContext·Thesis·Criticism 전체 JSON 직렬화 — 필드 하나도 유실되면 안 된다.
    // minify다 — 들여쓰기 공백까지 입력 토큰으로 과금된다 (ADR-016)
    expect(prompt).toContain(JSON.stringify(toPromptContext(MARKET_CONTEXT)));
    expect(prompt).not.toContain(
      JSON.stringify(toPromptContext(MARKET_CONTEXT), null, 2),
    );
    // citations는 코드가 만든 출처 메타데이터라 하류 논증에 쓰이지 않는다 —
    // 4개 프롬프트에 같은 리다이렉트 URL 뭉치가 중복해 실리는 것을 막는다
    expect(prompt).not.toContain("citations");
    expect(prompt).not.toContain("grounding-api-redirect");
    // sources(LLM 자기보고 URL)도 뺀다 — 논증에 쓰이지 않으면서 4번 재전송된다 (ADR-016)
    expect(prompt).not.toContain("sources");
    expect(prompt).not.toContain(MARKET_CONTEXT.sources[0]);
    expect(prompt).toContain(JSON.stringify(THESIS));
    expect(prompt).toContain(JSON.stringify(CRITICISM));

    // 개별 데이터 포함 재확인 (비판 claim·evidence·verdict, 낙관 논지)
    expect(prompt).toContain("산책 대행 수요는 죄책감 해소용 일시 수요다");
    expect(prompt).toContain("도그메이트가 이미 회당 2만원대로 운영 중이다");
    expect(prompt).toContain("현 구조로는 사업 성립이 어렵다");
    expect(prompt).toContain("죄책감이라는 강한 감정 트리거가 반복 결제를 이끈다");
  });
});

describe("SOLUTION_DESIGNER 프롬프트 (合 = 피벗 전략)", () => {
  it("合을 단순 절충이 아닌 피벗 전략으로 정의한다", () => {
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("피벗");
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("우회");
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("단순 절충");
  });

  it("synthesis를 필수로 요구한다", () => {
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("synthesis");
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("반드시");
  });

  it("평탄화된 criticism.points를 참조하고 severity로 대응 대상을 지정한다", () => {
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("criticism.points");
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("severity");
  });

  // ADR-011로 사라진 3그룹 배열을 프롬프트가 계속 가리키면 에이전트가 없는 필드를 읽으려 한다
  it.each(["painPointReality", "bmWeakness", "copycatRisk"])(
    "폐기된 Criticism 필드명 %s를 언급하지 않는다",
    (legacyField) => {
      expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).not.toContain(legacyField);
      expect(SOLUTION_DESIGNER_PROMPT_TEMPLATE).not.toContain(legacyField);
    },
  );
});

describe("결함↔해결책 원장 계약 (ADR-017)", () => {
  // 스키마가 이 이름들로 검증하고, 재시도 프롬프트가 이 이름들로 에러를 되먹인다 (ADR-004).
  // 프롬프트가 다른 말로 부르면 교정 요청이 가리키는 칸을 모델이 못 찾는다.
  it.each(["remedies", "respondsTo", "strategy", "remedy"])(
    "시스템 프롬프트가 스키마 필드명 %s를 글자 그대로 쓴다",
    (field) => {
      expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain(field);
    },
  );

  it("strategy의 enum 값과 한국어 라벨이 스키마의 단일 소스와 일치한다", () => {
    for (const strategy of REMEDY_STRATEGIES) {
      expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain(strategy);
    }
    for (const label of Object.values(REMEDY_STRATEGY_LABELS)) {
      expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain(label);
    }
  });

  it("fatal 전건에 remedies를 강제하고, major·minor는 강제하지 않는다", () => {
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toMatch(/fatal[\s\S]{0,80}각각/);
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("강제하지 않는다");
  });

  it("원장은 revisedConcept의 대체가 아니라 추가다", () => {
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("revisedConcept");
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).toContain("대체하지 않는다");
  });

  it("유저 프롬프트의 지시사항도 원장을 요구한다", () => {
    expect(SOLUTION_DESIGNER_PROMPT_TEMPLATE).toContain("remedies");
    expect(SOLUTION_DESIGNER_PROMPT_TEMPLATE).toContain("respondsTo");
  });

  // 못 풀어도 되는 출구를 주면 그 출구가 기본값이 된다 (ADR-017)
  it.each(["대응할 수 없는", "대응 불가능한", "한계를 명시", "얼버무리"])(
    "탈출구 문구 %s가 남아 있지 않다",
    (escapeHatch) => {
      expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).not.toContain(escapeHatch);
      expect(SOLUTION_DESIGNER_PROMPT_TEMPLATE).not.toContain(escapeHatch);
    },
  );
});

describe("정보 차단벽 — 재설계는 점수를 모른다 (ADR-017 / ADR-010)", () => {
  // 채점 기준을 아는 응시자는 답이 아니라 채점자를 겨냥한다.
  it.each([
    "survivalScore",
    "recommendation",
    "abandon",
    "점수",
    "밴드",
    "판정",
  ])("프롬프트가 %s를 언급하지 않는다", (forbidden) => {
    expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).not.toContain(forbidden);
    expect(SOLUTION_DESIGNER_PROMPT_TEMPLATE).not.toContain(forbidden);
  });

  // strategy는 "무엇을 했는가"이지 "성공했는가"가 아니다. 해소 여부는 판정의 말이다.
  it.each(["resolved", "fixed", "solved", "해소했", "해결됐"])(
    "성적 어휘 %s로 자기 채점을 유도하지 않는다",
    (gradeWord) => {
      expect(SOLUTION_DESIGNER_SYSTEM_PROMPT).not.toContain(gradeWord);
      expect(SOLUTION_DESIGNER_PROMPT_TEMPLATE).not.toContain(gradeWord);
    },
  );
});

describe("solutionSchemaFor 배선 (ADR-017)", () => {
  it("fatal 결함에 침묵한 재설계를 거부한다 — 빠진 id를 이름으로 지목한다", async () => {
    const { deps } = fakeDeps({ ...SOLUTION, remedies: [] });

    await expect(
      runSolutionDesigner(deps, IDEA, MARKET_CONTEXT, CRITICISM, THESIS),
    ).rejects.toThrow(/c2/);
  });

  it("fatal 하나만 채우고 나머지를 빠뜨린 재설계를 거부한다", async () => {
    const { deps } = fakeDeps(SOLUTION); // c2만 있다. TWO_FATAL_CRITICISM은 c3도 fatal이다

    await expect(
      runSolutionDesigner(
        deps,
        IDEA,
        MARKET_CONTEXT,
        TWO_FATAL_CRITICISM,
        THESIS,
      ),
    ).rejects.toThrow(/c3/);
  });

  it("fatal 전건을 채운 재설계는 통과한다", async () => {
    const { deps } = fakeDeps(SOLUTION);

    const result = await runSolutionDesigner(
      deps,
      IDEA,
      MARKET_CONTEXT,
      CRITICISM,
      THESIS,
    );

    expect(result.remedies.map((remedy) => remedy.respondsTo)).toEqual(["c2"]);
  });

  // 관대한 읽기 / 엄격한 쓰기 — 두 단계 엄격도는 설계이지 실수가 아니다 (ADR-017)
  it("정적 SolutionSchema를 그대로 넘기지 않는다 — 그건 fatal 침묵을 통과시킨다", async () => {
    const { deps, generateStructured } = fakeDeps();
    const silent = { ...SOLUTION, remedies: [] };

    await runSolutionDesigner(deps, IDEA, MARKET_CONTEXT, CRITICISM, THESIS);
    const { schema } = generateStructured.mock.calls[0][0];

    expect(SolutionSchema.safeParse(silent).success).toBe(true);
    expect(schema.safeParse(silent).success).toBe(false);
  });
});

describe("thinking 상한 (ADR-016)", () => {
  it("자기 budget 상수를 넘긴다 — 合은 리포트의 가장 중요한 섹션이라 끄지 않는다", async () => {
    const { deps, generateStructured } = fakeDeps();

    await runSolutionDesigner(deps, IDEA, MARKET_CONTEXT, CRITICISM, THESIS);

    expect(generateStructured.mock.calls[0][0].thinkingBudget).toBe(
      SOLUTION_DESIGNER_THINKING_BUDGET,
    );
    expect(SOLUTION_DESIGNER_THINKING_BUDGET).toBeGreaterThan(0);
  });
});
