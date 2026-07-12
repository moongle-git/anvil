# Step 1: usage-metering

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-016**이 이 step의 헌법이다. 특히 결정 2(실패한 시도의 usage도 기록한다)와 결정 3(`GeminiService`는 DB를 모른다).
- `/docs/ARCHITECTURE.md` — "서비스 레이어 격리" 패턴
- `/CLAUDE.md` — CRITICAL: TDD(테스트 먼저), 테스트에서 실제 API 호출 금지
- `src/services/gemini.ts` — **이 step의 주 무대.** 전체를 정독하라. 특히 `generateValidated`(재시도 루프)와 `extractCitations`(모든 시도의 응답을 누적하는 ADR-013 패턴 — 이번 usage 수집도 **정확히 같은 자리**에서 일어난다).
- `src/services/gemini.test.ts` — 기존 mock 방식(`GoogleGenAI` 주입)을 그대로 따를 것
- `src/lib/html.ts` + `src/lib/html.test.ts` — 이 프로젝트의 순수 유틸 모듈이 어떤 모양인지 참고

## 배경

이 step은 **토큰 사용량을 포착해 밖으로 흘려보내는 것까지만** 한다. DB 저장은 step 2, 배선은 step 3이다. 계층을 한 step에 섞으면 "포착이 틀렸는가, 저장이 틀렸는가"를 분리할 수 없다.

`GeminiService`의 `generateContent` 호출 지점은 **`gemini.ts:226` 단 한 곳**이다(`generateValidated` 안). structured·grounded 두 경로가 전부 이 함수를 통과하므로, **여기 한 곳에만 계측을 넣으면 모든 호출이 잡힌다.** 이 구조를 깨지 마라.

## 작업

### 1. `src/lib/cost.ts` 신규 생성 — 단가표 + 비용 추정

```ts
/** 한 번의 generateContent 호출이 쓴 토큰. 재시도의 각 시도가 하나의 CallUsage다. */
export interface CallUsage {
  /** 호출한 에이전트 이름 (thesis, cold-critic, …). 어느 에이전트가 비싼지 보려고 있다 */
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

/** 토큰 요금 + grounding 요금의 합. 추정치이지 청구서가 아니다. */
export function estimateCostUsd(usage: CallUsage): number;
```

**단가표**(2026-07 기준, ai.google.dev/gemini-api/docs/pricing — 출처와 확인 날짜를 주석에 남겨라):

| 모델 | 입력 /1M | 출력 /1M | 캐시된 입력 /1M |
|---|---|---|---|
| `gemini-2.5-flash` | $0.30 | $2.50 | $0.03 |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | $0.01 |
| `gemini-2.5-pro` | $1.25 | $10.00 | $0.125 |

Google Search grounding: **1,500건/일 무료, 이후 $35 / 1,000 grounded prompt = 건당 $0.035**.

**계산식 — 이걸 틀리면 계측 전체가 거짓말이 된다:**

```
cost = (promptTokens - cachedTokens) × 입력단가
     + cachedTokens                  × 캐시단가
     + (outputTokens + thoughtsTokens) × 출력단가     // ★ thinking은 출력 요금이다
     + (grounded ? 0.035 : 0)
```

두 가지를 반드시 지켜라:

1. **`promptTokenCount`는 `cachedContentTokenCount`를 이미 포함한다.** 그냥 더하면 캐시된 토큰을 두 번 센다. 위 식처럼 **빼고** 계산하라.
2. **`thoughtsTokenCount`는 `candidatesTokenCount`에 포함되지 않는다.** 별도로 더해야 한다. 그리고 **입력이 아니라 출력 단가**로 곱한다 — 이것이 이 phase 전체의 존재 이유다.

무료 티어(1,500 grounded/일)는 **모델링하지 마라.** 일 단위 상태를 들고 있어야 하고, 이 도구는 그것을 알 방법이 없다. 건당 $0.035를 그대로 계산하고, **"grounding 무료 한도(1,500건/일) 안이면 실제 청구는 0이다"**를 주석으로 남겨라. 과대추정은 과소추정보다 안전하다.

모르는 모델 ID가 오면 **throw하지 말고 비용 0으로 처리하되 그 사실이 드러나게 하라**(예: `model`을 그대로 담아두고 cost 0). 이유: 모델을 바꿨다고 파이프라인이 죽으면 안 된다. 계측은 파이프라인을 방해하지 않는다.

### 2. `src/services/gemini.ts` — usage 포착

```ts
export interface GeminiServiceOptions {
  // ... 기존 필드 유지
  /** 매 generateContent 응답마다(재시도 포함) 호출된다. DB 기록은 호출자가 한다 */
  onUsage?: (usage: CallUsage) => void;
}

export interface GenerateStructuredParams<T> {
  // ... 기존 필드 유지
  /** 어느 에이전트의 호출인가 (usage 집계용) */
  usageLabel: string;
}

export interface GenerateGroundedParams<T> {
  // ... 기존 필드 유지
  usageLabel: string;
}
```

`generateValidated`의 재시도 루프(`gemini.ts:218-258`) 안, `responses.push(response)` 바로 옆에서 usage를 뽑아 `onUsage`를 호출하라.

**반드시 지킬 것:**

