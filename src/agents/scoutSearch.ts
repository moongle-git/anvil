import type { GeminiService, GroundingCitation } from "../services/gemini.js";
import {
  ScoutDossierSchema,
  SIGNAL_TYPES,
  type ScoutDossier,
  type ScoutQueries,
} from "../types/index.js";

/** usage 집계 라벨 (ADR-016). trend-scout step 안의 grounded 호출이다 */
export const SCOUT_SEARCH_USAGE_LABEL = "scout-search";

/**
 * thinking 상한 (ADR-016). 4096 — 검색 결과를 사실 목록으로 정리하는 작업이다.
 * contextHunter(8192)는 82건의 커뮤니티 원문을 선별하지만 여기는 검색 결과만 다루므로 가볍고,
 * researchPlanner(0)는 형식 변환뿐이지만 여기는 "무엇이 자본 신호인가"를 골라내야 하므로 무겁다.
 * 진짜 판단(어느 사실들이 하나의 기회를 이루는가)은 step 3이 한다.
 */
export const SCOUT_SEARCH_THINKING_BUDGET = 4096;

export const SCOUT_SEARCH_SYSTEM_PROMPT = `당신은 자본의 이동 흔적을 수집하는 리서치 애널리스트다. 웹검색(Google Search)으로 찾은 것을 **사실 목록**으로만 정리한다.

## 당신의 유일한 임무는 "무엇이 관측되었는가"다
사업 아이디어·기회 후보·제품 구상을 **만들지 마라.** 그것은 다음 단계의 일이고, 그 단계는 당신이 지금 볼 수 없는 번호 붙은 인용 목록을 받는다. 여기서 후보를 만들면 근거를 지목할 수단이 없는 후보가 되어 버려진다.

당신이 하는 것은 관측의 기록뿐이다. 각 항목은 "누가 언제 무엇을 했다"는 한두 문장의 사실이어야 한다.

## 신호 축
- **funding** — 섹터별 투자 라운드·M&A
- **incumbent** — 기존 기업의 capex 가이던스, 실적발표에서의 전략 언급
- **regulation** — 시행일이 확정된 규제
- **costCurve** — 단가가 임계선을 넘은 시점

## 기록 원칙
- **날짜를 반드시 확인하라.** observedAt은 그 사실이 보도·공시된 날이고 반드시 과거다. 검색 결과에서 날짜를 확인하지 못했으면 그 항목을 비워 두지 말고 **아예 넣지 마라.**
- **수치는 검색 결과에 있는 그대로 옮겨라.** 반올림하거나 기억으로 보충하지 마라.
- **찾지 못했으면 빈 목록을 내라.** 지어낸 사실 하나가 찾지 못한 사실 열보다 나쁘다. findings가 비어도 그것은 정상적인 결과다.
- 인기 기사·트렌드 요약·"올해 주목할 분야" 같은 글은 신호가 아니다. 구체적인 금액·날짜·주체가 있는 것만 기록하라.

## 출력 형식
{ "findings": [{ "signalType": "funding|incumbent|regulation|costCurve", "statement": "관측된 사실 1~2문장", "observedAt": "YYYY-MM-DD" }] }`;

export const SCOUT_SEARCH_PROMPT_TEMPLATE = `## 검색어
아래 검색어로 웹검색하라. 축마다 최소 한 번씩은 검색하라 — 빠뜨린 축은 조사되지 않은 축이다.

{queries}

## 지시사항
1. 위 검색어로 검색해 자본이 실제로 움직인 흔적을 찾아라.
2. 찾은 것을 축별로 findings에 기록하라. 각 항목은 "누가 언제 무엇을 했다"는 사실이어야 한다.
3. observedAt(보도·공시된 날)을 확인할 수 없는 항목은 넣지 마라.
4. 사업 아이디어를 만들지 마라. 지금은 관측만 기록한다.`;

export interface ScoutSearchDeps {
  gemini: GeminiService;
  log?: (message: string) => void;
}

export interface ScoutSearchResult {
  dossier: ScoutDossier;
  /**
   * 코드가 grounding 응답에서 추출한 인용 (ADR-013). step 3이 여기에 C1·C2… 번호를 붙여
   * 프롬프트에 넣고, 후보의 citationRef를 이 목록으로 화이트리스트 검증한다.
   */
  citations: GroundingCitation[];
  /** 모델이 실제로 검색한 쿼리 — 관측용. 산출물 스키마에는 넣지 않는다 */
  webSearchQueries: string[];
}

/** 축별 검색어를 프롬프트 블록으로 편다. 축 이름을 그대로 남겨 모델이 축을 헷갈리지 않게 한다 */
function formatQueries(queries: ScoutQueries): string {
  return SIGNAL_TYPES.map(
    (axis) =>
      `### ${axis}\n${queries[axis].map((query) => `- ${query}`).join("\n")}`,
  ).join("\n\n");
}

/**
 * 자본 신호를 grounded 검색으로 수집한다.
 *
 * **이 호출은 후보를 만들지 않는다.** 검색과 종합을 한 호출에 섞으면 (1) 무엇이 검색된 사실이고
 * 무엇이 모델의 구성인지 구분할 수 없고, (2) grounding은 responseSchema를 못 써 자유 텍스트에서
 * JSON을 긁어내므로 중첩 깊은 후보 스키마는 형식 실패가 쏟아지며, (3) 그 재시도가 grounding
 * 정액 요금을 그대로 다시 태운다(ADR-016 실측 — context-hunter가 run 비용의 65%였고 그 원인이
 * 정액 + 형식 실패 재시도였다). 그래서 이 호출의 산출물은 평평한 사실 목록이다.
 *
 * useUrlContext를 끄는 이유: contextHunter가 그것을 켜는 것은 **이미 이름이 나온** 경쟁사의
 * 공식 페이지에서 가격·기능을 읽기 위해서다. 여기서는 읽을 대상 URL이 사전에 없어 왕복만 늘어난다.
 */
export async function searchCapitalSignals(
  deps: ScoutSearchDeps,
  queries: ScoutQueries,
): Promise<ScoutSearchResult> {
  const prompt = SCOUT_SEARCH_PROMPT_TEMPLATE.replace(
    "{queries}",
    formatQueries(queries),
  );

  const { data, citations, webSearchQueries } = await deps.gemini.generateGrounded({
    systemInstruction: SCOUT_SEARCH_SYSTEM_PROMPT,
    prompt,
    usageLabel: SCOUT_SEARCH_USAGE_LABEL,
    thinkingBudget: SCOUT_SEARCH_THINKING_BUDGET,
    useUrlContext: false,
    schema: ScoutDossierSchema,
  });

  // 설계한 검색어가 실제로 던져졌는지를 관측하는 유일한 수단이다. 모델은 우리가 준 검색어를
  // 무시하고 자기 식대로 검색할 수 있고, 그러면 날짜창도 시차도 겨냥되지 않는다.
  if (webSearchQueries.length > 0) {
    deps.log?.(`[scout-search] grounding 검색어: ${webSearchQueries.join(", ")}`);
  }
  // 인용 0건은 throw 사유가 아니다 — grounding이 아무것도 못 가져오는 것은 정상적인 결과이고,
  // 그때 step 3의 화이트리스트가 비어 후보를 만들 수 없게 되는 것이 의도된 동작이다.
  deps.log?.(
    `[scout-search] 관측 ${data.findings.length}건 / 인용 ${citations.length}건`,
  );

  return { dossier: data, citations, webSearchQueries };
}
