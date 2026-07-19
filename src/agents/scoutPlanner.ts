import type { GeminiService } from "../services/gemini.js";
import { ScoutQueriesSchema, type ScoutQueries } from "../types/index.js";

/**
 * usage 집계 라벨. researchPlanner와 마찬가지로 이것은 파이프라인 step 이름이 아니다 —
 * trend-scout 내부 호출이다. 그래도 gemini를 부르므로 자기 이름으로 장부에 남는다 (ADR-016).
 */
export const SCOUT_PLANNER_USAGE_LABEL = "scout-planner";

/**
 * thinking 상한 (ADR-016). 0 — 범위 힌트를 축별 검색어로 바꾸는 형식 변환이다.
 * 판단(무엇이 기회인가)은 step 3의 몫이지 여기가 아니다.
 */
export const SCOUT_PLANNER_THINKING_BUDGET = 0;

/**
 * 탐색 날짜창의 길이(개월). 이 값이 검색어에 박히고, step 3의 observedAt 하한
 * (ScoutConstraints.windowStart)과 같은 기준이어야 한다 — 검색은 18개월을 겨냥했는데
 * 검증이 12개월을 요구하면 모델이 만족시킬 수 없는 재시도 루프가 돈다.
 */
export const SCOUT_LOOKBACK_MONTHS = 18;

/**
 * 탐색 구간의 시작 시점. now를 변형하지 않는다.
 *
 * setUTCMonth의 말일 오버플로(3/31 - 1개월 → 3/3)는 여기서 문제가 되지 않는다 —
 * 이 값은 하한이라 며칠 앞당겨지거나 밀려도 창이 조금 좁아질 뿐이고, 그 방향은 안전하다.
 */
export function scoutWindowStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - SCOUT_LOOKBACK_MONTHS);
  return start;
}

export const SCOUT_PLANNER_SYSTEM_PROMPT = `당신은 자본의 이동 흔적을 찾아낼 검색어를 설계하는 스카우트 플래너다. 당신은 검색을 수행하지 않는다 — 다음 단계의 애널리스트가 실제로 던질 검색어만 만든다.

## 무엇을 찾는가
당신이 겨냥하는 것은 **자본이 남긴 날짜 붙은 흔적**이다. 신호 축은 정확히 네 가지다.

- **funding** — 섹터별 투자 라운드·M&A. 어느 분야에 돈이 새로 들어갔는가.
- **incumbent** — 기존 기업의 capex 가이던스, 실적발표에서의 전략 언급. 큰 회사가 무엇에 쓰겠다고 공언했는가.
- **regulation** — **시행일이 확정된 규제.** 네 축 중 가장 비중을 크게 둬라. 이 축만 1차 사료가 완전히 공개돼 있고, 시행일이 박힌 규제는 기업에 **강제 지출**을 만든다. 그 시행일은 아직 오지 않은 미래이므로 사전지식으로는 알 수 없다.
- **costCurve** — 단가가 임계선을 넘은 시점. 추론 비용, $/kWh, 발사 비용처럼 "이제야 경제성이 생긴" 지점.

## 인기도를 검색하지 마라
조회수·화제성·"올해의 트렌드"·"뜨는 시장"은 **검색하지 마라.** 그것은 자본 흐름이 아니라 이미 늦은 시장의 신호다. 기사가 트렌드를 이야기할 즈음이면 그 시장에는 이미 경쟁자가 있다.

## 시차를 검색하라
돈은 제품보다 먼저 움직인다. 기회는 그 **시차**에, 즉 자본이 들어간 시점과 물건이 나오는 시점 사이의 **간극**에 있다. 검색어를 이렇게 겨냥하라.
- 투자는 됐는데 **아직** 물건이 안 나온 것
- 규제로 의무화됐는데 **아직** 해결책이 없는 것
- capex는 발표됐는데 그것을 쓸 도구가 **아직** 없는 것

## 검색어 작성 원칙
- 검색 엔진이 실제로 매칭할 짧은 키워드구를 써라. 긴 서술문은 결과를 0건으로 만든다.
- 날짜창을 검색어에 박아라(연도·분기 등). 날짜가 없으면 검색 결과가 과거로 흘러간다.
- funding·incumbent·costCurve는 1차 사료가 대개 영어다 — 영어 검색어를 우선하라. regulation은 대상 관할에 맞는 언어를 써라.
- 축마다 1~3개씩 만들어라. 한 축이 비면 그 축은 조사되지 않는다.

## 출력 형식
{ "funding": ["검색어"], "incumbent": ["검색어"], "regulation": ["검색어"], "costCurve": ["검색어"] }`;

