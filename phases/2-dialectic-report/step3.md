# Step 3: verdict-agent

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — 하네스 패턴 런타임, 데이터 흐름
- `/docs/ADR.md` — 특히 ADR-004(하네스 패턴), ADR-010(verdict step 분리)
- `/src/types/verdict.ts`, `/src/types/dialectic.ts`, `/src/types/run.ts` — step 1 산출물
- `/src/agents/thesis.ts` — 가장 단순한 에이전트. 이 파일의 구조를 그대로 따른다
- `/src/agents/solutionDesigner.ts` — 여러 입력을 주입하는 프롬프트 조립 패턴
- `/src/pipeline/orchestrator.ts` — `executeStep` 헬퍼와 resume 규칙
- `/src/pipeline/orchestrator.test.ts` — 오케스트레이터를 어떻게 mock하고 검증하는지
- `/src/lib/runStore.ts` — `STEP_OUTPUT_FILES` (step 1에서 `verdict: "verdict.json"`이 추가됐다)
- `/web/src/components/progress/ProgressView.tsx` — step 이름 → 한국어 라벨 매핑

## 배경

현재 리포트의 "최종 판정"은 `criticism.verdict`, 즉 **反 에이전트가 쓴 反의 결론**이다.
合(피벗 재설계)을 거치지 않은 판정이므로, 이걸 리포트 마지막에 두면 "피벗을 설계해놓고 피벗 이전의
사망선고를 최종 결론으로 내는" 논리 파탄이 생긴다.

ADR-010에 따라 `solution-designer` 다음에 6번째 step `verdict`를 추가한다. 이 에이전트만이
시장 맥락·正·反·合을 **모두** 보고 최종 생존 가능성을 판정한다.

`solution-designer`가 verdict도 겸하지 않는 이유: 피벗을 설계한 당사자가 자기 피벗을 채점하면
낙관 편향이 들어간다. 판정자는 분리한다.

## 작업

### 1. `src/agents/verdict.ts` (신설)

`src/agents/thesis.ts`의 구조를 그대로 따른다: 시스템 프롬프트 상수, 프롬프트 템플릿 상수,
Deps 인터페이스, `run*` 함수.

```ts
export const VERDICT_SYSTEM_PROMPT: string;
export const VERDICT_PROMPT_TEMPLATE: string;   // {idea} {marketContext} {thesis} {criticism} {solution}

export interface VerdictDeps {
  gemini: GeminiService;
}

export async function runVerdict(
  deps: VerdictDeps,
  idea: string,
  context: MarketContext,
  thesis: Thesis,
  criticism: Criticism,
  solution: Solution,
): Promise<Verdict>;
```

`deps.gemini.generateStructured({ systemInstruction, prompt, schema: VerdictSchema, useGrounding: false })`를
호출한다. **`useGrounding: true`로 하지 마라** — 이 단계는 새 사실을 찾는 게 아니라 앞 4단계를
종합하는 것이다.

`VERDICT_SYSTEM_PROMPT`에 담아야 할 것:

- 당신은 앞선 네 단계(시장 맥락 / 正 낙관 / 反 비판 / 合 피벗 재설계)를 모두 읽은 **최종 심사역**이다.
  낙관론자도 비판가도 아니다. 어느 한쪽 편을 들지 않는다.
- **판정 대상은 원본 아이디어가 아니라 合의 재설계안(`solution.revisedConcept`)이다.**
  反의 비판을 피벗이 실제로 방어·우회했는지 검증하고, 방어되지 않은 비판만 잔존 리스크로 남긴다.
  이 문장이 이 에이전트의 존재 이유다 — 반드시 프롬프트에 명시하라.
- `survivalScore`(0~100)와 `recommendation`은 아래 밴드를 지켜야 한다. 어기면 검증이 실패한다.
  프롬프트에 **숫자를 그대로 박아 넣어라**: `abandon` 0~39 / `pivot` 40~69 / `proceed` 70~100.
  숫자는 `RECOMMENDATION_SCORE_BANDS` 상수에서 읽어와 템플릿 리터럴로 주입하는 것이 좋다.
