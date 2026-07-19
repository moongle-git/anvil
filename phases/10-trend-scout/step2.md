# Step 2: scout-search

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "패턴", "데이터 흐름"
- `/docs/ADR.md` — **ADR-012**(자료조사 다중 소스 + grounding 인용 코드 추출), **ADR-013**(출처는 판단이 아니라 사실이다), **ADR-016**(비용·thinking 상한)
- `src/agents/researchPlanner.ts` — **이 step이 복제할 선례다.** 검색어를 별도 non-grounded 호출로 분리한 이유와 fail-soft 폴백
- `src/agents/contextHunter.ts` — `generateGrounded` 사용법, citations 코드 주입
- `src/services/gemini.ts` — 전체. 특히 `generateGrounded`, `extractCitations`, `GroundingCitation`, `GenerateGroundedParams`
- `src/services/gemini.test.ts` — Gemini를 mock하는 방식
- `src/types/opportunity.ts` — step 0에서 생성됨. `ScoutQueriesSchema`, `ScoutDossierSchema`, `SIGNAL_TYPES`

## 이전 step에서 만들어진 것

- step 0: `src/types/opportunity.ts` — 모든 zod 스키마 + `opportunitiesSchemaFor` 팩토리
- step 1: `RunStore`의 scout 모드 seeding, `opportunities`·`selection` 아티팩트 접근자

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경: 왜 검색과 후보 생성을 쪼개는가

`trend-scout`은 grounded 호출 **한 번에** 후보까지 만들지 않는다. 두 단계로 나눈다. 이유가 세 가지다.

1. **귀속을 강제할 수 없다.** grounding이 돌려주는 인용 URI는 만료되는 `vertexaisearch` 리다이렉트 주소다(`src/services/gemini.ts`의 `extractCitations` 주석). LLM은 그것을 볼 수도 타이핑할 수도 없다. 자기가 본 근거를 지목할 수단이 없으면 지어내는 것 외에 방법이 없다. 코드가 인용에 `C1`·`C2` 번호를 붙여 **다음 호출의 프롬프트에 넣어줘야** ID 지목이 가능해진다. `contextHunter`가 커뮤니티 목소리에 `[V1]`·`[V2]`를 붙이는 것과 완전히 같은 패턴이다.
2. **grounding은 구조화 출력을 못 쓴다.** `generateGrounded`는 자유 텍스트에서 JSON을 긁어낸다(`gemini.ts`의 해당 주석 참조). 후보 스키마는 중첩이 깊어 이 방식으로는 형식 실패가 쏟아진다.
3. **그래서 비싸진다.** ADR-016 실측에서 `context-hunter` 비용을 부풀린 원인이 "grounding 정액 + 형식 실패 재시도"였다. 검색 단계의 산출물을 단순하게 유지하면 비싼 호출이 형식 때문에 재시도되지 않는다.

이 step은 그중 **앞 두 단계**(검색어 설계 + grounded 검색)를 만든다. 후보 생성은 step 3이다.

## 작업

### 1. `src/agents/scoutPlanner.ts`

`researchPlanner.ts`의 구조를 그대로 따라라 — 상수 네이밍(`*_USAGE_LABEL`, `*_THINKING_BUDGET`, `*_SYSTEM_PROMPT`, `*_PROMPT_TEMPLATE`), export 방식, fail-soft 폴백까지.

```ts
export const SCOUT_PLANNER_USAGE_LABEL = "scout-planner";
export const SCOUT_PLANNER_THINKING_BUDGET = 0;

export async function planScoutQueries(
  deps: { gemini: GeminiService; log?: (message: string) => void },
  scope: string | undefined,
  now: Date,
): Promise<ScoutQueries>;
```

- `researchPlanner`처럼 **step이 아니다.** `trend-scout` 내부 호출이며, non-grounded·`thinkingBudget: 0`이라 몇 초에 끝난다. 그래도 gemini를 부르므로 `scout-planner` 라벨로 usage 장부에 남는다(ADR-016).
- 실패해도 throw하지 마라. 로그를 남기고 각 축의 기본 검색어로 폴백하라 — `researchPlanner`의 폴백과 같은 규약이다.

