# Step 4: pipeline-wiring

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-017**, **ADR-004**(하네스 패턴 — 순차 step + persist + 자가 교정 재시도 + resume), ADR-011(스키마 변경 시 구 run 이송 경로), ADR-014
- `/docs/ARCHITECTURE.md` — 데이터 흐름, 하네스 패턴
- `/CLAUDE.md`
- `src/pipeline/orchestrator.ts` — 이번에 바꿀 파일. `executeStep`이 어떻게 persist·resume하는지, `solution-designer`·`verdict` 호출 지점에서 `criticism`이 이미 스코프에 있는지 확인하라.
- `src/lib/runStore.ts` — `parseArtifact`가 스키마 실패 시 `null`을 반환하고 throw하지 않는다는 것(`216~228행` 부근), `loadStepOutput`의 동작
- `src/types/solution.ts`·`src/types/verdict.ts` — `solutionSchemaFor`·`verdictSchemaFor`
- `src/agents/solutionDesigner.ts`·`src/agents/verdict.ts` — 이전 step들이 이미 팩토리를 배선했는지 확인
- `src/pipeline/orchestrator.test.ts`

## 배경

step 2·3이 에이전트 내부에서 팩토리를 배선했다. 이 step은 **orchestrator의 step 검증 경로**가 같은 팩토리를 쓰게 만든다. 그래야 **resume이 교차 산출물 정합성을 재검증**한다.

핵심 효과: 원장 없이 저장된 구 solution은 resume 시 `loadStepOutput` → `parseArtifact` → `null` → *"산출물이 없거나 손상됨 — 재실행한다"*로 자동 재생성된다. **새 코드 없이 도달하는 이송 경로**이며 ADR-011이 문서화한 방식 그대로다.

## 작업

`src/pipeline/orchestrator.ts` + 테스트.

`criticism`이 두 호출 지점에 이미 스코프에 있다:

```ts
const solution = await executeStep("solution-designer", solutionSchemaFor(criticism), () => …);
const verdict  = await executeStep("verdict",           verdictSchemaFor(criticism),  () => …);
```

`executeStep`이 스키마를 인자로 받지 않는 구조라면, **기존 시그니처를 최소로 바꿔** 스텝별 스키마를 받도록 하라. 다른 step들의 스키마 전달 방식과 일관되게 맞춰라 — 이 phase를 위해 특례를 만들지 마라.

### 테스트

- resume 시 원장 없는 저장된 solution이 `null`로 취급되어 재실행된다 ← 이 step의 핵심
- resume 시 원장 있는 solution은 그대로 통과해 재실행되지 않는다
- fatal 누락 solution은 step이 error로 기록된다
- 정상 원장을 가진 run이 완주한다

## 불변식

- **웹 읽기 경로(`web/`의 `RunDetail` 등)는 정적 `SolutionSchema`·`VerdictSchema`를 계속 쓴다.** 이것이 최신 run 5개를 보존하는 장치다. 이 step에서 웹을 팩토리로 바꾸지 마라.

  **관대한 읽기 / 엄격한 쓰기 — 두 단계 엄격도는 설계이지 실수가 아니다.** 호출 지점에 이 이유를 주석으로 남겨라. 남기지 않으면 누군가 "일관성"을 이유로 웹을 팩토리로 바꾸고, 그 순간 기존 run 5개가 조용히 빈 화면이 된다.

- `PIPELINE_STEPS`는 6개 그대로다. **새 step을 만들지 마라.**
- `STEP_ARTIFACT_KINDS`의 1:1 대응을 깨지 마라 (ADR-014).

## 주의 — 이 step까지의 구간

step 1에서 스키마가 엄격해졌고 step 2·3에서 프롬프트가 따라왔다. **step 1과 step 3 사이에는 스키마가 프롬프트보다 엄격한 구간이 존재한다.** 그 구간에서 **실제 파이프라인을 돌리지 마라** — 검증이 계속 실패한다. 테스트는 mock이라 영향 없다.

이 step이 끝나야 실행 경로 전체가 정합한다.

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - `pipeline/`이 fetch·SDK를 직접 부르지 않는가?
   - `PIPELINE_STEPS`가 6개 그대로인가?
   - 웹 읽기 경로가 정적 스키마를 쓰는가?
   - CLAUDE.md CRITICAL 위반이 없는가?
3. `phases/8-fatal-remedy/index.json`의 step 4를 업데이트한다.

## 금지사항

- **웹 읽기 경로를 팩토리로 바꾸지 마라.** 이유: 최신 run 5개가 조용히 빈 화면이 된다. 관대한 읽기 / 엄격한 쓰기는 설계다.
- **새 파이프라인 step을 만들지 마라.** 이유: 원장은 기존 두 step의 산출물이다. step을 늘리면 `PIPELINE_STEPS`·웹 진행 뷰·resume 로직에 파급된다 (ADR-012가 researchPlanner를 step으로 만들지 않은 것과 같은 논리).
- **orchestrator에 별도 validator를 만들지 마라.** 이유: 팩토리가 `generateStructured` 안에서 이미 검증하고 재시도를 태운다. 밖에서 또 검증하면 재시도 없이 실패하고 프롬프트를 재청구한다 (ADR-017 기각한 대안).
- **`parseArtifact`가 throw하게 바꾸지 마라.** 이유: `null` 반환이 ADR-011의 이송 경로다.
- **실제 파이프라인을 돌리지 마라** (이 step은 배선이다. 실행 검증은 step 7이다).
- **기존 테스트를 깨뜨리지 마라.**
