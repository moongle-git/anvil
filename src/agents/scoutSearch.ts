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

/**
 * 인용 0건일 때 재검색할 횟수.
 *
 * **왜 필요한가.** groundingChunks는 비결정적이다 — 실측 8회 중 4회가 chunk 0건이었고,
 * 그 4회 모두 webSearchQueries는 정상이었다(검색은 실재했고 귀속만 안 붙었다). 프롬프트
 * 형태로는 재현되지 않는다: 같은 스카우트 프롬프트가 한 번은 0건, 한 번은 11건을 냈다.
 *
 * **왜 이 호출만인가.** 인용 0건은 step 3의 침묵 게이트에서 곧바로 `candidates: []`가 되고,
 * orchestrator가 그 빈 결과를 저장해버려 resume으로도 복구되지 않는다 — run이 죽는다.
 * 같은 조건에서 context-hunter는 그냥 진행하므로(인용은 있으면 좋은 것) 켜지 않는다.
 *
 * 2회인 이유: 실측 실패율이 약 50%라 1회로는 4번에 1번이 여전히 죽는다. 3회 이상은
 * generateGrounded의 시간 예산(STALLED_THRESHOLD_MS 15분)을 넘본다.
 */
export const SCOUT_SEARCH_CITATION_RETRIES = 2;

/**
 * 한 축에서 grounded 호출에 실을 검색어 수의 상한.
 *
 * **인과가 아니라 실측 상관이다.** 인용이 붙은 호출은 전부 검색이 좁았고(실측 4~6건),
 * 0건이 난 호출은 넓었다(실측 17건 — 플래너가 축마다 3개씩 낸 것을 검색 모델이 연도별로
 * 다시 쪼갰다). 17건짜리 호출은 재검색 2회를 포함해 3연속으로 인용 0건이었다.
 *
 * Google이 왜 넓은 검색에서 귀속을 떨어뜨리는지는 알 수 없다 — 응답에 관측 가능한 단서가
 * 없다(webSearchQueries는 정상이고 groundingChunks만 빈다). 그래서 이 상한은 **원인 제거가
 * 아니라 위험 회피**다. 넓은 탐색을 원하면 축을 늘리지 말고 run을 나눠라.
 *
 * 커버리지와의 교환이다: 검색어를 줄이면 관측이 줄지만, 인용 없는 관측은 침묵 게이트에서
 * 전부 버려진다(ADR-019). 버려질 관측을 많이 얻는 것보다 적게 얻고 지키는 편이 낫다.
 */
export const SCOUT_SEARCH_MAX_QUERIES_PER_AXIS = 2;

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
축(funding·incumbent·regulation·costCurve)별로 나눠 **산문 목록**으로 적어라. 각 항목은 "누가 언제 무엇을 했다"는 한두 문장이고, 끝에 관측일(보도·공시일)을 적는다.

JSON으로 적지 마라. 이 단계는 사람이 읽는 사실 기록이고, 구조화는 다음 단계가 한다.`;

/** 산문 dossier를 ScoutDossier로 옮기는 non-grounded 호출 (ADR-013의 경계는 그대로다) */
export const SCOUT_STRUCTURE_SYSTEM_PROMPT = `당신은 앞 단계가 웹검색으로 기록한 산문 사실 목록을 정해진 구조로 **옮겨 적는** 필경사다.

- **새 사실을 만들지 마라.** 산문에 없는 항목·수치·날짜를 추가하면 그것은 검색되지 않은 사실이다.
- 관측일(observedAt)이 산문에 없는 항목은 **넣지 마라.** 날짜를 추측해 채우지 마라.
- 산문의 표현을 그대로 옮겨라. 요약하거나 다듬지 마라.
- 어느 축에도 해당하지 않는 항목은 버려라.

## 출력 형식
{ "findings": [{ "signalType": "funding|incumbent|regulation|costCurve", "statement": "관측된 사실 1~2문장", "observedAt": "YYYY-MM-DD" }] }`;

export const SCOUT_STRUCTURE_PROMPT_TEMPLATE = `아래는 앞 단계가 웹검색으로 기록한 사실 목록이다. 이것을 findings 구조로 옮겨 적어라.

{prose}`;

/**
 * 구조화 호출의 usage 라벨. 검색과 따로 남겨야 "산문은 왔는데 구조화가 깨졌다"를 장부에서 가른다.
 */
export const SCOUT_STRUCTURE_USAGE_LABEL = "scout-structure";

/** 옮겨 적기다. 판단이 없으므로 thinking을 켜지 않는다 (scoutPlanner와 같은 이유) */
export const SCOUT_STRUCTURE_THINKING_BUDGET = 0;

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
      `### ${axis}\n${queries[axis]
        .slice(0, SCOUT_SEARCH_MAX_QUERIES_PER_AXIS)
        .map((query) => `- ${query}`)
        .join("\n")}`,
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

  // 1단계: 산문으로 검색한다. JSON을 강제하면 groundingChunks가 사라져 인용이 0건이 된다
  const { text, citations, webSearchQueries } =
    await deps.gemini.generateGroundedText({
      systemInstruction: SCOUT_SEARCH_SYSTEM_PROMPT,
      prompt,
      usageLabel: SCOUT_SEARCH_USAGE_LABEL,
      thinkingBudget: SCOUT_SEARCH_THINKING_BUDGET,
      useUrlContext: false,
      citationRetries: SCOUT_SEARCH_CITATION_RETRIES,
    });

  // 설계한 검색어가 실제로 던져졌는지를 관측하는 유일한 수단이다. 모델은 우리가 준 검색어를
  // 무시하고 자기 식대로 검색할 수 있고, 그러면 날짜창도 시차도 겨냥되지 않는다.
  if (webSearchQueries.length > 0) {
    deps.log?.(`[scout-search] grounding 검색어: ${webSearchQueries.join(", ")}`);
  }
  // 인용 0건은 throw 사유가 아니다 — grounding이 아무것도 못 가져오는 것은 정상적인 결과이고,
  // 그때 step 3의 화이트리스트가 비어 후보를 만들 수 없게 되는 것이 의도된 동작이다.
  // 다만 구조화까지 갈 이유는 없다: 인용이 없으면 그 findings는 침묵 게이트가 전부 버린다.
  if (citations.length === 0) {
    deps.log?.("[scout-search] 인용 0건 — 구조화를 건너뛴다");
    return { dossier: { findings: [] }, citations, webSearchQueries };
  }

  // 2단계: 산문을 구조로 옮긴다. non-grounded라 형식 실패에 자가 교정 재시도가 붙고,
  // grounding 정액 요금을 다시 태우지 않는다 (ADR-016).
  const dossier = await deps.gemini.generateStructured({
    systemInstruction: SCOUT_STRUCTURE_SYSTEM_PROMPT,
    prompt: SCOUT_STRUCTURE_PROMPT_TEMPLATE.replace("{prose}", text),
    usageLabel: SCOUT_STRUCTURE_USAGE_LABEL,
    thinkingBudget: SCOUT_STRUCTURE_THINKING_BUDGET,
    schema: ScoutDossierSchema,
  });

  deps.log?.(
    `[scout-search] 관측 ${dossier.findings.length}건 / 인용 ${citations.length}건`,
  );

  return { dossier, citations, webSearchQueries };
}