- **검증 성공/실패와 무관하게 매 시도마다 호출한다.** 실패한 시도도 과금됐다 (ADR-016 결정 2). `continue`나 `throw` 경로에서 usage가 새지 않는지 확인하라.
- `response.usageMetadata`가 **`undefined`일 수 있다.** 그때는 `onUsage`를 부르지 않거나 0으로 채우되, **절대 throw하지 마라.** 계측 실패가 파이프라인을 죽이면 안 된다.
- `onUsage` 콜백이 **throw해도 파이프라인이 죽으면 안 된다.** try/catch로 감싸라. 이유: 계측은 부수적 관심사다. DB 쓰기 실패가 컨설팅 실행을 중단시키는 것은 꼬리가 개를 흔드는 것이다.
- `attempt`는 루프 변수를 그대로 쓴다(1부터).
- `grounded`는 `generateGrounded` 경로면 `true`. `generateValidated`에 파라미터로 넘겨라(이미 `extractJson: boolean`을 넘기고 있지만 **그것을 재사용하지 마라** — 우연히 값이 같을 뿐 의미가 다르다. 의미가 다른 두 개념에 한 플래그를 쓰면 나중에 반드시 어긋난다).

### 3. 테스트 — TDD, 먼저 쓴다

`src/lib/cost.test.ts` (신규):

- 캐시된 토큰을 **두 번 세지 않는다**: `promptTokens: 1000, cachedTokens: 400`이면 `600 × 입력단가 + 400 × 캐시단가`다. 이 케이스를 명시적으로 못박아라.
- **thinking 토큰이 출력 단가로 계산된다**: `thoughtsTokens`만 다른 두 usage의 비용 차가 `(차이 × 출력단가)`와 일치한다.
- grounded 호출에 $0.035가 더해지고, non-grounded에는 더해지지 않는다.
- 모르는 모델 ID → throw하지 않고 0을 반환한다.

`src/services/gemini.test.ts` (기존 파일에 추가):

- mock 응답에 `usageMetadata`를 실어 보내고 `onUsage`가 **정확한 값**으로 호출되는지 검증한다.
- **★ 재시도 시 `onUsage`가 시도마다 호출된다**: 1차 응답을 스키마 위반 JSON으로, 2차를 정상으로 mock하면 `onUsage`가 **2번** 불린다(`attempt: 1`, `attempt: 2`). **이 테스트가 이 step의 핵심이다** — 없으면 재시도 비용이 장부에서 조용히 사라진다.
- `usageMetadata`가 `undefined`인 응답에서 throw하지 않는다.
- **`onUsage`가 throw해도 `generateStructured`는 정상적으로 값을 반환한다.**
- `generateGrounded`의 usage는 `grounded: true`다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 전 테스트 통과 (신규 cost.test.ts 포함)
npm run lint    # 통과

# API 키 없이도 통과해야 한다 (CLAUDE.md CRITICAL)
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --stat`으로 `src/lib/db.ts`·`src/lib/runStore.ts`·`src/pipeline/`·`web/`이 **변경되지 않았음**을 확인한다.
3. 아키텍처 체크리스트:
   - **`src/services/gemini.ts`가 `RunStore`·`node:sqlite`·`src/lib/db`를 import하지 않는가?** (ADR-016 결정 3)
   - `generateContent` 호출 지점이 여전히 **한 곳**인가? 계측을 넣겠다고 호출을 복제하지 않았는가?
   - CLAUDE.md CRITICAL: 테스트가 실제 Gemini API를 때리지 않는가?
4. `phases/7-cost-control/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 **`CallUsage` 필드 목록·`estimateCostUsd` 시그니처·`onUsage` 옵션의 위치**를 적어라 (step 2·3이 그대로 쓴다)
   - 실패 → `"status": "error"`, `"error_message": "..."`

## 금지사항

- **`GeminiService`에서 DB를 import하지 마라.** 이유: ADR-016 결정 3 / CLAUDE.md CRITICAL. `services/`는 외부 API 래퍼다. import하는 순간 Gemini mock 테스트가 DB를 끌고 온다.
- **성공한 시도의 usage만 기록하지 마라.** 이유: 실패한 시도도 과금된다(ADR-016 결정 2). 재시도는 프롬프트 전문을 재전송하는 가장 비싼 경로인데, 그 비용이 장부에서 사라지면 계측의 의미가 없다.
- **`extractJson` 플래그를 `grounded`로 재사용하지 마라.** 이유: 지금은 우연히 값이 같지만 의미가 다르다("JSON을 텍스트에서 긁어내는가" vs "검색 도구를 켰는가"). 하나가 바뀌면 다른 하나가 조용히 틀린다.
- **`thinkingConfig`를 이 step에서 추가하지 마라.** 이유: step 4의 scope다. **먼저 현재 thinking 사용량을 측정해야 budget을 근거 있게 정할 수 있다** — 이 순서가 이 phase 설계의 핵심이다.
- **계측 실패가 파이프라인을 죽이게 하지 마라.** `usageMetadata` 부재도, `onUsage` throw도 삼켜야 한다. 이유: 계측은 부수적 관심사다.
- 기존 테스트를 깨뜨리지 마라. (`usageLabel`이 필수 필드가 되면 기존 호출부가 컴파일 에러를 낸다 — 에이전트 호출부에 label을 추가하는 것은 step 3이므로, **이 step에서는 `usageLabel`을 옵셔널로 두거나 에이전트에 최소한의 label만 붙여 빌드를 통과시켜라.** 어느 쪽이든 step 3에서 정식으로 정리한다.)