- `headline`은 **한 문장**의 결론이다(UI에서 큰 글씨로 노출된다).
- `rationale`은 종합 결론 단락이다. 왜 그 점수인지 4단계를 인용해 설명한다.
- `residualRisks`는 **피벗 이후에도 남는** 리스크다. `criticism.points`를 그대로 옮겨 적지 마라.
  合이 방어한 항목은 제외하고, 방어되지 않았거나 피벗이 새로 만들어낸 리스크만 남긴다.
  `keyword`는 2~10자 명사구, `severity`는 fatal/major/minor.
- `conditions`는 "이 조건이 충족되면 생존한다"는 검증 가능한 조건 목록이다. 각 항목은 실행 가능한
  형태여야 한다(예: "출시 6개월 내 리텐션 D30 20% 확보"). 희망 사항을 쓰지 마라.
- 성공 확률을 부풀리지 마라. `criticism.points`에 `fatal`이 남아 있고 合이 그것을 방어하지 못했다면
  `survivalScore`는 40 미만이어야 한다.

`VERDICT_PROMPT_TEMPLATE`은 `{idea}`, `{marketContext}`, `{thesis}`, `{criticism}`, `{solution}`
플레이스홀더를 갖고, `runVerdict`가 각각 `JSON.stringify(x, null, 2)`로 치환한다
(`solutionDesigner.ts`의 `.replace()` 체인 패턴을 따른다).

### 2. `src/pipeline/orchestrator.ts`

`solution-designer` 다음에 verdict step을 추가한다. 기존 `executeStep` 헬퍼를 그대로 쓴다:

```ts
const verdict = await executeStep("verdict", VerdictSchema, () =>
  runVerdict({ gemini: deps.gemini }, idea, context, thesis, criticism, solution),
);
```

그리고 `renderReport(...)` 호출에 `verdict`를 넘긴다. **`src/lib/report.ts`의 `renderReport` 시그니처를
바꿔야 한다.** 이 step에서는 `verdict` 인자를 받아 파일 끝에 최소한의 섹션 하나만 덧붙여라 —
5단계 서사로의 전면 재작성은 **step 4의 일**이다. 컴파일과 테스트만 통과시켜라.

하네스 패턴의 불변 규칙(반드시 지켜라):

- `executeStep`은 step 상태 전이마다 `deps.store.saveRun(state)`로 즉시 persist한다. 프로세스가 죽어도
  `state.json`이 남아야 resume이 성립한다.
- 이미 `completed`인 step은 산출물을 `loadStepOutput`으로 읽어 재사용하고 건너뛴다(resume).
  산출물이 없거나 스키마 검증에 실패하면 재실행한다. **이 동작을 바꾸지 마라** — 구버전 run이
  새 스키마로 자동 마이그레이션되는 경로다.
- `state.completedAt`은 verdict까지 끝나고 리포트를 저장한 뒤에만 설정된다.

`PipelineResult`의 `status` 유니온(`"completed" | "waiting"`)은 바꾸지 않는다.

### 3. `web/src/components/progress/ProgressView.tsx`

step 이름 → 한국어 라벨 매핑에 `verdict: "최종 판정"`을 추가한다. 이 매핑이 `Record<PipelineStepName, string>`
타입이라면 step을 추가한 순간 타입 에러가 나므로 반드시 채워야 한다.

**이 파일 외에 `web/` 아래 다른 파일은 건드리지 마라.** ProgressView는 `Criticism` 스키마를 참조하지
않으므로 이 수정만으로 컴파일이 깨지지 않는다. (web 전체 복구는 step 5의 일이다.)

## 테스트 (TDD — 먼저 작성한다)

### `src/agents/verdict.test.ts` (신설)

기존 `src/agents/thesis.test.ts` 패턴을 따른다. `GeminiService`를 mock하고 **실제 API를 호출하지 마라.**

- `runVerdict`가 `generateStructured`를 정확히 1회 호출하고, `schema`가 `VerdictSchema`와 동일 참조다.
- `useGrounding`이 `false`다.
- 넘긴 `prompt`에 context / thesis / criticism / solution 네 JSON이 모두 포함된다
  (각 객체의 고유 문자열이 prompt에 등장하는지로 확인).
