import { z, type ZodType } from "zod";
import { CitationSchema } from "./marketContext.js";

/**
 * trend-scout(주제 발굴)의 산출물 스키마.
 *
 * 이 파이프라인에서 환각 위험이 가장 높은 자리다 — 모델은 훈련 데이터의 과거 트렌드를 현재로
 * 착각해 뱉고, 그럴듯한 숫자와 URL을 지어낸다. 그래서 **환각 방어는 프롬프트가 아니라 스키마다**:
 * 코드가 검사할 수 있는 것은 전부 opportunitiesSchemaFor의 제약으로 만들고, 검증 실패는
 * ADR-004의 자가 교정 재시도를 그대로 탄다(에러 메시지가 곧 재시도 피드백이다).
 *
 * 코드가 소유하는 경계는 ADR-013이 정한 그대로다:
 * - 보장 가능 — 모든 주장이 **실제로 검색된 문서를 가리키는가** (참조 무결성·귀속·구조)
 * - 보장 불가 — 그 문서가 **정말 그 말을 하는가**
 * 후자를 스키마로 잡으려 들지 않는다. 주입할 사실이 없는 판단은 코드의 것이 아니다.
 */

export const SIGNAL_TYPES = [
  "funding", // 섹터별 투자 라운드·M&A
  "incumbent", // 기존 기업의 capex 가이던스·실적발표 전략 언급
  "regulation", // 시행일이 확정된 규제
  "costCurve", // 단가가 임계선을 넘은 시점
] as const;
export const SignalTypeSchema = z.enum(SIGNAL_TYPES);
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const HORIZONS = ["short", "mid", "long"] as const;
export const HorizonSchema = z.enum(HORIZONS);
export type Horizon = (typeof HORIZONS)[number];

/** 한국어 라벨 단일 소스 — 리포트·웹이 함께 쓴다 */
export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  funding: "투자",
  incumbent: "기존 기업",
  regulation: "규제",
  costCurve: "비용 곡선",
};

export const HORIZON_LABELS: Record<Horizon, string> = {
  short: "단기",
  mid: "중기",
  long: "장기",
};

/**
 * 산문에 등장한 수치와 그 출처. value는 statement에 쓴 표기 그대로다 —
 * 코드가 "이 수치가 어디서 왔는가"를 대조할 수 있으려면 두 문자열이 같은 모양이어야 한다.
 */
export const FigureSchema = z.object({
  /** 산문에 등장한 수치 표기 그대로 (예: "$4.2B", "23%") */
  value: z.string().min(1),
  /** dossier 인용 ID ("C3"). 유효성은 opportunitiesSchemaFor가 검증한다 */
  citationRef: z.string().min(1),
});
export type Figure = z.infer<typeof FigureSchema>;

/**
 * 자본이 움직였다는 사실 하나. observedAt이 필수인 것은 형식 검사가 아니라
 * **검색 없이는 채울 수 없는 필드를 만드는 것**이 목적이다 — 모델의 사전지식에는 날짜가 붙어 있지 않다.
 */
export const CapitalSignalSchema = z.object({
  signalType: SignalTypeSchema,
  /** 이 신호가 말하는 사실 1~2문장 */
  statement: z.string().min(1),
  /** ISO date. 이 사실이 보도·공시된 시점 — 반드시 과거다 */
  observedAt: z.string(),
  /** 규제 시행일 등. 미래여도 된다 */
  effectiveAt: z.string().optional(),
  citationRef: z.string().min(1),
  figures: z.array(FigureSchema).default([]),
  /** 출처에서 그대로 딴 문장. 원문 대조가 가능한 신호인지를 하류가 판단할 수 있게 남긴다 */
  quote: z.string().optional(),
});
export type CapitalSignal = z.infer<typeof CapitalSignalSchema>;

/**
 * LLM이 채우는 형태. 인용은 ID로만 지목하고 실체(URL·제목)는 코드가 채운다 (ADR-013) —
 * LLM에게 URL을 받아적게 하면 `cloud.google.google.com`이 나온다.
 *
 * 점수·순위·랭킹 필드는 없다. 파이프라인 완주 전에 결론이 나오면 verdict가 할 일이 없어진다 (ADR-010).
 */
