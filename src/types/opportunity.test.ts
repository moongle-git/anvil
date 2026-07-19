import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CapitalSignalSchema,
  FigureSchema,
  HORIZONS,
  OpportunitiesSchema,
  OpportunityDraftSchema,
  OpportunitySchema,
  OpportunitySelectionSchema,
  SIGNAL_TYPES,
  ScoutDossierSchema,
  ScoutQueriesSchema,
  opportunitiesSchemaFor,
  type ScoutConstraints,
} from "./opportunity.js";

const NOW = new Date("2026-07-19T00:00:00.000Z");
const WINDOW_START = new Date("2026-01-19T00:00:00.000Z");

const constraints: ScoutConstraints = {
  citationIds: ["C1", "C2", "C3"],
  now: NOW,
  windowStart: WINDOW_START,
};

const fundingSignal = {
  signalType: "funding",
  statement: "물류 자동화 스타트업에 시리즈B 라운드가 연이어 집행됐다.",
  observedAt: "2026-05-14",
  citationRef: "C1",
  figures: [],
} as const;

const incumbentSignal = {
  signalType: "incumbent",
  statement:
    "대형 3PL 사업자가 실적발표에서 창고 자동화 capex를 늘리겠다고 밝혔다.",
  observedAt: "2026-06-02",
  citationRef: "C2",
  figures: [],
} as const;

const counterSignal = {
  signalType: "costCurve",
  statement: "동일 구간 자동화 단가는 아직 인건비 아래로 내려오지 않았다.",
  observedAt: "2026-04-01",
  citationRef: "C3",
  figures: [],
} as const;

const candidate = {
  id: "O1",
  title: "중견 물류창고용 자동화 도입 진단 서비스",
  whatItIs:
    "창고 레이아웃과 물동량을 입력하면 자동화 투자 회수 구간을 산출하는 서비스다.",
  signals: [fundingSignal, incumbentSignal],
  counterSignal,
  whyNow: "자본은 이미 움직였는데 도입 판단 근거는 여전히 컨설팅 견적에 묶여 있다.",
  whoPays: "자동화 도입을 검토 중인 중견 3PL의 운영 총괄.",
  horizon: "mid",
} as const;

const draft = { candidates: [candidate] };

/** 최종형(코드가 ref를 해소한 뒤) 인용 객체 */
const citation = {
  uri: "https://example.com/report",
  title: "물류 자동화 투자 동향",
  kind: "origin",
} as const;

function withSignals(
  signals: readonly unknown[],
  counter: unknown = counterSignal,
) {
  return { candidates: [{ ...candidate, signals, counterSignal: counter }] };
}

function messageOf(result: z.ZodSafeParseResult<unknown>): string {
  if (result.success) throw new Error("검증이 실패해야 하는데 통과했다");
  return z.prettifyError(result.error);
}

describe("SIGNAL_TYPES · HORIZONS", () => {
  it("자본 신호 4종을 담는다", () => {
    expect(SIGNAL_TYPES).toEqual([
      "funding",
      "incumbent",
      "regulation",
      "costCurve",
    ]);
  });

  it("시간 지평 3종을 담는다", () => {
    expect(HORIZONS).toEqual(["short", "mid", "long"]);
  });
});

describe("FigureSchema", () => {
  it("수치 표기와 귀속 ref를 요구한다", () => {
    expect(
      FigureSchema.safeParse({ value: "$4.2B", citationRef: "C1" }).success,
    ).toBe(true);
  });

  it.each(["value", "citationRef"] as const)("빈 %s를 거부한다", (field) => {
    expect(
      FigureSchema.safeParse({ value: "$4.2B", citationRef: "C1", [field]: "" })
        .success,
    ).toBe(false);
  });
});

describe("CapitalSignalSchema (정적)", () => {
  it("유효한 신호를 허용한다", () => {
    expect(CapitalSignalSchema.safeParse(fundingSignal).success).toBe(true);
  });

  it("figures가 없으면 빈 배열로 채운다", () => {
    const withoutFigures: Record<string, unknown> = { ...fundingSignal };
    delete withoutFigures.figures;
    expect(CapitalSignalSchema.parse(withoutFigures).figures).toEqual([]);
  });

  it("effectiveAt·quote는 선택이다", () => {
    expect(
      CapitalSignalSchema.safeParse({
        ...fundingSignal,
        effectiveAt: "2027-01-01",
        quote: "The round was led by an existing investor.",
      }).success,
    ).toBe(true);
  });

  it("정의되지 않은 signalType을 거부한다", () => {
    expect(
      CapitalSignalSchema.safeParse({ ...fundingSignal, signalType: "hype" })
        .success,
    ).toBe(false);
  });

  it("정적 스키마는 날짜 범위를 강제하지 않는다 — 엄격함은 팩토리에만 산다", () => {
    expect(
      CapitalSignalSchema.safeParse({ ...fundingSignal, observedAt: "2001-01-01" })
        .success,
    ).toBe(true);
  });
});

