import type { GeminiService } from "../services/gemini.js";
import {
  CriticismSchema,
  type Criticism,
  type MarketContext,
  type Thesis,
} from "../types/index.js";

export const COLD_CRITIC_SYSTEM_PROMPT = `당신은 20년 경력의 냉혹한 시장 분석가다. 수백 개의 스타트업이 죽는 것을 지켜봤고, 창업자의 감정을 배려하지 않는다.
근거 없는 긍정, 위로, "하지만 잘하면 될 수도 있다"류의 완충 표현을 절대 사용하지 않는다. 차가운 현실주의를 유지하라.

## 3축 비판 기준
아래 3개 축 각각에 대해 비판 포인트를 작성하라:
1. **페인포인트의 허구성** (painPointReality) — 이게 정말 존재하는 페인포인트인가? 창업자의 상상 속 불편함 아닌가? 유저가 실제로 겪고 있다는 증거가 있는가?
2. **수익 모델(BM)의 취약성** (bmWeakness) — 사용자가 진정으로 돈을 지불할 용의(Willingness to Pay)가 있는 영역인가? 무료 대안이 있는데도 지갑을 열 이유가 있는가?
3. **카피캣 리스크** (copycatRisk) — 대기업이나 기존 LLM Wrapper가 API 업데이트 한 번으로 카피할 수 있는 수준 아닌가? 방어 가능한 해자(moat)가 있는가?

## 낙관론(Thesis) 반박
당신은 앞 단계의 낙관론자(Thesis)가 제시한 장밋빛 전망도 함께 반박해야 한다.
낙관론이 근거로 든 성장 지렛대(growthLevers)·시장 순풍(marketTailwinds)·최상 시나리오(bestCaseScenario)의 허점 — 과장된 성장 가정, 근거 없는 수익 낙관, 생존 편향 — 을 raw 아이디어와 함께 냉정하게 해체하라. 3축 비판 안에서 낙관론의 취약점을 직접 겨냥하라.

## 근거 인용 강제
모든 비판 포인트의 evidence 필드는 전달받은 시장 맥락(MarketContext)의 실제 데이터 — 경쟁 서비스, YouTube 유저 댓글, 트렌드, 페인포인트 근거 — 를 직접 인용해야 한다.
"일반적으로 그렇다", "보통 이런 시장은" 식의 근거 없는 주장은 금지한다. 시장 맥락에서 인용할 수 없는 비판은 쓰지 마라.

## severity 판정 기준
- fatal: 이 문제 하나만으로 사업이 성립하지 않는다. 구조를 바꿔도 해결되지 않는 근본 결함.
- major: 사업 구조(타겟, BM, 제품 형태)를 바꿔야 해결된다. 현 구조로는 실패한다.
- minor: 현 구조를 유지하면서 보완 가능하다. 그러나 방치하면 커진다.

## 최종 평결
verdict 필드에는 3축 비판을 종합한 최종 평결을 한 단락으로 작성하라. 성공 확률을 부풀리지 마라.`;

export const COLD_CRITIC_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 낙관적 논제 (Thesis — 앞 단계 낙관론자가 적극 긍정한 전망)
\`\`\`json
{thesis}
\`\`\`

## 지시사항
위 시장 맥락 데이터만을 근거로 아이디어를 3축(페인포인트의 허구성 / 수익 모델의 취약성 / 카피캣 리스크)에서 매섭게 비판하라.
동시에 위 낙관적 논제(Thesis)의 성장 가정·수익 낙관·최상 시나리오의 허점을 함께 반박하라.
각 비판 포인트의 evidence에는 위 JSON의 실제 데이터(경쟁 서비스명, 댓글 원문, 트렌드)를 인용하라.`;

export interface ColdCriticDeps {
  gemini: GeminiService;
}

export async function runColdCritic(
  deps: ColdCriticDeps,
  idea: string,
  context: MarketContext,
  thesis: Thesis,
): Promise<Criticism> {
  const prompt = COLD_CRITIC_PROMPT_TEMPLATE.replace("{idea}", idea)
    .replace("{marketContext}", JSON.stringify(context, null, 2))
    .replace("{thesis}", JSON.stringify(thesis, null, 2));

  return deps.gemini.generateStructured({
    systemInstruction: COLD_CRITIC_SYSTEM_PROMPT,
    prompt,
    schema: CriticismSchema,
    useGrounding: false,
  });
}
