# Step 7: research-planner

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ADR.md` — **ADR-012**(planner는 pipeline step이 아니다), ADR-004(하네스 패턴)
- `/docs/ARCHITECTURE.md` — 데이터 흐름의 context-hunter 블록
- `/src/types/research.ts` — step 1. **`SearchQueriesSchema`** (각 필드의 언어 요구사항 JSDoc을 읽어라)
- `/src/agents/thesis.ts` — **가장 단순한 에이전트. 이 구조를 그대로 따른다** (시스템 프롬프트 상수 + 템플릿 상수 + Deps + `run*`)
- `/src/agents/interviewer.ts` — non-grounding 구조화 출력의 또 다른 예
- `/src/agents/contextHunter.ts` — step 6 산출물. `collectAll(deps.sources, queries)` 호출부
- `/src/agents/contextHunter.test.ts`
- `/src/services/gemini.ts` — step 5. `generateStructured`(non-grounding) vs `generateGrounded`
- `/src/research/collect.ts` — `collectAll(sources, queries)`
- `/src/pipeline/orchestrator.ts` — `PIPELINE_STEPS`에 **planner를 추가하지 않는다**는 점을 확인하라
- `/src/pipeline/e2e.test.ts` — GenAI mock 응답 개수가 늘어난다

## 배경

**지금 검색 쿼리는 아이디어 원문 그대로다.**

`contextHunter`는 "직장인을 위한 AI 기반 회의록 요약 서비스인데 슬랙과 연동해서 회의 끝나면 자동으로…"
같은 **긴 문장 전체를** 모든 소스의 검색어로 넘긴다. 검색 품질의 하한을 여기서 만들고 있다.

**버그도 있다**: 인터뷰 답변(`clarifications`)은 프롬프트 끝에만 붙고 **검색어에는 전혀 반영되지 않는다.**
사용자가 "타겟은 스타트업 PM이고 슬랙이 핵심"이라고 답해도 검색은 원본 아이디어로만 한다.

**★ 그리고 Hacker News는 영어권이다.** 한국어 쿼리를 넣으면 에러도 없이 **조용히 0건**이 나온다.
빈 배열이라 눈치채기 어렵다. planner의 존재 이유가 바로 이것이다.

### 왜 pipeline step이 아닌가 (ADR-012)

새 step으로 빼면 `types/run.ts`(`PIPELINE_STEPS`) + `runStore.ts`(exhaustive `STEP_OUTPUT_FILES`) +
orchestrator + `web/.../ProgressView.tsx`(`STEP_LABELS`) + `web/src/lib/server/runs.ts`(`RunDetail`) +
**web fixture의 `state.json` 5개**를 전부 건드려야 한다.

그렇게 얻는 resume 이득은 **거의 0**이다 — planner는 non-grounding 구조화 호출이라 2~4초에 토큰도 적다.
**비싼 건 grounding 호출(50~90초)이고 그건 이미 context-hunter가 체크포인트한다.**

게다가 `PIPELINE_STEPS`는 웹 진행 뷰에 "변증법 단계"로 노출되는 **사용자 언어**다.
`research-planner` 같은 구현 디테일이 끼면 안 된다.

## 작업

### 1. `src/agents/researchPlanner.ts` (신설)

`src/agents/thesis.ts`의 구조를 그대로 따른다.

```ts
export const RESEARCH_PLANNER_SYSTEM_PROMPT: string;
export const RESEARCH_PLANNER_PROMPT_TEMPLATE: string;   // {idea} {clarifications}

export interface ResearchPlannerDeps {
  gemini: GeminiService;
  log?: (message: string) => void;
}