describe("OpportunityDraftSchema", () => {
  it("유효한 후보를 허용한다", () => {
    expect(OpportunityDraftSchema.safeParse(candidate).success).toBe(true);
  });

  it("신호가 1개뿐이면 거부한다 (삼각측량의 최소 조건)", () => {
    expect(
      OpportunityDraftSchema.safeParse({ ...candidate, signals: [fundingSignal] })
        .success,
    ).toBe(false);
  });

  it("counterSignal이 없으면 거부한다 — 불리한 증거는 필수다", () => {
    const withoutCounter: Record<string, unknown> = { ...candidate };
    delete withoutCounter.counterSignal;
    expect(OpportunityDraftSchema.safeParse(withoutCounter).success).toBe(false);
  });

  it.each(["id", "title", "whatItIs", "whyNow", "whoPays"] as const)(
    "빈 %s를 거부한다",
    (field) => {
      expect(
        OpportunityDraftSchema.safeParse({ ...candidate, [field]: "" }).success,
      ).toBe(false);
    },
  );

  it("점수·순위 필드는 스키마에 없다 — 결론은 verdict의 몫이다 (ADR-010)", () => {
    const shape = OpportunityDraftSchema.shape;
    expect(shape).not.toHaveProperty("score");
    expect(shape).not.toHaveProperty("rank");
  });
});

describe("OpportunitySchema (최종형)", () => {
  const resolvedSignal = {
    signalType: "funding",
    statement: fundingSignal.statement,
    observedAt: fundingSignal.observedAt,
    citation,
    figures: [{ value: "$4.2B", citation }],
  };

  const resolved = {
    ...candidate,
    signals: [resolvedSignal, { ...resolvedSignal, signalType: "incumbent" }],
    counterSignal: { ...resolvedSignal, signalType: "costCurve", figures: [] },
  };

  it("해소된 인용 객체를 가진 후보를 허용한다", () => {
    expect(OpportunitySchema.safeParse(resolved).success).toBe(true);
  });

  it("citationRef 문자열이 최종형에 남지 않는다 (ref는 dossier 내부 좌표다)", () => {
    const parsed = OpportunitySchema.parse(resolved);
    expect(parsed.signals[0]).not.toHaveProperty("citationRef");
    expect(parsed.signals[0].figures[0]).not.toHaveProperty("citationRef");
    expect(parsed.counterSignal).not.toHaveProperty("citationRef");
  });

  it("해소되지 않은 draft(citationRef만 있는 신호)를 거부한다", () => {
    expect(OpportunitySchema.safeParse(candidate).success).toBe(false);
  });
});

describe("OpportunitiesSchema", () => {
  const valid = {
    candidates: [],
    scope: "전 범위 탐색",
    searchedAt: "2026-07-19T00:00:00.000Z",
  };

  it("빈 후보 목록을 허용한다 — 침묵할 수 있어야 지어내지 않는다", () => {
    expect(OpportunitiesSchema.safeParse(valid).success).toBe(true);
  });

  it("후보가 6개면 거부한다", () => {
    const six = Array.from({ length: 6 }, () => ({
      ...candidate,
      signals: [],
      counterSignal: {},
    }));
    expect(OpportunitiesSchema.safeParse({ ...valid, candidates: six }).success).toBe(
      false,
    );
  });

  it("scope·searchedAt이 없으면 거부한다 (코드가 채우는 사실이다)", () => {
    for (const field of ["scope", "searchedAt"] as const) {
      const partial: Record<string, unknown> = { ...valid };
      delete partial[field];
      expect(OpportunitiesSchema.safeParse(partial).success).toBe(false);
    }
  });
});

describe("OpportunitySelectionSchema", () => {
  it("사용자가 고른 후보 id를 담는다", () => {
    expect(OpportunitySelectionSchema.safeParse({ candidateId: "O2" }).success).toBe(
      true,
    );
  });

  it("빈 candidateId를 거부한다", () => {
    expect(OpportunitySelectionSchema.safeParse({ candidateId: "" }).success).toBe(
      false,
    );
  });
});