export const OpportunityDraftSchema = z.object({
  /** "O1" 등. 사용자 선택이 이 값을 지목한다 */
  id: z.string().min(1),
  title: z.string().min(1),
  /** 무엇을 만드는 서비스인가 1~2문장 */
  whatItIs: z.string().min(1),
  /** 삼각측량의 최소 조건. 종류·출처가 갈리는지는 팩토리가 검증한다 */
  signals: z.array(CapitalSignalSchema).min(2),
  /** 이 주제에 불리한 증거. 필수다 — 반대 증거를 못 찾는 주제는 검색되지 않은 주제다 */
  counterSignal: CapitalSignalSchema,
  /** 왜 지금인가 (타이밍) */
  whyNow: z.string().min(1),
  /** 누가 돈을 내나 */
  whoPays: z.string().min(1),
  horizon: HorizonSchema,
});
export type OpportunityDraft = z.infer<typeof OpportunityDraftSchema>;

// ── 최종형: 코드가 citationRef를 실제 Citation으로 해소한 뒤 ──
// MarketContextDraftSchema → MarketContextObjectSchema와 같은 분리다.
// ref는 dossier 내부 좌표이지 산출물이 아니므로, 최종형에 문자열로 남기지 않는다 —
// 해소된 citation과 나란히 두면 같은 사실에 대한 두 개의 진실이 된다.

export const ResolvedFigureSchema = FigureSchema.omit({
  citationRef: true,
}).extend({
  citation: CitationSchema,
});
export type ResolvedFigure = z.infer<typeof ResolvedFigureSchema>;

export const ResolvedCapitalSignalSchema = CapitalSignalSchema.omit({
  citationRef: true,
}).extend({
  citation: CitationSchema,
  figures: z.array(ResolvedFigureSchema).default([]),
});
export type ResolvedCapitalSignal = z.infer<typeof ResolvedCapitalSignalSchema>;