#### 프롬프트가 겨냥할 것

**인기도를 검색하지 마라.** 조회수·화제성·"올해의 트렌드"는 이 에이전트가 찾는 것이 아니다. 자본이 남기는 **날짜 붙은 흔적** 네 종류를 각각 겨냥한다:

| `signalType` | 검색 대상 |
|---|---|
| `funding` | 섹터별 투자 라운드·M&A |
| `incumbent` | 기존 기업의 capex 가이던스, 실적발표에서의 전략 언급 |
| `regulation` | **시행일이 확정된 규제** |
| `costCurve` | 단가가 임계선을 넘은 시점 (추론 비용, $/kWh, 발사 비용 등) |

`regulation`에 비중을 실어라. 네 축 중 유일하게 1차 사료가 완전히 공개돼 있고, 시행일이 박힌 규제는 **강제 지출**을 만들며, 그 날짜는 모델의 사전지식에 없는 미래다.

**시차를 검색하라.** "지금 뜨는 것"을 검색하면 이미 늦은 시장이 나온다. 돈은 제품보다 먼저 움직이므로 기회는 그 사이 간극에 있다. 검색어를 이렇게 겨냥하라:
- 투자는 됐는데 아직 물건이 안 나온 것
- 규제로 의무화됐는데 해결책이 없는 것
- capex는 발표됐는데 그걸 쓸 도구가 없는 것

**날짜창을 검색어에 박아라.** `now` 기준 최근 `SCOUT_LOOKBACK_MONTHS`(상수로 정의, 기본 18) 안의 자료를 겨냥하게 하라.

**범위 힌트 처리:** `scope`가 있으면 네 축 전부를 그 범위 안으로 좁힌다. 없으면 축별로 서로 다른 산업·지역을 훑도록 지시해 전 범위를 커버한다. `scope` 부재는 에러가 아니라 정상 모드다.

### 2. `src/agents/scoutSearch.ts`

```ts
export const SCOUT_SEARCH_USAGE_LABEL = "scout-search";
export const SCOUT_SEARCH_THINKING_BUDGET = 4096;

export interface ScoutSearchResult {
  dossier: ScoutDossier;
  citations: GroundingCitation[];
  webSearchQueries: string[];
}

export async function searchCapitalSignals(
  deps: { gemini: GeminiService; log?: (message: string) => void },
  queries: ScoutQueries,
): Promise<ScoutSearchResult>;
```

- `generateGrounded`를 쓴다. `schema`는 **`ScoutDossierSchema`** — 후보가 아니라 **사실 목록**이다.
- `useUrlContext`는 `false`로 둬라. `contextHunter`가 그것을 켜는 이유는 경쟁사 공식 페이지의 가격·기능을 읽기 위해서인데, 여기서는 읽을 대상 URL이 사전에 없고 왕복만 늘어난다.
- `thinkingBudget: 4096` — 검색 결과를 사실 목록으로 정리하는 작업이다. `contextHunter`(8192)보다 가볍고 `researchPlanner`(0)보다 무겁다. 판단(후보 구성)은 step 3이 한다.
- 모델이 실제로 검색한 쿼리(`webSearchQueries`)를 로그로 남겨라 — 검색어 설계가 먹혔는지 관측하는 유일한 수단이다.

**dossier 프롬프트에서 사업 아이디어를 만들게 하지 마라.** 이 호출의 유일한 임무는 "무엇이 관측되었는가"다. 여기서 후보를 만들면 그 후보는 번호 붙은 인용을 보지 못한 상태로 만들어진 것이라 귀속을 강제할 수 없다.

### 3. `groundingSupports` 조사 — 이 step의 열린 과제

각 신호에 출처 원문에서 그대로 딴 `quote`를 요구하고, **그 문장이 실제로 검색된 내용에 있는지 코드가 대조**할 수 있다면 환각 방어가 한 겹 더 생긴다.

