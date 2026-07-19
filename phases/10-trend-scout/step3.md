# Step 3: scout-synthesis

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` — "패턴", "데이터 흐름"
- `/docs/ADR.md` — **ADR-013**(출처는 판단이 아니라 사실이다), **ADR-017**(교차 산출물 검증은 스키마 팩토리다), **ADR-004**(하네스 패턴 자가 교정)
- `src/agents/contextHunter.ts` — 특히 `resolveVoiceRefs`. **이 step이 복제할 선례다** (LLM은 ID로 지목, 코드가 실체 치환, 모르는 ID는 드롭)
- `src/research/format.ts` — `formatEvidenceSection`, `parseVoiceRef`. 증거에 ID를 붙여 프롬프트에 넣는 방식
- `src/types/opportunity.ts` — step 0 산출물. `opportunitiesSchemaFor`
- `src/agents/scoutPlanner.ts`, `src/agents/scoutSearch.ts` — step 2 산출물
- `src/services/gemini.ts` — `generateStructured`

## 이전 step에서 만들어진 것

- step 0: 모든 zod 스키마 + `opportunitiesSchemaFor(constraints)` 팩토리 (화이트리스트·삼각측량·날짜·수치 귀속 강제)
- step 1: `RunStore`의 scout seeding과 `opportunities`·`selection` 접근자
- step 2: `planScoutQueries`(검색어 행렬), `searchCapitalSignals`(grounded 검색 → dossier + citations). **`groundingSupports`에 원문 텍스트가 담기는지에 대한 조사 결론이 step 2의 summary에 있다 — 반드시 확인하고 그 결론을 따르라.**

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

### `src/agents/trendScout.ts` — 세 단계를 엮는 에이전트 본체

```ts
export const TREND_SCOUT_USAGE_LABEL = "trend-scout";
export const TREND_SCOUT_THINKING_BUDGET = 8192;

export interface TrendScoutDeps {
  gemini: GeminiService;
  log?: (message: string) => void;
}

export async function runTrendScout(
  deps: TrendScoutDeps,
  scope: string | undefined,
  now: Date,
): Promise<Opportunities>;
```

흐름:

```
planScoutQueries(scope, now)          non-grounded, budget 0   → 검색어 행렬
     ↓
searchCapitalSignals(queries)         grounded                 → dossier + citations
     ↓ 코드가 citations에 C1·C2·… 번호 부여
generateStructured(...)               non-grounded, budget 8192 → 후보 draft (ID로만 지목)
     ↓ 코드가 ID → 실제 citation 객체로 치환