export async function planResearchQueries(
  deps: ResearchPlannerDeps,
  idea: string,
  clarifications?: string,
): Promise<SearchQueries>;
```

`deps.gemini.generateStructured({ systemInstruction, prompt, schema: SearchQueriesSchema })`를 호출한다.

**★ `generateGrounded`를 쓰지 마라.** 이건 검색어를 **짓는** 단계지 검색하는 단계가 아니다.
non-grounding이면 `responseJsonSchema`를 쓸 수 있어(`gemini.ts:85-89`) 형식 실패가 구조적으로 없다.
빠르고 싸다.

#### `RESEARCH_PLANNER_SYSTEM_PROMPT`에 담아야 할 것

- 당신은 아이디어를 읽고 **소스별 검색어를 설계하는 리서치 플래너**다. 검색을 수행하지 않는다.
- 아이디어 원문을 그대로 검색어로 쓰지 마라. **검색 엔진이 실제로 매칭할 수 있는 키워드구**를 만들어라.
  긴 문장은 검색 결과를 0건으로 만든다.
- 찾으려는 것은 **아이디어를 홍보하는 글이 아니라 그 문제로 고통받는 사람들의 목소리**다.
  제품명이 아니라 **페인포인트의 언어**로 검색하라.
- 소스별 요구사항:
  - **`youtube`** — 한국어. 리뷰·후기·불만·브이로그가 잡히는 구어체 키워드.
  - **`hackernews`** — **★ 반드시 영어다.** 한국어를 쓰면 검색 결과가 0건이 된다.
    제품·기술 키워드로 영어권 빌더·얼리어답터 토론을 겨냥하라.
  - **`naver`** — 한국어. 카페·지식iN에서 실제 사용자가 쓸 법한 **구어체**로.
    ("회의록 자동화 솔루션"이 아니라 "회의록 정리 너무 귀찮" 쪽에 가깝게.)
  - **`web`** — grounding 모델에 줄 검색 힌트 1~3개. 시장 규모·경쟁사·트렌드를 겨냥한다.
- **인터뷰 답변(`clarifications`)이 주어지면 반드시 검색어에 반영하라.** 사용자가 명시한 타겟·플랫폼·
  제약 조건이 검색어에 들어가야 한다.

`RESEARCH_PLANNER_PROMPT_TEMPLATE`은 `{idea}`와 `{clarifications}` placeholder를 갖는다.
`clarifications`가 없으면 "(추가 설명 없음)"으로 치환하라 — placeholder가 프롬프트에 그대로 남으면 안 된다.

#### ★ fail-soft: planner가 실패해도 파이프라인을 멈추지 않는다

```ts
try { /* gemini 호출 */ }
catch (error) {
  // 검색어 생성 실패는 자료조사를 멈출 이유가 아니다 — 아이디어 원문으로 폴백한다
  deps.log?.(`[research-planner] 검색어 생성 실패 — 아이디어 원문으로 폴백한다: ${message}`);
  return { youtube: idea, hackernews: idea, naver: idea, web: [idea] };
}
```

⚠️ 이 폴백이 발동하면 **HN은 한국어 쿼리를 받아 조용히 0건**이 된다. 그래서 로그가 중요하다.

### 2. `src/agents/contextHunter.ts`

step 6이 만든 "모든 소스에 아이디어 원문" 임시 코드를 planner 호출로 교체한다:

```ts
const queries = await planResearchQueries({ gemini: deps.gemini, log: deps.log }, idea, clarifications);
const evidence = await collectAll(deps.sources, queries);
```

**★ 생성된 쿼리를 반드시 로그로 남겨라:**
```ts
deps.log?.(`[context-hunter] 검색어 — youtube: "${queries.youtube}" / hackernews: "${queries.hackernews}" / naver: "${queries.naver}"`);
```
이유: HN이 영어 쿼리를 못 받으면 **에러 없이 0건**이 된다. 로그가 유일한 관측 수단이다.

`queries.web`은 grounding 프롬프트에 검색 힌트로 넣어라 (예: "아래 관점으로 웹검색하라: ...").

**`clarifications`를 planner에 반드시 넘겨라 — 이게 이 step이 고치는 버그다.**

### 3. `src/pipeline/e2e.test.ts`

GenAI `generateContent` mock 응답이 **1개 늘어난다** (planner + context + thesis + critic + solution + verdict).
`expect(generateContent).toHaveBeenCalledTimes(ALL_STEPS.length)` 같은 단언이 있다면
`ALL_STEPS.length + 1`로 바꾸고, **"planner는 pipeline step이 아니라 context-hunter 내부 호출"임을
주석으로 남겨라.** 다음 사람이 step 개수 불일치로 혼란스러워하지 않게.

planner 응답 mock은 `SearchQueriesSchema`를 만족하는 JSON이어야 한다 (non-grounding이므로 순수 JSON).

## 테스트 (TDD — 먼저 작성한다)

### `src/agents/researchPlanner.test.ts` (신설)

`src/agents/thesis.test.ts`의 mock 패턴을 따른다. **실제 Gemini API를 호출하지 마라.**

- `generateStructured`를 정확히 1회 호출하고 `schema`가 `SearchQueriesSchema`와 **동일 참조**다
- **`generateGrounded`를 호출하지 않는다** (검색어를 짓는 단계지 검색하는 단계가 아니다)
- 프롬프트에 `idea`가 포함된다
- **★ 프롬프트에 `clarifications`가 포함된다** — 이게 현재 버그의 회귀 가드다
- `clarifications`가 `undefined`면 placeholder가 프롬프트에 그대로 남지 않는다 (`{clarifications}` 잔여 0)
- **★ 시스템 프롬프트가 `hackernews` 쿼리를 영어로 만들라고 지시한다** (문자열에 "영어" 포함)
- gemini가 reject하면 **throw하지 않고** `{youtube: idea, hackernews: idea, naver: idea, web: [idea]}`를 반환하고
  `log`를 호출한다

### `src/agents/contextHunter.test.ts` (갱신)

- **★ 각 소스가 planner가 만든 자기 쿼리로 호출된다** (아이디어 원문이 아니다).
  planner mock이 `{youtube: "YT쿼리", hackernews: "HN query", naver: "네이버쿼리", web: ["웹"]}`를 주면
  `sources[i].collect`가 각각 그 값을 받는다. **이게 이 step의 핵심 행위 변경이다.**
- **★ `clarifications`가 planner에 전달된다**
- 생성된 쿼리가 `deps.log`로 로그된다
- planner가 실패해도 contextHunter가 완주한다 (폴백 쿼리로 수집)
- `queries.web`이 grounding 프롬프트에 반영된다
- step 1의 프롬프트-스키마 계약 테스트는 그대로 통과한다

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
grep -q "researchPlanner\|planResearchQueries" src/agents/contextHunter.ts
grep -rq "research-planner" src/types/run.ts && echo "FAIL: planner를 PIPELINE_STEPS에 넣으면 안 된다" && exit 1
grep -q "영어" src/agents/researchPlanner.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **`PIPELINE_STEPS`가 여전히 6개인지** 확인한다 (`interviewer`, `context-hunter`, `thesis`, `cold-critic`,
   `solution-designer`, `verdict`). planner가 들어갔으면 실패다.
3. `web/src/components/progress/ProgressView.tsx`의 `STEP_LABELS`가 **안 바뀌었는지** 확인한다
   (`git diff web/` 가 비어 있어야 한다). 이게 planner를 step으로 안 만든 배당금이다.
4. 아키텍처 체크리스트:
   - 외부 API 호출이 `src/services/`에만 있는가?
   - planner 산출물이 zod(`SearchQueriesSchema`) 검증을 통과하는가? 실패 시 재시도(최대 3회)하는가?
   - 테스트가 API 키 없이 통과하는가?
5. 결과에 따라 `phases/3-multi-source-research/index.json`의 step 7을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
     (요약에 `planResearchQueries` 시그니처, 폴백 동작, **로그 형식**, e2e의 GenAI mock 응답 개수 변화를 포함하라.)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "..."`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "..."` 후 즉시 중단

## 금지사항

- **`researchPlanner`를 `PIPELINE_STEPS`에 추가하지 마라.** 이유: resume 이득이 거의 0인데
  (non-grounding 호출, 2~4초) `types/run.ts` + `runStore.ts`(exhaustive Record) + orchestrator +
  web `STEP_LABELS` + `RunDetail` + web fixture `state.json` 5개까지 파급된다. 게다가 `PIPELINE_STEPS`는
  사용자에게 "변증법 단계"로 노출되는 언어라 구현 디테일로 오염시키면 안 된다 (ADR-012).
- **planner에 `generateGrounded`를 쓰지 마라.** 이유: 검색어를 **짓는** 단계지 검색하는 단계가 아니다.
  non-grounding이면 `responseJsonSchema`를 써서 형식 실패가 구조적으로 없다. grounding은 그걸 못 쓴다.
- **planner 실패 시 throw하지 마라.** 이유: 검색어 생성 실패는 자료조사를 멈출 이유가 아니다.
  아이디어 원문으로 폴백하고 warn 로그를 남긴다. 파이프라인 fail-soft 계약(ADR-012).
- **생성된 쿼리를 `MarketContext` 스키마에 넣지 마라.** 이유: 하류 4개 에이전트가 `MarketContext` 전체를
  주입받는다. 쿼리는 하류가 안 쓰는데 토큰만 는다. **로그로 노출하라.**
- **생성된 쿼리 로그를 빼먹지 마라.** 이유: HN이 한국어 쿼리를 받으면 **에러 없이 조용히 0건**이 된다.
  빈 배열이라 눈치채기 어렵고, 로그가 유일한 관측 수단이다.
- **`clarifications`를 planner에 안 넘기면 이 step은 실패다.** 이유: 그 버그를 고치는 게 이 step의 목적 중 하나다.
- 테스트에서 실제 Gemini API를 호출하지 마라.
- 기존 테스트를 깨뜨리지 마라.
