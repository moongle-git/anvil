# Step 4: thinking-budget

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-016 결정 4**(thinking은 끄지 않고 상한을 둔다)와 **ADR-010**(판정자를 별도 에이전트로 분리한 이유 — 판정 품질이 이 도구의 존재 이유다)
- `src/services/gemini.ts` — `generateValidated`의 `baseConfig` 조립부(structured `:269-273`, grounded `:298`)
- `src/lib/cost.ts` (step 1) — thinking이 **출력 단가**로 계산된다는 사실
- `phases/7-cost-control/index.json`의 **step 3 summary** — **기준선 비용 실측치가 여기 있다.** 그 숫자를 읽고 시작하라.
- `src/agents/*.ts` 7개 — 각 에이전트의 역할과 프롬프트

## 배경 — 이 step이 이 phase의 본론이다

`gemini-2.5-flash`는 `thinkingConfig`를 주지 않으면 **동적 thinking이 기본 ON**이고, 콜당 최대 8,192 thinking 토큰을 쓴다. 그리고 **thinking 토큰은 출력 요금($2.50/1M)으로 과금된다.**

현재 코드에는 `thinkingConfig`가 **한 줄도 없다.** 즉 7번의 Gemini 호출이 전부 무제한 dynamic thinking으로 돌고 있고, 이것이 비용의 과반일 것으로 추정된다(step 3의 기준선이 확정해준다).

**step 3의 실측 `thoughtsRatio`를 먼저 확인하라.** 그 숫자가 예상(~58%)보다 훨씬 낮다면 이 step의 절감 효과도 그만큼 작다 — `summary`에 그 사실을 정직하게 기록하고, budget은 계획대로 넣되 **효과를 부풀려 적지 마라.**

## 작업

### 1. `src/services/gemini.ts` — 호출별 `thinkingBudget`

```ts
export interface GenerateStructuredParams<T> {
  // ... 기존 필드
  /** thinking 토큰 상한. 0이면 thinking을 끈다. 생략하면 모델 기본값(무제한 dynamic) */
  thinkingBudget?: number;
}

export interface GenerateGroundedParams<T> {
  // ... 기존 필드
  thinkingBudget?: number;
}
```

`baseConfig`에 반영:

```ts
config.thinkingConfig = { thinkingBudget, includeThoughts: false };
```

`includeThoughts: false`를 명시하라 — thought 원문을 응답으로 받아올 이유가 없다(받으면 그것도 토큰이다).

`thinkingBudget`이 `undefined`면 `thinkingConfig` 자체를 넣지 마라(현재 동작 유지). 이유: 옵셔널의 의미를 "모델 기본값"으로 유지해야 나중에 모델을 바꿨을 때 예상 밖의 강제가 걸리지 않는다.

**grounded 호출에도 `thinkingConfig`가 들어간다.** `googleSearch`·`urlContext` 도구와 `thinkingConfig`는 병용 가능하다. 만약 실행 중 API가 이 조합을 거부하면(에러 메시지에 thinking/tool 관련 문구) **혼자 추측해서 우회하지 말고** `"status": "blocked"`, `"blocked_reason"`에 **정확한 API 에러 원문**을 적고 중단하라.

### 2. 에이전트별 budget

각 에이전트 파일에 **이름 붙인 상수**로 둔다(매직 넘버 금지). 예: `const THINKING_BUDGET = 4096;`

| 에이전트 | budget | 근거 |
|---|---|---|
| `researchPlanner` | **0** | 소스별 검색어 생성 — 형식 변환에 가깝다. 추론 불필요 |
| `interviewer` | **0** | 아이디어의 모호점 질문 생성 — 추론 불필요 |
| `thesis` | **2048** | 正 논제 — context를 근거로 낙관 논증 |
| `solutionDesigner` | **2048** | 合 피벗 설계 |
| `verdict` | **2048** | 최종 판정 |
| `contextHunter` (grounded) | **4096** | 최대 82건의 원문 + 검색 결과를 압축한다. 파이프라인에서 입력이 가장 무거운 호출 |
| `coldCritic` | **4096** | 3축 비판 — 추론이 가장 무겁고, 축별 severity·riskScore 밴드 검증이 까다로워 재시도가 잦다 |

