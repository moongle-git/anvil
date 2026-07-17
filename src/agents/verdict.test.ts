import { describe, expect, it, vi } from "vitest";
import type {
  GeminiService,
  GenerateStructuredParams,
} from "../services/gemini.js";
import {
  RECOMMENDATIONS,
  RECOMMENDATION_SCORE_BANDS,
  REMEDY_STRATEGY_LABELS,
  REMEDY_VERDICTS,
  REMEDY_VERDICT_LABELS,
  VerdictSchema,
  type Criticism,
  toPromptContext,
  type MarketContext,
  type Solution,
  type Thesis,
  type Verdict,
} from "../types/index.js";
import {
  VERDICT_PROMPT_TEMPLATE,
  VERDICT_THINKING_BUDGET,
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

/** fatal이 c2 하나뿐인 CRITICISM으로는 재설계의 "침묵"을 표에 세울 수 없다 — c3도 fatal로 올린다 */
const TWO_FATAL_CRITICISM: Criticism = {
  ...CRITICISM,
  points: CRITICISM.points.map((point) =>
    point.id === "c3" ? { ...point, severity: "fatal" as const, riskScore: 74 } : point,
  ),
};

/** fatal이 하나도 없으면 대조할 것이 없다 */
const NO_FATAL_CRITICISM: Criticism = {
  ...CRITICISM,
  points: CRITICISM.points.map((point) =>
    point.severity === "fatal" ? { ...point, severity: "major" as const } : point,
  ),
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
  remedies: [
    {
      respondsTo: "c2",
      strategy: "bypass",
      remedy:
        "회당 수수료 전장을 떠나, 축적된 활동량 데이터를 펫 보험 언더라이팅 수수료로 수익화한다",
    },
  ],
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
  remedyAudits: [
    {
      criticismId: "c2",
      assessment: "solid",
      note: "수수료 전장을 실제로 떠나 보험 언더라이팅으로 수익원을 옮겼다",
    },
  ],
};

/** TWO_FATAL_CRITICISM을 쓰는 호출은 c3 감사까지 있어야 스키마를 통과한다 */
const TWO_FATAL_VERDICT: Verdict = {
  ...VERDICT,
  remedyAudits: [
    ...VERDICT.remedyAudits,
    {
      criticismId: "c3",
      assessment: "dismissed",
      note: "재설계가 해자 부재에 대해 아무 말도 하지 않았다",
    },
  ],
};

interface FakeDeps {
  deps: VerdictDeps;
  generateStructured: ReturnType<typeof vi.fn>;
}

/**
 * 실제 generateStructured는 넘겨받은 schema로 응답을 검증한 뒤에야 반환한다 (ADR-004).
 * fake도 그 계약을 지켜야 "어떤 스키마를 넘겼는가"가 행동으로 드러난다 — 스키마 객체
 * 동일성(toBe)을 단언하면 팩토리가 무엇을 강제하는지는 끝내 확인되지 않는다.
 */
function fakeDeps(response: unknown = VERDICT): FakeDeps {
  const generateStructured = vi.fn(
    async (params: GenerateStructuredParams<Verdict>) =>
      params.schema.parse(response),
  );
  return {
    deps: { gemini: { generateStructured } as unknown as GeminiService },
    generateStructured,
  };
}

async function callVerdict(
  criticism: Criticism = CRITICISM,
  solution: Solution = SOLUTION,
  response: unknown = VERDICT,
): Promise<{
  result: Verdict;
  generateStructured: ReturnType<typeof vi.fn>;
}> {
  const { deps, generateStructured } = fakeDeps(response);
  const result = await runVerdict(
    deps,
    IDEA,
    MARKET_CONTEXT,
    THESIS,
    criticism,
    solution,
  );
  return { result, generateStructured };
}

describe("runVerdict", () => {
  it("grounding 없이 Verdict 스키마로 Gemini를 1회 호출하고 결과를 그대로 반환한다", async () => {
    const { result, generateStructured } = await callVerdict();

    expect(result).toEqual(VERDICT);
    expect(VerdictSchema.safeParse(result).success).toBe(true);

    // 이 단계는 새 사실을 검색하지 않고 앞 4단계를 종합한다 (ADR-010)
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("유저 프롬프트에 아이디어와 앞 4단계 산출물이 유실 없이 직렬화된다", async () => {
    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).toContain(IDEA);
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
    expect(prompt).toContain(JSON.stringify(SOLUTION));

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

  it("conditions는 검증 가능한 조건이어야 한다고 지시한다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("검증 가능");
    expect(VERDICT_SYSTEM_PROMPT).toContain("희망");
  });
});

describe("fatal 대조표 — 코드가 소유하는 것은 침묵뿐이다 (ADR-017)", () => {
  it("재설계가 침묵한 fatal을 '해결책 없음'으로 표시한다", async () => {
    // c2에만 해결책이 있고 c3(fatal)에는 없다. 그 부재는 두 JSON 어디에도 적혀 있지 않고
    // 문서 *사이*의 빈틈으로만 존재한다 — 그래서 코드가 뺄셈을 대신 해준다.
    const { generateStructured } = await callVerdict(
      TWO_FATAL_CRITICISM,
      SOLUTION,
      TWO_FATAL_VERDICT,
    );
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).toContain(
      "**해결책 없음 — 재설계는 이 결함에 대해 아무 말도 하지 않았다**",
    );
    // 침묵한 행은 c3다. c2는 해결책이 있으므로 그 자리에 원문이 온다
    expect(prompt).toMatch(/\| c3 \|[^\n]*해결책 없음/);
    expect(prompt).toMatch(/\| c2 \|[^\n]*회당 수수료 전장을 떠나/);
  });

  it("해결책이 있는 fatal은 strategy 라벨과 함께 한 행으로 온다", async () => {
    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).toContain("코드가 두 산출물을 대조해 만든 표다");
    expect(prompt).toContain(`| c2 | ${CRITICISM.points[1].riskKeyword} |`);
    expect(prompt).toContain(REMEDY_STRATEGY_LABELS.bypass);
    expect(prompt).toContain(SOLUTION.remedies[0].remedy);

    // "해결책 없음"은 표 아래 안내문에도 나오므로 프롬프트 전체가 아니라 행을 봐야 한다
    const rows = prompt.split("\n").filter((line) => line.startsWith("| "));
    expect(rows.join("\n")).not.toContain("해결책 없음");
  });

  it("표에는 fatal만 오른다 — major·minor는 강제 대상이 아니다", async () => {
    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    const table = prompt
      .split("\n")
      .filter((line) => line.startsWith("| "));

    expect(table).toHaveLength(1);
    expect(table[0]).toContain("| c2 |");
    // c1(major)·c3(minor)는 criticism JSON에는 있지만 표에는 없다
    expect(table.join("\n")).not.toContain("| c1 |");
    expect(table.join("\n")).not.toContain("| c3 |");
  });

  it("표의 해결책을 사실이 아니라 재설계의 자기보고로 귀속한다", async () => {
    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    // ADR-017의 정직함이 프롬프트에 드러나는 자리다 — 코드가 증명할 수 있는 것은 부재뿐이다
    expect(prompt).toContain(
      '"재설계의 해결책"은 재설계의 자기보고이지 사실이 아니다',
    );
    expect(prompt).toContain('코드가 확인한 사실은 "해결책 없음" 하나뿐이다');
    // "재설계가 c2를 우회했다"가 아니라 "우회했다고 주장한다"로 읽혀야 한다
    expect(prompt).toContain("재설계의 해결책 주장");
  });

  it("fatal이 0건이면 빈 표를 렌더하지 않는다", async () => {
    const { generateStructured } = await callVerdict(NO_FATAL_CRITICISM);
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt).not.toContain("코드가 두 산출물을 대조해 만든 표다");
    expect(prompt).not.toContain("해결책 없음");
    expect(prompt).not.toContain("{fatalLedger}");
    expect(prompt.split("\n").filter((line) => line.startsWith("| "))).toEqual(
      [],
    );
  });

  it("줄바꿈이 든 비판·해결책이 표의 행을 무너뜨리지 않는다", async () => {
    const multiline: Criticism = {
      ...CRITICISM,
      points: CRITICISM.points.map((point) =>
        point.id === "c2" ? { ...point, claim: "첫 줄\n둘째 줄" } : point,
      ),
    };
    const { generateStructured } = await callVerdict(multiline);
    const prompt = generateStructured.mock.calls[0][0].prompt as string;

    expect(prompt.split("\n").filter((line) => line.startsWith("| "))).toEqual([
      expect.stringContaining("첫 줄"),
    ]);
  });
});

