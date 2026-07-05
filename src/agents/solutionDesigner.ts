import type { GeminiService } from "../services/gemini.js";
import {
  SolutionSchema,
  type Criticism,
  type MarketContext,
  type Solution,
} from "../types/index.js";

export const SOLUTION_DESIGNER_SYSTEM_PROMPT = `당신은 AI 네이티브 서비스 설계 전문가다. 기존 아이디어를 화면·수동 입력 중심의 낡은 기획에서 벗어나, AI 시대에 생존 가능한 형태로 재설계한다.

## 4대 설계 원칙
아래 4개 원칙 각각에 대응하는 필드를 작성하라:
1. **Minimal Input / Zero UI** (minimalInput) — 사용자가 수동으로 입력하거나 '시작' 버튼을 누르는 수고를 어떻게 제거할 것인가. 센싱·컨텍스트 기반 자동 트리거를 우선 검토하라. 폼과 버튼이 남아 있다면 그 이유를 정당화할 수 있어야 한다.
2. **Agentic Workflow** (agenticWorkflow) — 화면 중심 기획을 탈피해, 백그라운드에서 자율 작동하는 에이전트 파이프라인으로 재설계하라. 사용자가 지켜보지 않아도 일이 진행되는 구조를 그려라.
3. **Data Flywheel** (dataFlywheel) — 유저가 쓸수록 쌓이는 독점적 데이터(Local/Context)로 서비스가 고도화되는 구조를 설계하라. 거대 LLM 기업이 API 업데이트 한 번으로 복제할 수 없는 데이터 축적 방안이어야 한다.
4. **Monetization** (monetization) — 단순 구독제를 넘어 유저에게 확실한 ROI를 제공하는 과금 구조를 제안하라. 유저가 지불한 금액보다 얻는 가치가 명확히 큰 구조를 수치·논리로 뒷받침하라.

## 비판 수용 강제
전달받은 비판(Criticism)의 fatal/major 항목 각각에 대해 재설계안이 어떻게 대응하는지 revisedConcept에 반드시 반영하라.
비판을 무시한 낙관적 재설계는 금지한다. 대응할 수 없는 fatal 비판이 있다면 그 한계도 revisedConcept에 명시하라.

## 근거 제약
재설계안은 전달받은 시장 맥락(MarketContext)과 비판(Criticism)만을 근거로 작성한다. 확인되지 않은 시장 가정을 새로 만들어내지 마라.`;

export const SOLUTION_DESIGNER_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 냉정한 비판 (Criticism — Cold Critic의 3축 비판)
\`\`\`json
{criticism}
\`\`\`

## 지시사항
위 비판을 전부 수용하여 아이디어를 4대 설계 원칙(Minimal Input / Agentic Workflow / Data Flywheel / Monetization)에 따라 AI 네이티브 형태로 재설계하라.
revisedConcept에는 fatal/major 비판 각각에 대한 대응이 드러나야 한다.`;

export interface SolutionDesignerDeps {
  gemini: GeminiService;
}

export async function runSolutionDesigner(
  deps: SolutionDesignerDeps,
  idea: string,
  context: MarketContext,
  criticism: Criticism,
): Promise<Solution> {
  const prompt = SOLUTION_DESIGNER_PROMPT_TEMPLATE.replace("{idea}", idea)
    .replace("{marketContext}", JSON.stringify(context, null, 2))
    .replace("{criticism}", JSON.stringify(criticism, null, 2));

  return deps.gemini.generateStructured({
    systemInstruction: SOLUTION_DESIGNER_SYSTEM_PROMPT,
    prompt,
    schema: SolutionSchema,
    useGrounding: false,
  });
}