describe("ScoutQueriesSchema", () => {
  const queries = {
    funding: ["물류 자동화 시리즈B"],
    incumbent: ["3PL capex guidance"],
    regulation: ["생활물류서비스법 시행"],
    costCurve: ["warehouse robot price per pick"],
  };

  it("4개 축의 검색어를 모두 요구한다", () => {
    expect(ScoutQueriesSchema.safeParse(queries).success).toBe(true);
  });

  it.each(["funding", "incumbent", "regulation", "costCurve"] as const)(
    "%s 축이 비면 거부한다",
    (axis) => {
      expect(ScoutQueriesSchema.safeParse({ ...queries, [axis]: [] }).success).toBe(
        false,
      );
    },
  );
});

describe("ScoutDossierSchema", () => {
  it("사실 목록을 담는다 — 후보가 아니다", () => {
    const result = ScoutDossierSchema.safeParse({
      findings: [
        {
          signalType: "regulation",
          statement: "개정 생활물류서비스법 시행일이 확정됐다.",
          observedAt: "2026-06-30",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("findings가 없으면 빈 배열로 채운다 — 아무것도 못 찾는 것이 합법이다", () => {
    expect(ScoutDossierSchema.parse({}).findings).toEqual([]);
  });

  it("후보 필드(title·whoPays)는 dossier에 없다", () => {
    const parsed = ScoutDossierSchema.parse({
      findings: [
        {
          signalType: "funding",
          statement: "라운드가 집행됐다.",
          title: "무시되어야 한다",
          whoPays: "무시되어야 한다",
        },
      ],
    });
    expect(parsed.findings[0]).not.toHaveProperty("title");
    expect(parsed.findings[0]).not.toHaveProperty("whoPays");
  });
});

describe("opportunitiesSchemaFor — (1) 인용 화이트리스트", () => {
  it("화이트리스트 안의 ref만 쓰면 통과한다", () => {
    expect(opportunitiesSchemaFor(constraints).safeParse(draft).success).toBe(true);
  });

  it("signals의 화이트리스트 밖 ref를 거부하고 그 ref를 지목한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([{ ...fundingSignal, citationRef: "C9" }, incumbentSignal]),
    );
    expect(messageOf(result)).toContain("C9");
  });

  it("에러 메시지에 유효한 ref 목록 전체를 적는다 (재시도 피드백)", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([{ ...fundingSignal, citationRef: "C9" }, incumbentSignal]),
    );
    const message = messageOf(result);
    for (const id of constraints.citationIds) {
      expect(message).toContain(id);
    }
  });

  it("counterSignal의 화이트리스트 밖 ref를 거부한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals(candidate.signals, { ...counterSignal, citationRef: "C9" }),
    );
    expect(messageOf(result)).toContain("C9");
  });

  it("figures의 화이트리스트 밖 ref를 거부한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([
        {
          ...fundingSignal,
          statement: "라운드에 $4.2B가 유입됐다.",
          figures: [{ value: "$4.2B", citationRef: "C9" }],
        },
        incumbentSignal,
      ]),
    );
    expect(messageOf(result)).toContain("C9");
  });

  it("인용이 하나도 없으면 근거를 단 후보가 전부 실패한다", () => {
    const noCitations = { ...constraints, citationIds: [] };
    expect(opportunitiesSchemaFor(noCitations).safeParse(draft).success).toBe(false);
  });
});

