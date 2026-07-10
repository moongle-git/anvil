import type { GeminiService } from "../services/gemini.js";
import {
  ThesisSchema,
  type MarketContext,
  type Thesis,
} from "../types/index.js";

export const THESIS_SYSTEM_PROMPT = `당신은 이 아이디어에 직접 베팅하려는 공격적인 성장 투자자다. 수익 모델과 성장 잠재력을 가장 낙관적인 관점에서 적극 긍정한다.
리스크 나열과 비관은 당신의 역할이 아니다 — 그건 다음 단계의 냉정한 비판가가 맡는다. 당신은 오직 "이 사업이 왜 크게 성공할 수 있는가"를 설득력 있게 논증한다.
단, 근거 없는 공상은 금지한다. 모든 낙관은 전달받은 시장 맥락(MarketContext)의 실제 데이터 — 트렌드, 경쟁 서비스, YouTube 유저 목소리, 페인포인트 근거 — 에 기반해야 한다.

## 작성 항목
1. **revenueModel** — 이 서비스가 어떻게 돈을 버는가. 가장 설득력 있는 수익화 경로를 적극 긍정하라.
2. **growthLevers** — 성장을 폭발시킬 지렛대들(바이럴 루프, 인접 시장 확장, B2B 번들 등). 각 항목은 시장 맥락에 근거해야 한다.
3. **marketTailwinds** — 이 사업을 밀어주는 시장의 순풍(트렌드 확산, 기술 단가 하락, 규제·문화 변화 등).
4. **bestCaseScenario** — 모든 것이 잘 풀렸을 때의 최상 시나리오를 구체적인 수치·마일스톤으로 그려라.
5. **winningThesis** — 위를 종합해 "이 사업은 왜 이긴다"는 한 단락의 강한 논지.

## 근거 인용 강제
각 주장은 MarketContext의 실제 데이터(경쟁 서비스명, 댓글 원문, 트렌드)를 근거로 삼아라. 시장 맥락에서 뒷받침할 수 없는 낙관은 쓰지 마라.`;

export const THESIS_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 지시사항
위 시장 맥락 데이터를 근거로, 이 아이디어의 수익 모델과 성장 잠재력을 가장 낙관적인 관점에서 적극 긍정하라.
근거 없는 공상은 금지하며, 각 주장은 위 JSON의 실제 데이터(경쟁 서비스·댓글 원문·트렌드)에 기반해야 한다.`;

export interface ThesisDeps {
  gemini: GeminiService;
}

export async function runThesis(
  deps: ThesisDeps,
  idea: string,
  context: MarketContext,
): Promise<Thesis> {
  const prompt = THESIS_PROMPT_TEMPLATE.replace("{idea}", idea).replace(
    "{marketContext}",
    JSON.stringify(context, null, 2),
  );

  return deps.gemini.generateStructured({
    systemInstruction: THESIS_SYSTEM_PROMPT,
    prompt,
    schema: ThesisSchema,
    useGrounding: false,
  });
}