**`researchPlanner`와 `interviewer`를 0으로 두는 것이 이 step에서 가장 안전하고 확실한 절감이다.** 이 둘은 판단이 아니라 생성이다.

**나머지를 0으로 두지 마라.** ADR-016 결정 4 — coldCritic의 비판 깊이와 verdict의 판정 품질이 이 도구의 존재 이유다.

### 3. 테스트

- `src/services/gemini.test.ts`: `thinkingBudget: 0`이면 `generateContent`에 넘어간 config가 `thinkingConfig: { thinkingBudget: 0, includeThoughts: false }`를 갖는다. **생략하면 `thinkingConfig` 키가 아예 없다.**
- grounded 호출도 `thinkingConfig`를 갖는다(도구와 함께).
- 각 에이전트 테스트: 자기 budget 상수를 실제로 넘긴다. mock에 전달된 params를 단언하라.

**주의**: 기존 에이전트 테스트가 `generateStructured`에 넘어간 인자를 통째로 단언(`toHaveBeenCalledWith({...})`)하고 있다면 `thinkingBudget` 추가로 깨진다. 필드 단위 단언으로 바꿔라 — 통째 단언은 브리틀하다.

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **★ 실제 API로 after를 측정하고 before와 비교한다.** step 3과 **같은 아이디어**로, 같은 스크래치 DB에 돌려라:
   ```bash
   ANVIL_DB_PATH=/tmp/anvil-baseline.db npm run consult -- "직장인을 위한 AI 회의록 요약 서비스" 2>&1 >/tmp/after-report.md | tail -30
   ```
   `summary`에 **before/after를 나란히** 적어라: 총 USD, thinking 토큰, `thoughtsRatio`, label별 비용. **절감률을 실측치로 계산해 적어라.**
3. **품질 회귀 확인 (수동)**: step 3의 baseline 리포트와 이번 리포트를 비교하라. 최소한 이 세 가지를 세어라:
   - `coldCritic`의 비판 개수(`points[]` 길이)와 축(`axis`) 분포 — 3축이 다 나왔는가?
   - `verdict`의 점수와 판정
   - `communityVoices` 인용 개수

   숫자를 `summary`에 적어라. **눈에 띄게 나빠졌으면 해당 에이전트의 budget만 올리고 다시 측정하라**(다른 에이전트는 건드리지 마라 — 무엇이 효과를 냈는지 분리할 수 없게 된다).
4. 아키텍처 체크리스트:
   - budget이 **이름 붙은 상수**인가? (매직 넘버 금지)
   - `thinkingBudget`을 생략했을 때 `thinkingConfig`가 config에 들어가지 않는가?
5. `phases/7-cost-control/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 **before/after 실측 + 품질 지표 3종**
   - `GEMINI_API_KEY`가 없거나 외부 호출이 막히면 → `"status": "blocked"`, `"blocked_reason": "..."`

## 금지사항

- **전 에이전트의 budget을 0으로 두지 마라.** 이유: ADR-016 결정 4. 사용자가 "상한"을 택했지 "제거"를 택하지 않았다. coldCritic의 비판 깊이와 verdict의 판정 품질이 이 도구의 존재 이유다(ADR-010).
- **budget 값을 매직 넘버로 흩뿌리지 마라.** 이름 붙인 상수로 각 에이전트 파일에 둬라. 이유: 품질 회귀 시 조정하는 곳이 한 곳이어야 한다.
- **품질이 나빠졌는데 "비용이 줄었으니 성공"이라고 적지 마라.** 이유: 이 도구는 컨설팅 리포트의 질이 전부다. 비용을 줄이려고 결과를 망치면 phase 자체가 실패다. 회귀가 보이면 정직하게 적고 budget을 올려라.
- **프롬프트를 손대지 마라.** 이유: step 5의 scope이고, 프롬프트와 budget을 동시에 바꾸면 품질 변화의 원인을 분리할 수 없다.
- **모델을 바꾸지 마라**(`flash-lite` 등). 이유: ADR-016이 "thinking 상한만으로 목표에 도달하는지 먼저 본다"고 기각했다. 계측 데이터가 쌓인 뒤 다음 phase에서 판단한다.
- 기존 테스트를 깨뜨리지 마라.
