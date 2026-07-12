# Step 3: usage-wiring

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-016**(결정 3: `GeminiService`는 DB를 모른다 — 배선은 `cli/`가 한다)
- `/docs/ARCHITECTURE.md` — "서비스 레이어 격리", 데이터 흐름
- `src/services/gemini.ts` (step 1 산출물) — `onUsage` 옵션, `usageLabel` 파라미터
- `src/lib/cost.ts` (step 1 산출물) — `CallUsage`
- `src/lib/runStore.ts` (step 2 산출물) — `saveUsage`, `loadRunUsage`, `RunUsageSummary`
- `src/cli/index.ts` — **주 무대.** `GeminiService`가 생성되는 유일한 프로덕션 지점(`:93` 부근)과, 리포트를 stdout / 진행 로그를 stderr로 나눠 출력하는 기존 규칙
- `src/agents/*.ts` 7개 전부 — 각 에이전트가 `gemini.generateStructured`/`generateGrounded`를 부르는 자리
- `src/pipeline/orchestrator.ts` — step 실행 흐름과 `PipelineResult`

## 배경

**이 step이 계측의 결실이다.** 여기까지 오면 "비용이 어디서 나는지"를 처음으로 **눈으로 볼 수 있다.**

지금까지 step 1이 usage를 흘려보내는 구멍을 뚫었고, step 2가 받을 그릇을 만들었다. 이 step은 그 둘을 잇고, 사람이 읽을 수 있게 출력한다.

**아직 thinking budget을 넣지 마라(step 4).** 이 step이 끝난 직후에 **계측된 기준선(baseline)을 뜨는 것**이 이 phase의 설계다 — before를 모르면 after를 평가할 수 없다.

## 작업

### 1. 7개 에이전트에 `usageLabel` 부여

각 에이전트가 자기 이름을 넘긴다. label은 **파이프라인 step 이름과 맞춰라**(`PIPELINE_STEPS`) — 그래야 usage 집계와 step 상태를 나란히 볼 수 있다. step이 아닌 두 개는 자기 이름을 쓴다.

| 파일 | `usageLabel` |
|---|---|
| `src/agents/interviewer.ts` | `interviewer` |
| `src/agents/researchPlanner.ts` | `research-planner` (step이 아니다 — contextHunter 내부 호출) |
| `src/agents/contextHunter.ts` | `context-hunter` |
| `src/agents/thesis.ts` | `thesis` |
| `src/agents/coldCritic.ts` | `cold-critic` |
| `src/agents/solutionDesigner.ts` | `solution-designer` |
| `src/agents/verdict.ts` | `verdict` |

label 문자열을 각 호출부에 흩뿌리지 말고 **각 에이전트 파일의 상수**로 두고 export하라 — CLI 요약 출력이 순서를 잡을 때 쓸 수 있다.

step 1에서 `usageLabel`을 옵셔널로 두었다면 **여기서 필수로 바꿔라.** 이유: label 없는 usage 행은 "어느 에이전트가 비싼가"라는 질문에 답하지 못한다 — 계측의 목적 자체가 사라진다.

### 2. `src/cli/index.ts` — 배선

`GeminiService` 생성 시 `onUsage`를 넘긴다:

```ts
const gemini = new GeminiService({
  apiKey: geminiKey,
  onUsage: (usage) => store.saveUsage(runId, usage),
});
```

**주의 — `runId`의 타이밍.** `GeminiService`는 `runId`가 확정되기 전에 만들어질 수 있다(resume이면 인자로 오고, 새 run이면 `runPipeline` 안에서 `createRun`이 만든다). 두 가지 중 **덜 침습적인 쪽**을 골라라:

- (a) `RunStore`·`GeminiService` 생성 순서를 조정해 `runId`를 먼저 확정한 뒤 클로저에 담는다.
- (b) `let currentRunId`를 CLI 스코프에 두고 `onUsage` 클로저가 그것을 읽는다.

**`GeminiService`에 `runId`를 넘기지는 마라** — 서비스가 run의 존재를 알기 시작하면 계층이 무너진다(ADR-016 결정 3). runId를 아는 것은 `cli/`의 책임이다.

`store.saveUsage`가 throw해도 파이프라인이 죽지 않아야 한다(step 1에서 `onUsage`를 try/catch로 감쌌다면 이미 충족된다 — 확인하라).

### 3. CLI 비용 요약 출력

run이 끝나면(성공·실패 무관) `store.loadRunUsage(runId)`를 읽어 **stderr로** 요약을 출력한다. 리포트는 stdout이므로 **요약을 stdout에 섞지 마라** — 리다이렉트한 리포트가 오염된다(기존 CLI의 stdout/stderr 분리 규칙).