export const SCOUT_PLANNER_PROMPT_TEMPLATE = `## 탐색 범위
{scope}

## 탐색 날짜창
{windowStart} ~ {now} (오늘은 {now}다)

## 지시사항
1. 위 탐색 범위 안에서, 네 신호 축(funding·incumbent·regulation·costCurve) 각각에 대해 검색어를 1~3개씩 설계하라.
2. 검색어에 날짜창을 반영하라 — 위 구간 안의 자료가 잡혀야 한다. 그 이전의 자료는 이미 시장이 반응을 끝낸 것이다.
3. regulation 축에 가장 공을 들여라. 시행일이 확정됐고 아직 그 날짜가 오지 않은 규제를 겨냥하라.
4. "무엇이 뜨고 있는가"가 아니라 "돈이 어디로 들어갔는데 아직 물건이 없는가"를 겨냥하라.`;

/** 탐색 범위가 비었을 때 프롬프트에 넣는 표기 — RunStore의 SCOUT_FULL_SCOPE_IDEA와 같은 뜻이다 */
const FULL_SCOPE_LABEL = "전 범위 탐색 (특정 산업으로 좁히지 않는다)";

/**
 * 범위 힌트를 정규화한다. undefined·공백은 에러가 아니라 **정상 모드**다 —
 * 사용자가 산업을 특정하지 않는 것이 이 에이전트의 기본 사용법이다.
 */
function normalizeScope(scope: string | undefined): string | undefined {
  const trimmed = scope?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * planner가 죽어도 탐색은 계속된다 (researchPlanner와 같은 fail-soft 규약).
 *
 * 폴백 검색어는 축의 **모양**만 유지한다 — LLM이 만든 것보다 훨씬 무디고, scope가 있으면
 * 그것을 네 축 전부에 붙여 최소한 범위는 지킨다. 이 폴백이 발동한 run은 검색 품질이
 * 떨어지므로 로그가 유일한 관측 수단이다.
 */
function fallbackQueries(scope: string | undefined, now: Date): ScoutQueries {
  const year = now.getUTCFullYear();
  const prefix = scope === undefined ? "" : `${scope} `;

  return {
    funding: [`${prefix}funding round ${year}`, `${prefix}시리즈 투자 유치 ${year}`],
    incumbent: [`${prefix}capex guidance ${year}`, `${prefix}설비투자 계획 발표 ${year}`],
    regulation: [
      `${prefix}regulation effective date ${year}`,
      `${prefix}규제 시행일 의무화 ${year}`,
    ],
    costCurve: [`${prefix}cost per unit decline ${year}`, `${prefix}단가 하락 ${year}`],
  };
}

export interface ScoutPlannerDeps {
  gemini: GeminiService;
  log?: (message: string) => void;
}

/**
 * 신호 축별 검색어를 생성한다. 파이프라인 step이 아니라 trend-scout 내부 호출이다 —
 * non-grounding 구조화 출력에 thinkingBudget 0이라 몇 초에 끝난다.
 *
 * 소스별이 아니라 **축별**로 나누는 것이 researchPlanner와의 차이다. 자료조사는
 * "어디서 찾는가"가 갈리지만, 스카우트는 "무엇을 찾는가"가 갈린다.
 */
export async function planScoutQueries(
  deps: ScoutPlannerDeps,
  scope: string | undefined,
  now: Date,
): Promise<ScoutQueries> {
  const normalized = normalizeScope(scope);
  const prompt = SCOUT_PLANNER_PROMPT_TEMPLATE.replace(
    "{scope}",
    normalized === undefined
      ? `${FULL_SCOPE_LABEL}\n네 축 전부를 서로 다른 산업·지역으로 흩어라 — 같은 섹터를 네 번 훑으면 삼각측량이 아니라 한 이야기의 반복이 된다.`
      : `${normalized}\n네 축 전부를 이 범위 안으로 좁혀라.`,
  )
    .replace("{windowStart}", scoutWindowStart(now).toISOString().slice(0, 10))
    .replaceAll("{now}", now.toISOString().slice(0, 10));

  try {
    return await deps.gemini.generateStructured({
      systemInstruction: SCOUT_PLANNER_SYSTEM_PROMPT,
      prompt,
      usageLabel: SCOUT_PLANNER_USAGE_LABEL,
      thinkingBudget: SCOUT_PLANNER_THINKING_BUDGET,
      schema: ScoutQueriesSchema,
    });
  } catch (error) {
    // 검색어 생성 실패는 탐색을 멈출 이유가 아니다. 다만 폴백 검색어는 날짜창도 시차도
    // 겨냥하지 못하므로, 이 run의 후보 품질이 낮은 원인이 여기임을 로그가 말해줘야 한다.
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.(
      `[scout-planner] 검색어 생성 실패 — 축별 기본 검색어로 폴백한다: ${message}`,
    );
    return fallbackQueries(normalized, now);
  }
}