export const OpportunitySchema = OpportunityDraftSchema.omit({
  signals: true,
  counterSignal: true,
}).extend({
  signals: z.array(ResolvedCapitalSignalSchema).min(2),
  counterSignal: ResolvedCapitalSignalSchema,
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

/** LLM이 채우는 부분은 candidates뿐이다 — scope·searchedAt은 코드가 아는 사실이다 */
export const OpportunitiesDraftSchema = z.object({
  candidates: z.array(OpportunityDraftSchema).max(5),
});
export type OpportunitiesDraft = z.infer<typeof OpportunitiesDraftSchema>;

/**
 * 저장·소비되는 최종 형태.
 *
 * candidates에 min(1)이 없는 것은 실수가 아니라 장치다. 빈손으로 돌아올 길이 없는 시스템에서
 * 모델은 반드시 무언가를 내놓게 되고, 그때 나오는 것이 환각이다. **침묵할 수 있어야 지어내지 않는다.**
 */
export const OpportunitiesSchema = z.object({
  candidates: z.array(OpportunitySchema).max(5),
  /** 사용자가 준 범위 힌트. 없으면 "전 범위 탐색" */
  scope: z.string(),
  /** ISO datetime. 이 탐색이 언제의 자본 흐름인지를 못박는다 */
  searchedAt: z.string(),
});
export type Opportunities = z.infer<typeof OpportunitiesSchema>;

/**
 * 리포트 렌더러가 받는 얇은 뷰 — 확정된 주제 하나와 그것이 나온 탐색의 좌표.
 *
 * 스키마가 아니라 인터페이스인 것은 이것이 저장되는 아티팩트가 아니라 **파생**이기 때문이다
 * (LedgerEntry와 같은 자리). 렌더러에 Opportunities를 통째로 넘기면 고르지 않은 후보들까지
 * 알게 되고, 그러면 리포트가 "왜 이것을 골랐나"를 논증하려 든다 — 그건 판정의 일이다.
 */
export interface ScoutOrigin {
  /** 사용자가 준 범위 힌트. 없으면 "전 범위 탐색" */
  scope: string;
  /** ISO datetime. 이 주제가 언제의 자본 흐름에서 나왔는지 */
  searchedAt: string;
  /** 사람이 고른 후보 */
  opportunity: Opportunity;
}

/** 사람이 제출하는 아티팩트 — 고른 후보가 runs.idea로 확정된다 */
export const OpportunitySelectionSchema = z.object({
  candidateId: z.string().min(1),
});
export type OpportunitySelection = z.infer<typeof OpportunitySelectionSchema>;

/** 소스별이 아니라 신호 축별로 검색어를 나눈다 — 축이 비면 그 축은 조사되지 않는다 */
export const ScoutQueriesSchema = z.object({
  funding: z.array(z.string()).min(1),
  incumbent: z.array(z.string()).min(1),
  regulation: z.array(z.string()).min(1),
  costCurve: z.array(z.string()).min(1),
});
export type ScoutQueries = z.infer<typeof ScoutQueriesSchema>;

/**
 * grounded 검색 단계의 산출물 — **후보가 아니라 사실 목록이다.**
 * 여기서 후보를 만들게 하면 검색과 종합이 한 호출에 섞여, 무엇이 검색된 사실이고
 * 무엇이 모델의 구성인지 구분할 수 없게 된다. 그래서 step이 갈린다.
 */
export const ScoutDossierSchema = z.object({
  findings: z
    .array(
      z.object({
        signalType: SignalTypeSchema,
        statement: z.string().min(1),
        observedAt: z.string().optional(),
      }),
    )
    .default([]),
});
export type ScoutDossier = z.infer<typeof ScoutDossierSchema>;

// ── 스키마 팩토리 ──

export interface ScoutConstraints {
  /** 코드가 grounding 응답에서 추출한 인용의 ID 집합 ("C1", "C2", …) */
  citationIds: readonly string[];
  /** 검증 기준 시각 */
  now: Date;
  /** observedAt의 하한 */
  windowStart: Date;
}

/**
 * 금액·퍼센트 표기만 좁게 잡는다. **오탐은 무한 재시도를 만든다** —
 * 모델이 만족시킬 수 없는 요구("3가지"에 출처를 대라)를 걸면 재시도 루프가 돈다.
 * 그래서 수치는 통화기호·통화 단위·퍼센트가 붙었을 때만 "금액"으로 센다.
 * 누락(false negative)은 그 수치의 귀속을 강제하지 못할 뿐이라 훨씬 싸다.
 */
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const MONETARY_SOURCE = [
  // 통화기호 접두: $4.2B, ₩1,200억, €500 million
  String.raw`[$₩€¥£]\s?${NUM}\s?(?:[KMBT](?![A-Za-z])|억|조|만|million|billion|trillion)?`,
  // 퍼센트: 23%, 1.5 %
  String.raw`${NUM}\s?%`,
  // 한국어 금액 단위: 4.2억, 23조 원 ("만"은 넣지 않는다 — "10만 명"은 금액이 아니다)
  String.raw`${NUM}\s?(?:억|조)(?:\s?원)?`,
  // 통화 명사가 바로 붙은 수치: 5,000원, 100달러.
  // 여기에 "뒤에 한글이 오면 제외" 같은 lookahead를 걸지 마라 — 한국어는 조사가 명사에 그대로
  // 붙으므로("5,000원으로") 가장 흔한 형태를 통째로 놓친다.
  String.raw`${NUM}\s?(?:원|달러|유로)`,
  // 엔(円)만 lookahead를 남긴다 — "3엔진"처럼 통화가 아닌 단어를 만드는 유일한 단위다
  String.raw`${NUM}\s?엔(?![가-힣])`,
  // 영어 규모 단위: 4.2 billion
  String.raw`${NUM}\s?(?:million|billion|trillion)`,
].join("|");

/** 비교를 위한 정규화 — 공백·쉼표는 표기 차이이지 값의 차이가 아니다 */
function normalizeFigure(text: string): string {
  return text.replace(/[\s,]/g, "").toLowerCase();
}

/**
 * statement의 금액·퍼센트 표기 중 figures[]에 대응하지 않는 것. 양방향 포함으로 비교한다 —
 * 산문의 "1,200억"과 귀속의 "1,200억 원"은 같은 수치를 가리킨다.
 */
function unattributedFigures(
  statement: string,
  figures: readonly Figure[],
): string[] {
  // g 플래그 정규식은 lastIndex를 들고 다닌다 — 호출마다 새로 만들어 상태를 없앤다
  const tokens = statement.match(new RegExp(MONETARY_SOURCE, "giu")) ?? [];
  const attributed = figures
    .map((figure) => normalizeFigure(figure.value))
    .filter((value) => value.length > 0);

  const missing = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeFigure(token);
    if (normalized.length === 0) continue;
    const covered = attributed.some(
      (value) => value.includes(normalized) || normalized.includes(value),
    );
    if (!covered) missing.add(token.trim());
  }
  return [...missing];
}

/**
 * 범위(미래·구간 밖) 오류에만 붙인다.
 *
 * 검색된 인용이 실제로 구간 밖이면 모델이 그 신호를 만족시킬 방법은 **없다** — 남는 길은
 * 날짜를 지어내는 것뿐이고, 그러면 재시도 3회가 통째로 낭비된다. `candidates: []`가 정당한
 * 답이라는 것은 이 파이프라인의 규약인데(ADR-019, 침묵 게이트) 재시도 시점의 모델에게는
 * 그 선택지가 보이지 않는다. 그래서 만족 불가능한 요구에는 합법적 탈출구를 같이 준다.
 *
 * 형식·수치 귀속 오류에는 붙이지 않는다. 그것들은 언제나 고칠 수 있고, 도피처를 주면
 * 모델이 고치는 대신 버린다.
 */
const ESCAPE_HATCH =
  " 이 구간 안의 근거를 댈 수 없으면 그 신호를 빼라. 남는 신호가 조건을 못 채우면 후보를 통째로 빼도 된다 — 억지로 채운 후보보다 빈 candidates가 낫다";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 완전한 `YYYY-MM-DD`만 받아 그대로 돌려준다. 파싱 불가면 null (throw하지 않는다 —
 * 검증 결과로 다룬다).
 *
 * `Date.parse`를 그대로 쓰지 않는 이유가 이 함수의 존재 이유다:
 * - `"2025-01"`·`"2026"`은 NaN이 아니라 **그 달·그 해의 1일**로 파싱된다. 그러면 형식 문제가
 *   범위 검사까지 흘러가 "탐색 구간 밖"으로 **오진**되고, 모델은 형식이 아니라 사실을 옮기려
 *   들어 재시도가 수렴하지 못한다. 부분 표기는 반드시 형식 오류로 잡아야 한다.
 * - `"Jan 5, 2025"`·`"2025-1-5"`는 **로컬 타임존**으로 해석돼 서버 TZ에 따라 답이 달라진다.
 * - `"2025-02-30"`은 조용히 `03-02`로 넘어간다 — 그래서 round-trip으로 대조한다.
 *
 * 반환이 ms가 아니라 문자열인 것도 의도다. `YYYY-MM-DD`의 사전순은 정확히 시간순이고,
 * **프롬프트가 모델에게 보여주는 문자열과 바이트 단위로 같다** (trendScout.ts의 .slice(0,10)).
 * ms로 비교하면 시각 성분이 딸려 들어와 경계일이 어긋난다 — 아래 windowStartDay를 보라.
 */
function parseDay(value: string): string | null {
  const text = value.trim();
  if (!ISO_DAY.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === text ? text : null;
}

/**
 * dossier의 인용 목록을 아는 opportunities 스키마. 하류가 상류를 안다 —
 * 의존은 파이프라인이 흐르는 방향으로만 흐른다 (ADR-017).
 *
 * 반환 타입이 ZodType<OpportunitiesDraft>라 generateStructured의 재시도 루프를 그대로 타고,
 * addIssue 메시지가 z.prettifyError를 거쳐 그대로 교정 프롬프트가 된다 (ADR-004) —
 * 그래서 모든 메시지가 문제의 ref·수치를 이름으로 지목한다. 검증을 에이전트 바깥으로 빼면
 * generateStructured가 반환한 **뒤**라 재시도가 붙지 않는다.
 */
export function opportunitiesSchemaFor(
  constraints: ScoutConstraints,
): ZodType<OpportunitiesDraft> {
  const known = new Set(constraints.citationIds);
  const validList =
    constraints.citationIds.length === 0
      ? "(유효한 인용이 하나도 없다 — 근거를 댈 수 없으면 candidates를 비워라)"
      : constraints.citationIds.join(", ");
  // 날(day) 단위로 자른다. 프롬프트는 모델에게 날짜만 보여주므로(trendScout.ts의 .slice(0,10))
  // 검증도 같은 해상도여야 한다 — 시각까지 비교하면 모델이 **광고된 경계일을 그대로 써도**
  // `observedAt "2025-01-19"이 탐색 구간(2025-01-19 이후) 밖이다`라는 자기모순 피드백이 나가고,
  // 그건 모델이 고칠 수 없는 요구라 재시도가 통째로 낭비된다.
  const nowDay = constraints.now.toISOString().slice(0, 10);
  const windowStartDay = constraints.windowStart.toISOString().slice(0, 10);

  return OpportunitiesDraftSchema.superRefine((draft, ctx) => {
    draft.candidates.forEach((candidate, index) => {
      const at = (field: string) => ["candidates", index, field];
      const signals = [...candidate.signals, candidate.counterSignal];

      // (1) 인용 화이트리스트 — 모든 ref가 코드가 실제로 추출한 인용을 가리켜야 한다
      const refs = signals.flatMap((signal) => [
        signal.citationRef,
        ...signal.figures.map((figure) => figure.citationRef),
      ]);
      for (const ref of new Set(refs)) {
        if (!known.has(ref)) {
          ctx.addIssue({
            code: "custom",
            path: at("signals"),
            message: `${candidate.id}: ${ref}는 검색된 인용이 아니다. citationRef는 다음 중 하나여야 한다: ${validList}`,
          });
        }
      }

      // (2) 삼각측량 — 종류와 출처가 **둘 다** 갈려야 한다.
      // signalType만 검사하면 같은 기사를 두 타입으로 라벨링해 우회한다.
      // counterSignal은 반대 증거이지 근거가 아니므로 이 계산에 넣지 않는다.
      const types = new Set(candidate.signals.map((signal) => signal.signalType));
      const sources = new Set(
        candidate.signals.map((signal) => signal.citationRef),
      );
      if (types.size < 2) {
        ctx.addIssue({
          code: "custom",
          path: at("signals"),
          message: `${candidate.id}: 신호가 ${[...types].join(", ")} 한 종류뿐이다. 서로 다른 signalType이 2종 이상이어야 한다`,
        });
      }
      if (sources.size < 2) {
        ctx.addIssue({
          code: "custom",
          path: at("signals"),
          message: `${candidate.id}: 신호가 전부 같은 출처(${[...sources].join(", ")})다. 서로 다른 citationRef가 2개 이상이어야 한다`,
        });
      }

      // (3) 날짜 — 검색 없이는 채울 수 없는 필드를 만드는 것이 목적이다
      for (const signal of signals) {
        const observedDay = parseDay(signal.observedAt);
        if (observedDay === null) {
          // 형식 오류에는 ESCAPE_HATCH를 붙이지 않는다. 표기를 고치는 것은 언제나 가능하고,
          // 여기에 "빼도 된다"를 주면 모델이 고치는 대신 버려서 검증이 약해진다.
          ctx.addIssue({
            code: "custom",
            path: at("signals"),
            message: `${candidate.id}: observedAt "${signal.observedAt}"을 날짜로 읽을 수 없다. 연·월·일이 다 있는 ISO 날짜(YYYY-MM-DD)로 적어라 — "2026-Q2"·"2026-03" 같은 부분 표기는 받지 않는다`,
          });
        } else if (observedDay > nowDay) {
          ctx.addIssue({
            code: "custom",
            path: at("signals"),
            // effectiveAt을 먼저 가리킨다 — 시행 예정 규제라면 그것이 제자리이고, 버릴
            // 후보가 아니다. 탈출구만 주면 살릴 수 있는 후보까지 버리게 된다.
            message: `${candidate.id}: observedAt "${signal.observedAt}"이 미래다(오늘은 ${nowDay}다). observedAt은 보도·공시된 날이다 — 앞으로 일어날 일(시행 예정일 등)이라면 그 날짜는 effectiveAt으로 옮기고 observedAt에는 그 사실이 **보도된** 날을 적어라.${ESCAPE_HATCH}`,
          });
        } else if (observedDay < windowStartDay) {
          ctx.addIssue({
            code: "custom",
            path: at("signals"),
            message: `${candidate.id}: observedAt "${signal.observedAt}"이 탐색 구간(${windowStartDay} ~ ${nowDay}) 밖이다.${ESCAPE_HATCH}`,
          });
        }

        // effectiveAt은 미래여도 통과한다 — 시행 예정 규제가 가장 가치 있는 신호다.
        // 읽을 수 있는 날짜인지만 본다.
        if (signal.effectiveAt !== undefined && parseDay(signal.effectiveAt) === null) {
          ctx.addIssue({
            code: "custom",
            path: at("signals"),
            message: `${candidate.id}: effectiveAt "${signal.effectiveAt}"을 날짜로 읽을 수 없다. 연·월·일이 다 있는 ISO 날짜(YYYY-MM-DD)로 적어라`,
          });
        }

        // (4) 수치 귀속 — 산문의 금액·퍼센트는 반드시 출처를 달고 다닌다
        for (const token of unattributedFigures(signal.statement, signal.figures)) {
          ctx.addIssue({
            code: "custom",
            path: at("signals"),
            message: `${candidate.id}: statement의 "${token}"에 출처가 없다. figures[]에 {value: "${token}", citationRef}를 넣어라`,
          });
        }
      }
    });
  });
}
