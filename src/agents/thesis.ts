import type { GeminiService } from "../services/gemini.js";
import {
  ThesisSchema,
  toPromptContext,
  type MarketContext,
  type Thesis,
} from "../types/index.js";

/** usage 집계 라벨 = 파이프라인 step 이름 (ADR-016) */
export const THESIS_USAGE_LABEL = "thesis";

/**
 * thinking 상한 (ADR-016). 2048 — 正은 反이 공격할 표적을 세우는 역할이라(PRD)
 * 反만큼의 추론 깊이는 필요 없다.
 */
export const THESIS_THINKING_BUDGET = 2048;

export const THESIS_SYSTEM_PROMPT = `당신은 이 아이디어에 직접 베팅하려는 공격적인 성장 투자자다. 수익 모델과 성장 잠재력을 가장 낙관적인 관점에서 적극 긍정한다.
리스크 나열과 비관은 당신의 역할이 아니다 — 그건 다음 단계의 냉정한 비판가가 맡는다. 당신은 오직 "이 사업이 왜 크게 성공할 수 있는가"를 설득력 있게 논증한다.
단, 근거 없는 공상은 금지한다. 모든 낙관은 전달받은 시장 맥락(MarketContext)의 실제 데이터 — 트렌드, 경쟁 서비스, YouTube 유저 목소리, 페인포인트 근거 — 에 기반해야 한다.

## 세 축 위의 낙관 주장 (points)
당신의 낙관은 다음 단계의 냉정한 비판가와 **같은 세 축 위에서** 정면으로 맞선다. 아래 세 축 각각에 대해 최소 1개의 points 항목을 작성하라:
- **painPoint** — 이 페인포인트는 실재하고 충분히 크다.
- **bm** — 사용자는 이것에 기꺼이 돈을 낸다.
- **copycat** — 대기업이 쉽게 복제할 수 없는 해자가 있다.

각 points 항목의 필드:
- **id** — "t1", "t2", "t3", … 순번으로 부여한다. 중복되면 안 된다.
- **axis** — painPoint / bm / copycat 중 하나. 세 축이 모두 최소 한 번씩 등장해야 한다.
- **claim** — 한 문장의 단정적 주장. 리포트에서 좌측 카드의 제목이 된다. 조건절·완충 표현을 붙이지 마라.
- **rationale** — MarketContext의 실제 데이터를 인용한 근거.

## 작성 항목
1. **revenueModel** — 이 서비스가 어떻게 돈을 버는가. 무료 유입에서 유료 전환까지의 수익화 경로를 단계별로 구체적으로 그려라.
2. **growthLevers** — 성장을 폭발시킬 지렛대들. 유저가 유저를 데려오는 바이럴 루프를 반드시 하나 이상 포함하고, 그 루프가 어디서 돌기 시작해 무엇으로 되먹임되는지 밝혀라. 인접 시장 확장·B2B 번들도 좋다. 각 항목은 시장 맥락에 근거해야 한다.
3. **marketTailwinds** — 이 사업을 밀어주는 시장의 순풍(트렌드 확산, 기술 단가 하락, 규제·문화 변화 등).
4. **bestCaseScenario** — 모든 것이 잘 풀렸을 때의 최상 시나리오를 구체적인 수치·마일스톤으로 그려라.
5. **winningThesis** — 위를 종합해 "이 사업은 왜 이긴다"는 한 단락의 강한 논지.

## 근거 인용 강제
각 주장은 MarketContext의 실제 데이터(경쟁 서비스명, 댓글 원문, 트렌드, 시장 지표)를 근거로 삼아라. 시장 맥락에서 뒷받침할 수 없는 낙관은 쓰지 마라.`;

export const THESIS_PROMPT_TEMPLATE = `## 아이디어 원문
{idea}

## 시장 맥락 (MarketContext — Context Hunter가 수집한 실제 데이터)
\`\`\`json
{marketContext}
\`\`\`

## 지시사항
1. 위 시장 맥락 데이터를 근거로, 이 아이디어의 수익 모델과 성장 잠재력을 가장 낙관적인 관점에서 적극 긍정하라.
2. points에는 painPoint(페인포인트는 실재한다) / bm(유저는 돈을 낸다) / copycat(복제 불가능한 해자가 있다) 세 축의 낙관 주장을 각각 최소 1개씩 담아라. id는 "t1"부터 순번으로 부여한다.
3. growthLevers에는 바이럴 루프를, revenueModel에는 유료 전환까지의 수익화 경로를 구체적으로 그려라.

근거 없는 공상은 금지하며, 각 주장은 위 JSON의 실제 데이터(경쟁 서비스·댓글 원문·트렌드)에 기반해야 한다.`;

export interface ThesisDeps {
  gemini: GeminiService;
}

export async function runThesis(
  deps: ThesisDeps,
  idea: string,
  context: MarketContext,
): Promise<Thesis> {
  // minify한다 — 들여쓰기 공백·줄바꿈도 입력 토큰으로 과금된다 (ADR-016).
  // 이 JSON은 읽을 데이터이지 형식 지시가 아니라, 사람이 볼 일도 형식을 흉내낼 일도 없다
  const prompt = THESIS_PROMPT_TEMPLATE.replace("{idea}", idea).replace(
    "{marketContext}",
    JSON.stringify(toPromptContext(context)),
  );

  return deps.gemini.generateStructured({
    systemInstruction: THESIS_SYSTEM_PROMPT,
    prompt,
    usageLabel: THESIS_USAGE_LABEL,
    thinkingBudget: THESIS_THINKING_BUDGET,
    schema: ThesisSchema,
  });
}