Opportunities
```

`usageLabel`은 `trend-scout` — 파이프라인 step 이름과 같아야 usage와 step 상태를 나란히 볼 수 있다(ADR-016). `scout-planner`·`scout-search`는 자기 라벨로 각각 남으므로 한 run에 세 라벨이 생긴다. 정상이다.

### 1. 침묵 게이트 — 이 step에서 가장 중요한 다섯 줄

```
citations.length === 0  →  candidates: [] 를 반환하고 즉시 종료
```

**합성 호출 자체를 하지 마라.** grounding이 아무것도 못 찾았다는 것은 근거가 하나도 없다는 뜻이고, 그 상태에서 후보를 만들면 나오는 것은 전부 모델의 사전지식, 즉 환각이다. 토큰도 아낀다.

이것이 나머지 모든 장치를 떠받친다. 다른 장치들은 "지어내면 걸린다"이지만 이것만 **"지어낼 이유를 없앤다"** 이다. 빈손으로 돌아올 길이 없는 시스템에서 모델은 반드시 무언가를 내놓게 되고, 그때 나오는 것이 환각이다.

로그를 반드시 남겨라 — 빈 배열은 눈치채기 어렵고, 로그가 유일한 관측 수단이다.

### 2. 인용에 ID 부여 · 프롬프트 구성

`formatEvidenceSection`이 목소리에 `[V1]`을 붙이는 방식을 그대로 따라, citations를 `[C1]`·`[C2]`… 로 번호 붙여 프롬프트 섹션으로 만들어라. 각 항목에 LLM이 판단할 수 있는 정보(`title`, `domain`)를 함께 노출하라. `uri`는 만료되는 리다이렉트 주소라 판단에 쓸모가 없으니 넣어도 그만이다.

dossier의 `findings[]`도 함께 프롬프트에 넣는다. 다만 **findings와 citations는 별개의 목록**이다 — findings는 모델이 앞 호출에서 서술한 것이고, citations는 코드가 추출한 것이다. 모델이 둘을 짝지어야 한다.

프롬프트에 박아야 할 지시:
- **`[C*]` ID로만 지목하라. URL을 타이핑하지 마라.** 존재하지 않는 ID는 검증에서 실패한다.
- 후보마다 서로 다른 `signalType` 2종 이상 + 서로 다른 `[C*]` 2개 이상 (삼각측량)
- 모든 신호에 `observedAt` 필수
- 금액·퍼센트는 반드시 `figures[]`에 `[C*]`와 함께 담아라
- `counterSignal` — 이 주제에 **불리한** 증거를 반드시 하나 찾아 담아라
- **근거가 부족하면 후보를 만들지 마라. `candidates: []`가 정당한 답이다.**
- 점수·순위를 매기지 마라
- 후보 최대 5개

### 3. 스키마 팩토리로 검증 (ADR-017)

```ts
const schema = opportunitiesSchemaFor({
  citationIds,          // ["C1", "C2", …]
  now,
  windowStart,          // now - SCOUT_LOOKBACK_MONTHS
});
```

이 스키마를 **`generateStructured`의 `schema` 인자로 넘겨라.** 검증을 호출 바깥으로 빼지 마라 — 반환된 **뒤**라 자가 교정 재시도가 붙지 않는다(ADR-017이 명시한 이유). 검증 에러 메시지가 곧 재시도 프롬프트의 피드백이다.

이 호출은 grounded가 아니므로 `responseJsonSchema`를 쓸 수 있다. grounding의 자유 텍스트 JSON 추출보다 형식 실패가 훨씬 적다 — 두 단계로 나눈 이유 중 하나다.

### 4. ID → 실체 치환

`contextHunter`의 `resolveVoiceRefs`를 본떠 `citationRef`를 실제 `Citation` 객체로 치환하라.

- 스키마가 이미 화이트리스트를 강제하므로 여기서 모르는 ID가 나오면 안 된다. 그래도 **드롭 + 로그**를 남겨라 — 방어적 이중 장치이고, 로그가 환각을 관측하는 계기다.
- **퍼지 매칭을 하지 마라.** "가장 비슷한 인용"으로 때우면 환각이 그럴듯한 근거로 세탁된다(`resolveVoiceRefs` 주석이 못박은 것).
- 최종 `Opportunity`에 `citationRef` 문자열이 남으면 안 된다. ref는 dossier 내부 좌표이지 산출물이 아니다(ADR-013).

### 5. `quote` 대조 — step 2의 조사 결론을 따른다

- step 2가 **원문 세그먼트 추출이 가능하다**고 결론지었으면, `quote`가 실제 검색 내용에 있는지 대조하고 불일치는 드롭 + 로그로 처리하라.
- **불가능하다**고 결론지었으면 대조하지 마라. `quote`는 optional로 두고 사람이 검증하도록 UI(step 8)에 넘긴다.

**대조하지 않으면서 대조하는 것처럼 주석을 쓰지 마라.**

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (GEMINI_API_KEY 없이)
npm run lint
```

`src/agents/trendScout.test.ts`를 **먼저** 작성하라(TDD). Gemini는 반드시 mock한다. 최소한 아래를 덮어라:

- **citations 0건 → `candidates: []`이고 합성용 `generateStructured`가 호출되지 않는다** (침묵 게이트)
- 프롬프트에 `[C1]`·`[C2]` 형태로 번호 붙은 인용 섹션이 들어간다
- `generateStructured`에 넘어간 schema가 화이트리스트 밖 ref를 거부한다 (팩토리가 실제로 배선됐는지)
- 정상 응답 → 최종 산출물에 `citationRef` 문자열이 남지 않고 `Citation` 객체로 치환돼 있다
- 모델이 유효 ID를 지목 → 해당 citation의 `title`·`domain`이 보존된다
- `scope`가 `undefined`여도 정상 동작한다
- 후보 6개를 반환 → 검증 실패 (최대 5)

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
   - 외부 API 호출이 `src/services/` 안에만 있는가?
3. 결과에 따라 `phases/10-trend-scout/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **citations가 0건인데 합성 호출을 하지 마라.** 이유: 근거 없이 만든 후보는 전부 모델의 사전지식이다. 이 게이트가 나머지 장치의 전제다.
- **검증을 `generateStructured` 바깥으로 빼지 마라.** 이유: 반환된 뒤에 검증하면 자가 교정 재시도가 붙지 않는다(ADR-017).
- **모르는 `citationRef`를 퍼지 매칭으로 때우지 마라.** 이유: 환각을 그럴듯한 근거로 세탁한다. 드롭하고 로그를 남겨라.
- **LLM에게 URL을 적어내게 하지 마라.** 이유: grounding URI는 만료되는 리다이렉트 주소라 LLM이 볼 수 없고, 물어보면 지어낸다(ADR-012·ADR-013).
- **후보에 점수·순위를 매기게 하지 마라.** 이유: ADR-010. 파이프라인 완주 전에 결론이 나오면 `verdict`가 할 일이 없다.
- **"이미 레드오션인가"를 여기서 걸러내지 마라.** 이유: 그것은 `cold-critic`(反)의 일이다. 앞단에서 미리 거르면 反이 공격할 표적이 사라지고 변증법 전체가 무의미해진다.
- **테스트에서 실제 Gemini API를 호출하지 마라.** 이유: CLAUDE.md CRITICAL.
- 기존 테스트를 깨뜨리지 마라.
