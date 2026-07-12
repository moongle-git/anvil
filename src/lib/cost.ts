/**
 * 토큰 사용량 → USD 추정 (ADR-016).
 *
 * **여기서 나오는 숫자는 추정치이지 청구서가 아니다.** 진짜 청구서는 Google Cloud 콘솔에 있다.
 * 단가표가 코드에 하드코딩되어 있으므로 Google이 가격을 바꾸면 이 파일을 고쳐야 한다.
 *
 * DB도 SDK도 모르는 순수 함수 모듈이다 — services/도 cli/도 이것만 import하면 된다.
 */

/** 한 번의 generateContent 호출이 쓴 토큰. 재시도의 각 시도가 하나의 CallUsage다. */
export interface CallUsage {
  /** 호출한 에이전트 이름 (thesis, coldCritic, …). 어느 에이전트가 비싼지 보려고 있다 */
  label: string;
  model: string;
  /** Google Search grounding을 켠 호출인가 — 토큰과 별개로 요청당 정액 과금된다 */
  grounded: boolean;
  /** 1부터. 재시도한 시도도 과금되므로 시도마다 하나씩 생긴다 */
  attempt: number;
  promptTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

interface ModelPricing {
  /** USD / 1M 토큰 */
  inputPerMillion: number;
  outputPerMillion: number;
  /** 캐시 히트한 입력 토큰의 단가 */
  cachedInputPerMillion: number;
}

/**
 * 출처: https://ai.google.dev/gemini-api/docs/pricing (2026-07-12 확인).
 * thinking 토큰은 별도 단가가 없다 — **출력 요금으로 과금된다.**
 */
const PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    cachedInputPerMillion: 0.03,
  },
  "gemini-2.5-flash-lite": {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cachedInputPerMillion: 0.01,
  },
  "gemini-2.5-pro": {
    inputPerMillion: 1.25,
    outputPerMillion: 10.0,
    cachedInputPerMillion: 0.125,
  },
};

/**
 * Google Search grounding은 토큰과 별개로 요청당 과금된다 ($35 / 1,000 grounded prompt).
 * **1,500건/일까지는 무료이므로 그 한도 안이면 실제 청구는 0이다.** 무료 티어를 모델링하지
 * 않는 이유: 일 단위 누적 상태를 들고 있어야 하는데 이 도구는 그것을 알 방법이 없다.
 * 과대추정이 과소추정보다 안전하다.
 */
const GROUNDING_REQUEST_USD = 0.035;

const PER_MILLION = 1_000_000;

/**
 * 토큰 요금 + grounding 요금의 합. 추정치이지 청구서가 아니다.
 *
 * 계산에서 틀리기 쉬운 두 지점:
 * 1. `promptTokens`는 `cachedTokens`를 **이미 포함한다.** 그냥 더하면 캐시된 토큰을 두 번 센다.
 * 2. `thoughtsTokens`는 `outputTokens`에 **포함되지 않는다.** 따로 더하되 **출력 단가**로 곱한다.
 *
 * 단가를 모르는 모델은 throw하지 않고 0을 돌려준다 — 모델을 바꿨다고 파이프라인이 죽으면
 * 안 된다. 계측은 파이프라인을 방해하지 않는다. usage 행에는 model이 그대로 남으므로
 * "단가를 모르는 모델이라 0이다"라는 사실 자체는 장부에서 드러난다.
 */
export function estimateCostUsd(usage: CallUsage): number {
  const pricing = PRICING[usage.model];
  if (pricing === undefined) {
    return 0;
  }

  const uncachedInput = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const billedOutput = usage.outputTokens + usage.thoughtsTokens;

  const tokenCost =
    (uncachedInput * pricing.inputPerMillion +
      usage.cachedTokens * pricing.cachedInputPerMillion +
      billedOutput * pricing.outputPerMillion) /
    PER_MILLION;

  return tokenCost + (usage.grounded ? GROUNDING_REQUEST_USD : 0);
}