- `VERDICT_SYSTEM_PROMPT`에 `RECOMMENDATION_SCORE_BANDS`의 경계 숫자(`39`, `40`, `69`, `70`)가 등장한다.
  상수에서 값을 읽어와 검증하라 — 프롬프트와 스키마가 어긋나면 실패해야 한다.
- mock이 반환한 `Verdict`를 그대로 돌려준다.

### `src/pipeline/orchestrator.test.ts` (갱신)

- 파이프라인이 `verdict` step을 `solution-designer` **다음에** 실행한다(호출 순서 단언).
- verdict 산출물이 `runs/{id}/verdict.json`으로 저장된다(`saveStepOutput`이 `"verdict"`로 호출됨).
- `verdict` step이 `completed`이고 `verdict.json`이 유효하면 resume 시 **재실행하지 않는다.**
- `verdict` step이 실패하면 `PipelineStepError`가 던져지고 `state.json`의 해당 step이
  `status: "error"`로 저장된다. `state.completedAt`은 설정되지 않는다.
- `verdict.json`이 손상됐을 때(스키마 검증 실패) `completed` 상태여도 재실행된다.

## Acceptance Criteria

```bash
npx tsc --noEmit
npx vitest run
grep -q "최종 판정" web/src/components/progress/ProgressView.tsx
```

`npm run build` / `npm test`는 이 step에서도 여전히 실패한다. 루트 스크립트가 `web` 워크스페이스까지
체이닝하는데 `web/src/lib/severity.ts`와 `web/src/components/report/CriticismSection.tsx`가 아직
삭제된 `criticism.painPointReality`를 참조하기 때문이다. **예상된 상태다 — web은 step 5에서 복구한다.**

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --name-only`로 `web/` 변경이 `ProgressView.tsx` 하나뿐인지 확인한다.
3. 아키텍처 체크리스트를 확인한다:
   - 외부 API 호출이 `src/services/`에만 있는가? (`agents/verdict.ts`는 `GeminiService`를 주입받는다)
   - 산출물이 zod 스키마 검증을 통과해야 다음 step으로 전달되는가?
   - `runs/{id}/state.json`이 여전히 단일 진실 공급원인가? resume 시 completed step을 건너뛰는가?
   - 테스트가 API 키 없이 통과하는가?
4. 결과에 따라 `phases/2-dialectic-report/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (`runVerdict` 시그니처와
     orchestrator에서의 호출 위치를 요약에 포함하라)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `criticism.verdict` 필드를 삭제하거나 verdict 에이전트의 산출물로 대체하지 마라.
  이유: 그건 反 섹션의 소결론으로 계속 렌더링된다. 역할이 다르다(ADR-010).
- verdict 에이전트에 `useGrounding: true`를 주지 마라. 이유: 이 단계는 새 사실을 검색하는 게 아니라
  앞 4단계를 종합한다. grounding을 켜면 `responseJsonSchema`를 못 쓰고 출력 안정성이 떨어진다.
- `executeStep`의 resume 로직(completed면 산출물 로드 후 skip, 로드 실패 시 재실행)을 수정하지 마라.
  이유: 구버전 run의 자동 마이그레이션 경로이자 하네스 패턴의 핵심 계약이다(ADR-004).
- `src/lib/report.ts`를 5단계 서사로 재작성하지 마라. 이유: step 4의 범위다. 여기서는 `verdict` 인자를
  받아 컴파일을 통과시키는 최소 변경만 한다.
- `web/` 아래에서 `ProgressView.tsx` 외의 파일을 수정하지 마라. 이유: step 5가 web을 일괄 복구한다.
- 테스트에서 실제 Gemini API를 호출하지 마라. 이유: CLAUDE.md CRITICAL 규칙 — API 키 없이
  테스트가 통과해야 한다.
- `PIPELINE_STEPS`의 순서를 바꾸지 마라. 배열 순서가 곧 실행 순서이며, `RunStore.createRun`이
  이 순서로 `state.json`의 steps를 seed한다.
- 기존 테스트를 깨뜨리지 마라.
