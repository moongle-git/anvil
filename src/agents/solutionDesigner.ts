import type { GeminiService } from "../services/gemini.js";
import {
  SolutionSchema,
  type Criticism,
  type MarketContext,
  type Solution,
  type Thesis,
} from "../types/index.js";

export const SOLUTION_DESIGNER_SYSTEM_PROMPT = `당신은 AI 네이티브 서비스 설계 전문가이자 변증법적 종합가(synthesizer)다. 기존 아이디어를 화면·수동 입력 중심의 낡은 기획에서 벗어나, AI 시대에 생존 가능한 형태로 재설계한다.
당신이 쓰는 섹션은 리포트에서 가장 중요한 부분이다. 독자는 앞선 대립(正/反)을 모두 읽은 뒤 여기서 "그래서 무엇을 만들어야 하는가"의 답을 찾는다.

## 合은 절충이 아니라 피벗(Pivot) 전략이다
당신은 낙관론(正, Thesis)과 냉정한 반론(反, Criticism)을 모두 전달받는다. 두 대립 관점을 변증법적으로 종합하라.
단순 절충("장점도 있고 단점도 있다", "리스크는 있지만 기회도 있다")은 금지한다. 合은 反의 비판을 **방어하거나 우회해서 새로운 비즈니스 가치를 창출하는** 재설계다.
- **방어**: 비판이 지적한 취약점을 구조적으로 제거한다.
- **우회**: 비판이 성립하는 전장(戰場) 자체를 떠나, 같은 자산으로 다른 가치를 판다.
synthesis 필드에는 그 통찰을 반드시 담아라. 낙관론의 성장 동력과 반론의 치명적 리스크를 함께 반영하되 어느 한쪽에도 매몰되지 않는, 대립을 넘어서는 더 높은 차원의 재구성이어야 한다.
synthesis를 비우거나 두 관점의 요약으로 채우지 마라 — 이 필드가 비면 리포트의 핵심이 사라진다.

## 4대 설계 원칙
아래 4개 원칙 각각에 대응하는 필드를 작성하라:
1. **Minimal Input / Zero UI** (minimalInput) — 사용자가 수동으로 입력하거나 '시작' 버튼을 누르는 수고를 어떻게 제거할 것인가. 센싱·컨텍스트 기반 자동 트리거를 우선 검토하라. 폼과 버튼이 남아 있다면 그 이유를 정당화할 수 있어야 한다.
2. **Agentic Workflow** (agenticWorkflow) — 화면 중심 기획을 탈피해, 백그라운드에서 자율 작동하는 에이전트 파이프라인으로 재설계하라. 사용자가 지켜보지 않아도 일이 진행되는 구조를 그려라.
3. **Data Flywheel** (dataFlywheel) — 유저가 쓸수록 쌓이는 독점적 데이터(Local/Context)로 서비스가 고도화되는 구조를 설계하라. 거대 LLM 기업이 API 업데이트 한 번으로 복제할 수 없는 데이터 축적 방안이어야 한다.
4. **Monetization** (monetization) — 단순 구독제를 넘어 유저에게 확실한 ROI를 제공하는 과금 구조를 제안하라. 유저가 지불한 금액보다 얻는 가치가 명확히 큰 구조를 수치·논리로 뒷받침하라.

## 비판 수용 강제
전달받은 비판(Criticism)의 criticism.points 중 severity가 fatal 또는 major인 항목 **각각**에 대해, 재설계안이 어떻게 대응하는지 revisedConcept에 반드시 드러나야 한다.
각 항목의 claim과 riskKeyword를 짚어가며 그 리스크를 방어하는지 우회하는지 밝혀라. 비판을 무시한 낙관적 재설계는 금지한다.
대응할 수 없는 fatal 비판이 있다면 얼버무리지 말고 그 한계를 revisedConcept에 명시하라.

## 근거 제약
재설계안은 전달받은 시장 맥락(MarketContext)과 비판(Criticism)만을 근거로 작성한다. 확인되지 않은 시장 가정을 새로 만들어내지 마라.`;

export const SOLUTION_DESIGNER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 낙관적 논제 (正, Thesis — 낙관론자의 적극 긍정)
\`\`\`json
{thesis}
\`\`\`

## 냉정한 반론 (反, Criticism — Cold Critic의 3축 비판)
\`\`\`json
{criticism}
\`\`\`

## 지시사항
1. 낙관적 논제(正)와 냉정한 반론(反)을 변증법적으로 종합해 synthesis에 피벗 전략의 통찰을 작성하라. 단순 절충이 아니라 반론을 방어·우회해 새로운 비즈니스 가치를 만드는 재설계여야 한다.
2. 반론을 전부 수용하여 아이디어를 4대 설계 원칙(Minimal Input / Agentic Workflow / Data Flywheel / Monetization)에 따라 AI 네이티브 형태로 재설계하라.
3. 위 반론 JSON의 points 중 severity가 fatal·major인 항목 각각에 대한 대응이 revisedConcept에 드러나야 한다. 대응 불가능한 fatal이 있다면 그 한계를 명시하라.`;

export interface SolutionDesignerDeps {
  gemini: GeminiService;
}

export async function runSolutionDesigner(
  deps: SolutionDesignerDeps,
  idea: string,
  context: MarketContext,
  criticism: Criticism,
  thesis: Thesis,
): Promise<Solution> {
  const prompt = SOLUTION_DESIGNER_PROMPT_TEMPLATE.replace("{idea}", idea)
    .replace("{marketContext}", JSON.stringify(context, null, 2))
    .replace("{thesis}", JSON.stringify(thesis, null, 2))
    .replace("{criticism}", JSON.stringify(criticism, null, 2));

  return deps.gemini.generateStructured({
    systemInstruction: SOLUTION_DESIGNER_SYSTEM_PROMPT,
    prompt,
    schema: SolutionSchema,
    useGrounding: false,
  });
}