describe("VERDICT_PROMPT_TEMPLATE — 대조표 자리", () => {
  it("{fatalLedger} 플레이스홀더를 갖고, 치환 후 남지 않는다", async () => {
    expect(VERDICT_PROMPT_TEMPLATE).toContain("{fatalLedger}");

    const { generateStructured } = await callVerdict();
    const prompt = generateStructured.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("{fatalLedger}");
  });
});

describe("감사 계약 (ADR-017)", () => {
  // 스키마가 이 이름들로 검증하고, 재시도 프롬프트가 이 이름들로 에러를 되먹인다 (ADR-004).
  // 프롬프트가 다른 말로 부르면 교정 요청이 가리키는 칸을 모델이 못 찾는다.
  it.each(["remedyAudits", "criticismId", "assessment", "note"])(
    "시스템 프롬프트가 스키마 필드명 %s를 글자 그대로 쓴다",
    (field) => {
      expect(VERDICT_SYSTEM_PROMPT).toContain(field);
    },
  );

  it("assessment의 enum 값과 한국어 라벨이 스키마의 단일 소스와 일치한다", () => {
    for (const assessment of REMEDY_VERDICTS) {
      expect(VERDICT_SYSTEM_PROMPT).toContain(assessment);
    }
    for (const label of Object.values(REMEDY_VERDICT_LABELS)) {
      expect(VERDICT_SYSTEM_PROMPT).toContain(label);
    }
  });

  it("fatal 전건에 감사를 강제한다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toMatch(/fatal[\s\S]{0,80}각각/);
    expect(VERDICT_PROMPT_TEMPLATE).toContain("remedyAudits");
  });

  it("restated·dismissed의 판별 기준을 실측 실패 양태로 못박는다", () => {
    // 6af78e에서 승인된 두 말장난 — 수식어만 붙인 재주장과 우려 기각
    expect(VERDICT_SYSTEM_PROMPT).toContain("수식어만");
    expect(VERDICT_SYSTEM_PROMPT).toContain("과장");
  });

  it("residualRisks가 비판에서 유래했으면 criticismId를 밝힐 수 있다고 알린다", () => {
    expect(VERDICT_SYSTEM_PROMPT).toContain("residualRisks");
    expect(VERDICT_SYSTEM_PROMPT).toContain("criticismId");
    // 피벗이 새로 만든 리스크는 어느 비판에도 속하지 않는다 — 자동 생성 금지의 근거
    expect(VERDICT_SYSTEM_PROMPT).toContain("피벗이 새로 만든 리스크");
  });
});