출력에 반드시 포함할 것:

- label별 표: 호출 수, 입력·출력·**thinking** 토큰, 비용(USD)
- 총계: 총 USD, 총 토큰
- **thinking 토큰 비중** (`thoughtsRatio`) — **이 숫자가 이 phase 전체의 근거다.** 눈에 띄게 출력하라.
- grounded 호출 수와 그 정액 요금
- 재시도 호출 수 (`retryCalls`) — 0이 아니면 낭비가 있다는 신호다
- **"추정치이며 실제 청구서가 아니다"**라는 한 줄. grounding 무료 한도(1,500건/일) 안이면 실제 grounding 청구는 0이라는 것도 함께 적어라.

숫자만 던지지 말고 **사람이 바로 판단할 수 있게** 배치하라 — 이 출력을 보고 사용자가 step 4의 budget을 조정한다.

에러로 끝난 run에서도 요약을 출력하라. 이유: **실패한 run도 과금됐다.** 오히려 그때 비용을 아는 것이 더 중요하다.

### 4. 테스트

- `src/cli/index.test.ts`: mock Gemini가 `usageMetadata`를 실어 보내면 usage가 DB에 저장되고, CLI가 stderr에 요약을 출력한다. **stdout에는 요약이 섞이지 않는다**(리포트만).
- `src/pipeline/e2e.test.ts`: 파이프라인 완주 후 `loadRunUsage`가 **에이전트 수만큼의 label**을 갖는다.
- **★ step이 실패해도 그 전까지의 usage가 남아 있다.** 이유: 실패한 run도 과금됐다.
- `saveUsage`가 throw하도록 mock해도 파이프라인이 완주한다.

## Acceptance Criteria

```bash
npm run build
npm test
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **★ 실제 API로 기준선(baseline)을 뜬다 — 이 phase에서 가장 중요한 산출물이다.**
   `GEMINI_API_KEY`가 있으면 **스크래치 DB**로 실제 run을 1회 돌려라. 사용자의 `data/anvil.db`를 오염시키지 마라:
   ```bash
   ANVIL_DB_PATH=/tmp/anvil-baseline.db npm run consult -- "직장인을 위한 AI 회의록 요약 서비스" 2>&1 >/dev/null | tail -30
   ```
   출력된 **비용 요약을 그대로 `summary`에 적어라** — 총 USD, thinking 비중, label별 비용, 재시도 수. 이것이 step 4·5의 before 값이다. **이 숫자 없이는 절감 효과를 증명할 수 없다.**
   `/tmp/anvil-baseline.db`는 **지우지 마라** — step 6의 최종 비교가 쓴다. 경로를 `summary`에 적어라.

   키가 없거나 외부 호출이 막혀 있으면 `"status": "blocked"`, `"blocked_reason": "기준선 run에 GEMINI_API_KEY 필요"`로 중단하라. **추정치를 실측인 것처럼 적지 마라.**
3. 아키텍처 체크리스트:
   - `GeminiService`가 여전히 DB·`runId`를 모르는가?
   - 비용 요약이 **stderr**로 나가는가? stdout의 리포트가 오염되지 않았는가?
   - CLAUDE.md CRITICAL: 테스트가 실제 API를 때리지 않는가? (위 기준선 run은 테스트가 아니라 **수동 검증**이다)
4. `phases/7-cost-control/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 **기준선 비용 실측치 전체**와 baseline DB 경로를 적어라.

## 금지사항

- **`thinkingConfig`를 추가하지 마라.** 이유: step 4의 scope다. **이 step의 목적은 thinking이 실제로 얼마나 쓰이는지를 처음으로 측정하는 것이다** — 측정 전에 손대면 before가 영영 사라진다.
- **`GeminiService`에 `runId`나 `RunStore`를 넘기지 마라.** 이유: ADR-016 결정 3. 배선은 `cli/`의 책임이다.
- **비용 요약을 stdout으로 출력하지 마라.** 이유: stdout은 리포트 마크다운 전용이다. `npm run consult -- "..." > report.md`가 깨진다.
- **성공한 run에서만 요약을 출력하지 마라.** 이유: 실패한 run도 과금됐다.
- **기준선 run을 사용자의 `data/anvil.db`에 저장하지 마라.** `ANVIL_DB_PATH`로 스크래치 DB에 격리하라. 이유: 검증용 run이 사용자의 실제 이력을 오염시키면 안 된다.
- 기존 테스트를 깨뜨리지 마라.