현재 `extractCitations`는 `candidate.groundingMetadata.groundingChunks`만 읽는다. Gemini 응답의 `groundingMetadata`에 **`groundingSupports`가 있고 거기에 원문 텍스트 세그먼트가 담기는지 확인하라.**

조사 방법:
1. `src/services/gemini.test.ts`가 mock하는 응답 구조와 `@google/genai` 타입 정의(`node_modules/@google/genai`)에서 `groundingMetadata`의 필드를 확인한다.
2. 타입상 텍스트 세그먼트가 존재하면, `extractCitations` 옆에 **별도 함수**로 세그먼트 추출기를 추가하라(`extractCitations`를 바꾸지 마라 — 기존 계약이 테스트로 고정돼 있다).

결과에 따라:
- **텍스트 세그먼트가 있다** → 추출기를 만들고, step 3이 `quote` 대조에 쓸 수 있도록 `ScoutSearchResult`에 실어 보내라.
- **없다** → `quote`는 대조하지 않는다. `CapitalSignal.quote`는 optional로 남기고, **사람이 눈으로 검증**하도록 UI에 노출한다(step 8). 이 경우 **코드로 대조하는 척하지 마라.**

어느 쪽이든 **판단 근거와 결론을 코드 주석으로 남겨라.** 다음 사람이 같은 조사를 반복하지 않아야 한다. 확인하지 못한 것을 확인한 것처럼 적지 마라 — 이 phase 전체가 그것을 막으려는 것이다.

### 4. 테스트

CLAUDE.md CRITICAL: **테스트에서 실제 외부 API를 호출하지 마라.** Gemini는 반드시 mock한다. API 키 없이 `npm test`가 통과해야 한다.

`src/agents/scoutPlanner.test.ts`, `src/agents/scoutSearch.test.ts`를 **먼저** 작성하라(TDD):

- `planScoutQueries` — `scope`가 있을 때 네 축 검색어에 반영된다
- `planScoutQueries` — `scope`가 `undefined`여도 정상 동작한다(에러 아님)
- `planScoutQueries` — gemini가 throw해도 throw하지 않고 폴백 검색어를 반환하며 로그를 남긴다
- `searchCapitalSignals` — `generateGrounded`에 `ScoutDossierSchema`가 전달되고 `useUrlContext: false`다
- `searchCapitalSignals` — citations를 그대로 실어 반환한다
- `searchCapitalSignals` — grounding이 아무것도 못 찾아 citations가 0건이어도 throw하지 않는다 (침묵은 정상 상태다)

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (GEMINI_API_KEY 없이)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - **외부 API 호출이 `src/services/` 안에만 있는가?** `agents/`에서 직접 fetch·SDK 호출을 하지 않았는가?
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` — **`groundingSupports` 조사 결론을 반드시 summary에 포함하라.** step 3이 그 결론에 의존한다
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **`scoutSearch`에서 후보(Opportunity)를 생성하지 마라.** 이유: 번호 붙은 인용을 보지 못한 상태의 산출물이라 귀속을 강제할 수 없다. 두 단계로 나눈 이유 전체가 이것이다.
- **`agents/`에서 fetch·SDK를 직접 호출하지 마라.** 이유: CLAUDE.md CRITICAL — 외부 API는 `services/`에서만 처리한다.
- **테스트에서 실제 Gemini API를 호출하지 마라.** 이유: CLAUDE.md CRITICAL — API 키 없이 `npm test`가 통과해야 한다.
- **`extractCitations`의 기존 동작을 바꾸지 마라.** 이유: "형식 실패한 시도의 groundingMetadata도 함께 모은다"는 계약이 ADR-013의 결정이고 테스트로 고정돼 있다. 새 추출기는 별도 함수로 추가하라.
- **`planScoutQueries` 실패를 throw로 만들지 마라.** 이유: 검색어 생성 실패는 탐색을 멈출 이유가 아니다(`researchPlanner`와 같은 fail-soft 규약).
- **인기·화제성·조회수를 겨냥하는 검색어를 넣지 마라.** 이유: 그것은 자본 흐름이 아니라 이미 늦은 시장의 신호다.
- 기존 테스트를 깨뜨리지 마라.