describe("floor 폐기 — 점수는 판정의 판단이다 (ADR-010 / ADR-017)", () => {
  // "잔존 fatal → 40점 미만"은 피벗 이전의 사망선고를 코드로 자동화하는 것이라 ADR-010 위반이고,
  // 실측상 잔존 fatal을 정직하게 보고한 유일한 run만 처벌한다.
  it.each([
    `${RECOMMENDATION_SCORE_BANDS.pivot.min} 미만`,
    "미만이어야 한다",
  ])("프롬프트에 floor 문구 %s가 없다", (floorPhrase) => {
    expect(VERDICT_SYSTEM_PROMPT).not.toContain(floorPhrase);
    expect(VERDICT_PROMPT_TEMPLATE).not.toContain(floorPhrase);
  });

  it("스키마도 점수 하한을 강제하지 않는다 — 잔존 fatal을 solid 아닌 값으로 감사해도 점수는 자유다", async () => {
    const honest = {
      ...VERDICT,
      survivalScore: 88,
      recommendation: "proceed" as const,
      remedyAudits: [
        { criticismId: "c2", assessment: "dismissed" as const, note: "풀지 않고 넘어갔다" },
      ],
    };

    const { result } = await callVerdict(CRITICISM, SOLUTION, honest);

    expect(result.survivalScore).toBe(88);
  });
});

describe("verdictSchemaFor 배선 (ADR-017)", () => {
  it("fatal 감사를 빠뜨린 판정을 거부한다 — 빠진 id를 이름으로 지목한다", async () => {
    const { deps } = fakeDeps({ ...VERDICT, remedyAudits: [] });

    await expect(
      runVerdict(deps, IDEA, MARKET_CONTEXT, THESIS, CRITICISM, SOLUTION),
    ).rejects.toThrow(/c2/);
  });

  it("fatal 하나만 감사하고 나머지를 빠뜨린 판정을 거부한다", async () => {
    const { deps } = fakeDeps(VERDICT); // c2만 감사한다. TWO_FATAL_CRITICISM은 c3도 fatal이다

    await expect(
      runVerdict(
        deps,
        IDEA,
        MARKET_CONTEXT,
        THESIS,
        TWO_FATAL_CRITICISM,
        SOLUTION,
      ),
    ).rejects.toThrow(/c3/);
  });

  // 관대한 읽기 / 엄격한 쓰기 — 두 단계 엄격도는 설계이지 실수가 아니다 (ADR-017)
  it("정적 VerdictSchema를 그대로 넘기지 않는다 — 그건 fatal 침묵을 통과시킨다", async () => {
    const { generateStructured } = await callVerdict();
    const silent = { ...VERDICT, remedyAudits: [] };
    const { schema } = generateStructured.mock.calls[0][0];

    expect(VerdictSchema.safeParse(silent).success).toBe(true);
    expect(schema.safeParse(silent).success).toBe(false);
  });
});

describe("thinking 상한 (ADR-016)", () => {
  it("자기 budget 상수를 넘긴다 — 판정 품질 때문에 분리한 에이전트다 (ADR-010)", async () => {
    const { generateStructured } = await callVerdict();

    expect(generateStructured.mock.calls[0][0].thinkingBudget).toBe(
      VERDICT_THINKING_BUDGET,
    );
    expect(VERDICT_THINKING_BUDGET).toBeGreaterThan(0);
  });
});
