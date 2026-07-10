# Step 2: agent-prompts

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/PRD.md` — 5단계 서사와 "원시 데이터가 아닌 인사이트" 출력 원칙
- `/docs/ADR.md` — ADR-010, ADR-011
- `/src/types/dialectic.ts`, `/src/types/thesis.ts`, `/src/types/criticism.ts`, `/src/types/marketContext.ts`, `/src/types/verdict.ts` — step 1이 만든 새 스키마
- `/src/agents/contextHunter.ts`, `/src/agents/thesis.ts`, `/src/agents/coldCritic.ts`, `/src/agents/solutionDesigner.ts`
- `/src/agents/*.test.ts` — 기존 테스트가 프롬프트를 어떻게 검증하는지
- `/src/services/gemini.ts` — 구조화 출력과 재시도 루프

step 1이 만든 스키마를 먼저 정확히 읽어라. 프롬프트는 스키마의 출력 계약을 자연어로 설명하는 것이므로,
스키마와 프롬프트가 어긋나면 Gemini가 3회 재시도 후 실패한다.

## 배경

step 1에서 스키마가 바뀌었다. 이제 에이전트가 그 스키마를 채우도록 프롬프트를 재작성한다.
이 step은 **프롬프트 문자열과 그것을 조립하는 함수만** 다룬다. 새 에이전트(verdict)는 step 3의 일이다.

핵심 원칙 하나: **원시 데이터를 그대로 나열하지 말고, AI의 시각으로 분석해 정제된 인사이트로 변환한다.**

## 작업

### 1. `src/agents/contextHunter.ts`

`MarketContext`에 인사이트 필드 4개(`briefing`, `marketSizeIndicators`, `competitorInsight`,
`voicesInsight`)가 추가됐다. 프롬프트가 이를 생성하게 하라.

`CONTEXT_HUNTER_SYSTEM_PROMPT`에 담아야 할 것:

- 이 에이전트의 산출물은 리포트 1단계 **"시장 맥락"**이며, **건조하고 팩트 위주**로 작성한다.
  낙관도 비관도 이 단계의 일이 아니다(그건 다음 단계 正/反이 맡는다). 형용사를 줄이고 수치를 늘려라.
- `briefing`은 원시 데이터의 요약이 아니라 **애널리스트의 브리핑**이다. 3~5문장으로 이 시장이 지금
  어떤 상태인지 진술한다.
- `competitorInsight`는 경쟁사 목록의 나열이 아니라 **경쟁 구도에서 읽어낸 판단**이다
  (예: 어느 가격대가 비어 있는가, 어떤 축에서 차별화가 소진됐는가).
- `voicesInsight`는 댓글의 요약이 아니라 **유저가 실제로 말하지 않은 것까지 읽어낸 해석**이다.
- `marketSizeIndicators`는 정량 지표만 담는다. 검색으로 확인되지 않으면 **추측하지 말고 빈 배열**로 둔다.
- 기존 규칙 유지: `youtubeVoices[].comment`는 요약하지 말고 **원문 그대로** 인용한다.
  수집 결과에 실제로 존재하는 영상·댓글만 사용한다.

`CONTEXT_HUNTER_PROMPT_TEMPLATE`의 "출력 형식" JSON 예시를 새 필드 4개를 포함하도록 갱신하라.
이 에이전트는 `useGrounding: true`라 `responseJsonSchema`를 쓸 수 없고 프롬프트의 JSON 예시가
유일한 형식 지시다 — **필드를 하나라도 빠뜨리면 검증이 실패한다.**

`YOUTUBE_EMPTY_SECTION` 상수와 `formatYoutubeSection`, `runContextHunter`의 시그니처·YouTube 실패
fallback 동작은 그대로 둔다. YouTube 수집이 실패해 `youtubeVoices`가 빈 배열일 때
`voicesInsight`에 무엇을 쓸지 프롬프트에 명시하라(예: 수집된 목소리가 없다는 사실과 그 한계를 진술).

### 2. `src/agents/thesis.ts`

`ThesisSchema`에 `points: ThesisPoint[]`가 추가됐다. 프롬프트가 **세 축을 모두 덮는** 낙관 주장을
생성하게 하라.

`THESIS_SYSTEM_PROMPT`에 추가할 것:

- 당신의 낙관은 다음 단계의 냉정한 비판가와 **같은 세 축 위에서** 정면으로 맞선다. 각 축마다
  최소 1개의 `points` 항목을 작성하라:
  - `painPoint` — 이 페인포인트는 실재하고 충분히 크다
  - `bm` — 사용자는 이것에 기꺼이 돈을 낸다
  - `copycat` — 대기업이 쉽게 복제할 수 없는 해자가 있다
- `id`는 `"t1"`, `"t2"`, … 순번으로 부여하고 중복되면 안 된다.
- `claim`은 **한 문장**의 단정적 주장이다(Split View 좌측 카드의 제목이 된다).
- `rationale`은 `MarketContext`의 실제 데이터를 인용한 근거다.
- 기존 규칙 유지: 근거 없는 공상 금지. 리스크 나열은 당신의 역할이 아니다.
- 기존 서사 필드(`revenueModel`, `growthLevers`, `marketTailwinds`, `bestCaseScenario`,
  `winningThesis`)의 작성 지시도 유지한다. 단 사용자 지시상 正의 본질은
  **"최대 잠재력과 바이럴/수익화 시나리오"**이므로 `growthLevers`는 바이럴 루프를,
  `revenueModel`은 수익화 경로를 구체적으로 그려야 한다.

`THESIS_PROMPT_TEMPLATE`에도 세 축 커버리지 요구를 명시하라. `runThesis`의 시그니처는 바꾸지 않는다.

### 3. `src/agents/coldCritic.ts`

가장 크게 바뀌는 프롬프트다. 3개 배열이 사라지고 `points[]` 하나에 `axis`가 붙었으며,
`rebuts`·`riskScore`·`riskKeyword`가 새로 생겼다.

`COLD_CRITIC_SYSTEM_PROMPT`에 담아야 할 것:

- 기존 페르소나(20년 경력의 냉혹한 시장 분석가, 완충 표현 금지) 유지.
- **축 커버리지**: `points`는 `painPoint` / `bm` / `copycat` 세 축을 각각 최소 1개씩 덮어야 한다.
  `axis` 필드로 표시한다.
- **정면 반박**: 앞 단계 낙관론(`Thesis`)의 각 `points[]` 항목은 `id`를 갖는다. 당신의 비판이 특정
  낙관 주장을 정면으로 반박한다면 `rebuts`에 그 `id`를 적어라. 같은 축의 낙관 주장을 **최소 하나는**
  반드시 반박하라. 반박 대상이 없는 독립 비판은 `rebuts`를 생략한다.
- **정량화**: `riskScore`는 0~100 정수이며 `severity`와 밴드가 일치해야 한다.
  `SEVERITY_SCORE_BANDS`를 프롬프트에 **명시적 숫자로** 박아 넣어라
  (minor 0~33 / major 34~66 / fatal 67~100). 밴드를 벗어나면 검증이 실패하고 재시도된다.
- **키워드 분리**: `riskKeyword`는 뱃지와 레이더 축 라벨에 쓰이는 **2~10자 명사구**다
  (예: "무료 대안 잠식", "API 한 줄 복제"). 문장을 쓰지 마라.
- `severity` 판정 기준(fatal/major/minor 정의)은 기존 문구를 유지한다.
- `verdict` 필드는 **反 섹션의 소결론**이다. 리포트의 최종 판정이 아니다(그건 별도 verdict 에이전트가
  合까지 본 뒤 내린다 — ADR-010). 프롬프트에 이 사실을 적어 에이전트가 "최종 결론"을 참칭하지 않게 하라.
- 근거 인용 강제(evidence는 MarketContext의 실제 데이터 인용) 유지.

`COLD_CRITIC_PROMPT_TEMPLATE`은 `{thesis}` JSON을 그대로 주입하므로 낙관 주장의 `id`가 프롬프트에
노출된다. `rebuts`에 그 `id`를 쓰라고 지시하라. `runColdCritic`의 시그니처는 바꾸지 않는다.

### 4. `src/agents/solutionDesigner.ts`

`SolutionSchema`는 step 1에서 바뀌지 않았다. 하지만 `Criticism`의 형태가 바뀌었으므로 프롬프트가
참조하는 방식이 달라지고, 5단계 서사에서 **合의 역할이 "가장 중요한 섹션"으로 격상**됐다.

`SOLUTION_DESIGNER_SYSTEM_PROMPT` 개정 방향:

- 合의 본질을 **피벗(Pivot) 전략**으로 재정의하라. 단순 절충이 아니라, 反의 비판을 **방어하거나 우회해서
  새로운 비즈니스 가치를 창출하는** 재설계다. `synthesis` 필드가 그 통찰을 담는다.
- `synthesis`를 optional에서 사실상 필수로 취급하도록 프롬프트에서 강하게 요구하라
  (스키마는 구 데이터 하위호환 때문에 optional로 유지된다 — 스키마를 바꾸지 마라).
- **비판 수용 강제**: `criticism.points` 중 `severity`가 `fatal`·`major`인 항목 **각각**에 대해
  재설계안이 어떻게 대응하는지 `revisedConcept`에 드러나야 한다. 대응할 수 없는 `fatal`이 있다면
  그 한계를 명시하라. 비판을 무시한 낙관적 재설계는 금지한다.
- 4대 설계 원칙(Minimal Input / Agentic Workflow / Data Flywheel / Monetization)과
  근거 제약(MarketContext·Criticism만 근거로 삼는다)은 유지한다.
- 프롬프트 안에서 `criticism.painPointReality` 같은 옛 필드명을 언급하지 마라 — 이제 `criticism.points`다.

`runSolutionDesigner`의 시그니처는 바꾸지 않는다.

## 테스트 (TDD — 먼저 작성한다)

기존 `src/agents/*.test.ts` 패턴을 그대로 따른다: `GeminiService`를 mock하고, 전달된
`systemInstruction`·`prompt`·`schema`를 단언한다. **실제 API를 호출하지 마라.**

프롬프트 문자열 전체를 문자열 비교로 단언하지 마라(브리틀하다). 대신 **계약**을 검증하라:

- `runThesis`가 넘긴 `prompt`에 `MarketContext`의 JSON이 포함된다.
- `runColdCritic`이 넘긴 `prompt`에 `Thesis`의 JSON이 포함되고, 그 안에 `points[].id`가 보인다.
- `COLD_CRITIC_SYSTEM_PROMPT`에 세 축 이름(`painPoint`/`bm`/`copycat`)이 모두 등장한다.
- `COLD_CRITIC_SYSTEM_PROMPT`에 밴드 경계 숫자(`33`, `34`, `66`, `67`)가 등장한다 —
  스키마 상수와 프롬프트가 어긋나면 실패하도록.
- `CONTEXT_HUNTER_PROMPT_TEMPLATE`의 JSON 예시에 새 필드 4개가 모두 등장한다.
- 각 `run*` 함수가 `generateStructured`에 넘기는 `schema`가 해당 zod 스키마와 동일 참조다.
- `runContextHunter`만 `useGrounding: true`이고 나머지는 `false`다.

밴드 숫자 검증은 `SEVERITY_SCORE_BANDS` 상수에서 값을 읽어와 프롬프트에 그 숫자가 들어 있는지
확인하는 방식이 좋다. 하드코딩한 숫자 두 벌이 서로 어긋나는 것을 막는다.

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run
```

`npm run build` / `npm test`는 여전히 web 때문에 실패한다(step 5에서 복구). 이 step의 검증 범위는
루트 스코프다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 외부 API 호출이 `src/services/`에만 있는가? (agents/는 `GeminiService`를 주입받아 쓴다)
   - 테스트가 실제 Gemini/YouTube를 호출하지 않는가? API 키 없이 `npx vitest run`이 통과하는가?
   - 프롬프트에 적힌 밴드 숫자가 `SEVERITY_SCORE_BANDS` 상수와 일치하는가?
   - 모든 에이전트 산출물이 zod 스키마 검증을 거치는가? (`generateStructured`의 `schema` 인자)
3. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/types/` 아래 스키마를 수정하지 마라. 이유: step 1이 확정했다. 프롬프트가 스키마에 맞춰야지
  그 반대가 아니다. 스키마가 틀렸다고 판단되면 고치지 말고 `error`로 보고하라.
- `SolutionSchema.synthesis`를 required로 바꾸지 마라. 이유: 구 `solution.json` 하위호환을 위해
  optional이다. 필수화는 프롬프트로 달성한다.
- `web/` 아래 어떤 파일도 수정하지 마라. 이유: step 5의 범위다.
- `src/agents/verdict.ts`를 만들지 마라. 이유: step 3의 범위다.
- `runContextHunter`의 YouTube 실패 fallback(try/catch 후 웹검색만으로 진행)을 제거하지 마라.
  이유: quota 초과가 파이프라인 전체를 죽이면 안 된다.
- `useGrounding` 플래그를 바꾸지 마라. 이유: grounding과 `responseSchema`는 동시 사용이 불가능하다
  (`gemini.ts`의 주석 참고). context-hunter만 grounding을 쓴다.
- 프롬프트 전문을 문자열 동등 비교로 단언하는 테스트를 쓰지 마라. 이유: 브리틀하다. 계약(포함 관계,
  스키마 참조, 플래그)을 검증하라.
- 기존 테스트를 깨뜨리지 마라.