describe("opportunitiesSchemaFor — (2) 삼각측량", () => {
  it("signalType이 1종뿐이면 거부한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([
        fundingSignal,
        { ...fundingSignal, citationRef: "C2", statement: "다른 라운드도 집행됐다." },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it("signalType이 2종이어도 citationRef가 같은 1개면 거부한다 (라벨 우회 차단)", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([fundingSignal, { ...incumbentSignal, citationRef: "C1" }]),
    );
    expect(result.success).toBe(false);
  });

  it("counterSignal은 삼각측량 계산에 넣지 않는다", () => {
    // signals는 같은 타입 1종 · counterSignal이 다른 타입이어도 실패해야 한다
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([
        fundingSignal,
        { ...fundingSignal, citationRef: "C2", statement: "또 다른 라운드." },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it("타입 2종 · ref 2개면 통과한다", () => {
    expect(opportunitiesSchemaFor(constraints).safeParse(draft).success).toBe(true);
  });
});

describe("opportunitiesSchemaFor — (3) 날짜", () => {
  it("observedAt이 미래면 거부한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([{ ...fundingSignal, observedAt: "2026-09-01" }, incumbentSignal]),
    );
    expect(result.success).toBe(false);
  });

  it("observedAt이 windowStart 이전이면 거부한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([{ ...fundingSignal, observedAt: "2024-03-01" }, incumbentSignal]),
    );
    expect(result.success).toBe(false);
  });

  it("파싱할 수 없는 observedAt을 거부한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([{ ...fundingSignal, observedAt: "작년 봄" }, incumbentSignal]),
    );
    expect(result.success).toBe(false);
  });

  it("effectiveAt이 미래여도 통과한다 — 시행 예정 규제가 가장 가치 있는 신호다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals([
        {
          ...fundingSignal,
          signalType: "regulation",
          statement: "개정법 시행일이 확정됐다.",
          effectiveAt: "2027-01-01",
        },
        incumbentSignal,
      ]),
    );
    expect(result.success).toBe(true);
  });

  it("counterSignal의 observedAt도 검사한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals(candidate.signals, { ...counterSignal, observedAt: "2024-03-01" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("opportunitiesSchemaFor — (4) 수치 귀속", () => {
  function statementOf(statement: string, figures: readonly unknown[] = []) {
    return withSignals([{ ...fundingSignal, statement, figures }, incumbentSignal]);
  }

  it.each([
    "라운드에 $4.2B가 유입됐다.",
    "전년 대비 23% 늘었다.",
    "누적 투자액이 1,200억 원을 넘었다.",
    "시장 규모가 4.2 billion 규모로 추정된다.",
    // 조사가 붙어도 놓치지 않는다 — 한국어에서 가장 흔한 형태다
    "가격이 5,000원으로 내렸다.",
    "누적 1,200억을 투입했다.",
  ])("귀속 없는 수치 표기 '%s'를 거부한다", (statement) => {
    expect(
      opportunitiesSchemaFor(constraints).safeParse(statementOf(statement)).success,
    ).toBe(false);
  });

  it("귀속되지 않은 표기를 에러 메시지에 그대로 인용한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      statementOf("라운드에 $4.2B가 유입됐다."),
    );
    expect(messageOf(result)).toContain("$4.2B");
  });

  it.each([
    ["라운드에 $4.2B가 유입됐다.", "$4.2B"],
    ["전년 대비 23% 늘었다.", "23%"],
    ["누적 투자액이 1,200억 원을 넘었다.", "1,200억 원"],
  ])("귀속된 수치 '%s'는 통과한다", (statement, value) => {
    expect(
      opportunitiesSchemaFor(constraints).safeParse(
        statementOf(statement, [{ value, citationRef: "C1" }]),
      ).success,
    ).toBe(true);
  });

  it.each([
    "3가지 축에서 2배로 늘었다.",
    "2026년 1분기에 발표됐다.",
    "1~2문장으로 요약된다.",
    "상위 3개 사업자가 주도한다.",
    "10만 명이 사용한다.",
    "도입 기간이 6개월에서 2주로 줄었다.",
    "처리량이 2배, 지연은 1/3로 개선됐다.",
    "3엔진 구성으로 전환했다.",
  ])("금액·퍼센트가 아닌 수치 '%s'는 통과한다 (오탐 없음)", (statement) => {
    expect(
      opportunitiesSchemaFor(constraints).safeParse(statementOf(statement)).success,
    ).toBe(true);
  });

  it("counterSignal의 statement도 검사한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse(
      withSignals(candidate.signals, {
        ...counterSignal,
        statement: "단가는 여전히 30% 높다.",
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe("opportunitiesSchemaFor — 구조·통합", () => {
  it("빈 후보 목록은 통과한다 — min(1)을 붙이지 않는다", () => {
    expect(
      opportunitiesSchemaFor(constraints).safeParse({ candidates: [] }).success,
    ).toBe(true);
  });

  it("인용이 하나도 없어도 빈 후보 목록은 통과한다", () => {
    expect(
      opportunitiesSchemaFor({ ...constraints, citationIds: [] }).safeParse({
        candidates: [],
      }).success,
    ).toBe(true);
  });

  it("문제가 있는 후보의 인덱스를 path로 지목한다", () => {
    const result = opportunitiesSchemaFor(constraints).safeParse({
      candidates: [candidate, { ...candidate, id: "O2", signals: [fundingSignal, { ...fundingSignal, citationRef: "C9" }] }],
    });
    expect(messageOf(result)).toContain("candidates");
  });

  it("정적 스키마의 필드 검증을 그대로 물려받는다", () => {
    expect(
      opportunitiesSchemaFor(constraints).safeParse({
        candidates: [{ ...candidate, title: "" }],
      }).success,
    ).toBe(false);
  });

  it("Gemini 구조화 출력 경로: z.toJSONSchema가 throw하지 않는다", () => {
    expect(() => z.toJSONSchema(opportunitiesSchemaFor(constraints))).not.toThrow();
  });
});
