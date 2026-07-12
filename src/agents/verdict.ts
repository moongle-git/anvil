import type { GeminiService } from "../services/gemini.js";
import {
  RECOMMENDATION_SCORE_BANDS,
  VerdictSchema,
  type Criticism,
  toPromptContext,
  type MarketContext,
  type Recommendation,
  type Solution,
  type Thesis,
  type Verdict,
} from "../types/index.js";

/** usage 집계 라벨 = 파이프라인 step 이름 (ADR-016) */
export const VERDICT_USAGE_LABEL = "verdict";

/**
 * thinking 상한 (ADR-016). 2048 — 판정 품질 때문에 별도 에이전트로 분리한 만큼(ADR-010)
 * thinking을 끄지는 않는다. 끄는 것과 상한을 두는 것은 다르다.
 */
export const VERDICT_THINKING_BUDGET = 2048;

/** 밴드는 스키마의 refine이 검증한다. 프롬프트가 같은 숫자를 말해야 재시도 루프가 돌지 않는다. */
function band(recommendation: Recommendation): string {
  const { min, max } = RECOMMENDATION_SCORE_BANDS[recommendation];
  return `${min}~${max}`;
}

export const VERDICT_SYSTEM_PROMPT = `당신은 앞선 네 단계 — 시장 맥락(MarketContext) / 正 낙관 논제(Thesis) / 反 냉정한 비판(Criticism) / 合 피벗 재설계(Solution) — 를 모두 읽은 최종 심사역이다.
당신은 낙관론자도 비판가도 아니다. 어느 한쪽 편을 들지 않으며, 앞 네 단계를 종합해 최종 생존 가능성만 판정한다.

## 판정 대상은 원본 아이디어가 아니라 合의 재설계안(solution.revisedConcept)이다
이것이 당신이 존재하는 이유다. 원본 아이디어를 채점하지 마라. 反이 이미 원본을 난도질했고, 合은 그 비판을 딛고 피벗했다.
당신이 할 일은 criticism.points의 비판 각각에 대해 合이 실제로 그것을 **방어**(취약점을 구조적으로 제거)했는지, **우회**(비판이 성립하는 전장을 떠나 같은 자산으로 다른 가치를 판매)했는지 검증하는 것이다.
- 合이 방어·우회에 성공한 비판은 해소된 것이다. 그 항목으로 재설계안을 감점하지 마라.
- 방어되지 않은 비판, 그리고 피벗이 **새로 만들어낸** 리스크만이 잔존 리스크다.

## survivalScore와 recommendation
survivalScore는 0~100의 정수이며, recommendation은 아래 밴드를 반드시 지켜야 한다. 어기면 출력이 검증에 실패해 폐기된다.
- abandon — survivalScore ${band("abandon")}
- pivot — survivalScore ${band("pivot")}
- proceed — survivalScore ${band("proceed")}

성공 확률을 부풀리지 마라. criticism.points에 severity가 fatal인 항목이 남아 있고 合이 그것을 방어하지도 우회하지도 못했다면, survivalScore는 ${RECOMMENDATION_SCORE_BANDS.pivot.min} 미만이어야 한다.

## 작성 항목
1. **headline** — 판정의 결론을 담은 **한 문장**. 리포트에서 가장 큰 글씨로 노출된다. 조건절을 늘어놓지 말고 단정하라.
2. **rationale** — 왜 그 survivalScore인지 설명하는 종합 결론 단락. 네 단계(시장 맥락·正·反·合)를 각각 인용해 근거를 대라. 어느 비판이 방어됐고 어느 비판이 살아남았는지 밝혀라.
3. **residualRisks** — 合의 피벗 이후에도 남는 리스크. criticism.points를 그대로 옮겨 적지 마라. 방어된 항목은 제외하고, 방어되지 않았거나 피벗이 새로 만든 리스크만 남긴다.
   - **keyword** — 2~10자의 짧은 명사구. 문장을 쓰지 마라.
   - **severity** — fatal / major / minor 중 하나.
   - **note** — 왜 이 리스크가 피벗 이후에도 남는지 한 문장으로 설명한다.
4. **conditions** — "이 조건이 충족되면 생존한다"는 검증 가능한 조건 목록. 각 항목은 기한·수치를 포함한 실행 가능한 형태여야 한다(예: "출시 6개월 내 리텐션 D30 20% 확보").
   희망 사항("좋은 팀을 꾸린다", "마케팅을 잘한다")을 쓰지 마라. 참·거짓을 판정할 수 없는 문장은 조건이 아니다.`;

export const VERDICT_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 1단계: 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 2단계: 낙관적 논제 (正, Thesis)
\`\`\`json
{thesis}
\`\`\`

## 3단계: 냉정한 반론 (反, Criticism)
\`\`\`json
{criticism}
\`\`\`

## 4단계: 종합과 재설계 (合, Solution)
\`\`\`json
{solution}
\`\`\`

## 지시사항
1. 판정 대상은 원본 아이디어가 아니라 위 4단계의 solution.revisedConcept다.
2. criticism.points의 비판 각각에 대해 合이 그것을 방어했는지·우회했는지·놓쳤는지 판별하라.
3. 놓친 비판과 피벗이 새로 만든 리스크만 residualRisks에 남기고, survivalScore와 recommendation을 밴드에 맞춰 판정하라.
4. rationale에 어느 비판이 해소되고 어느 비판이 살아남았는지 근거와 함께 밝혀라.`;

export interface VerdictDeps {
  gemini: GeminiService;
}

export async function runVerdict(
  deps: VerdictDeps,
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
): Promise<Verdict> {
  // minify한다 — 들여쓰기 공백·줄바꿈도 입력 토큰으로 과금된다 (ADR-016)
  const prompt = VERDICT_PROMPT_TEMPLATE.replace("{idea}", idea)
    .replace("{marketContext}", JSON.stringify(toPromptContext(context)))
    .replace("{thesis}", JSON.stringify(thesis))
    .replace("{criticism}", JSON.stringify(criticism))
    .replace("{solution}", JSON.stringify(solution));

  return deps.gemini.generateStructured({
    systemInstruction: VERDICT_SYSTEM_PROMPT,
    prompt,
    usageLabel: VERDICT_USAGE_LABEL,
    thinkingBudget: VERDICT_THINKING_BUDGET,
    schema: VerdictSchema,
  });
}
