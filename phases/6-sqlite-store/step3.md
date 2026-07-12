# Step 3: pipeline-cli-wiring

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-014**(SQLite 전환), **ADR-015**(재실행은 포크), **ADR-004**(하네스 패턴 런타임 — 이 step에서 유지해야 할 것), **ADR-007**(웹의 CLI detached spawn)
- `/docs/ARCHITECTURE.md` — 데이터 흐름, 상태 관리
- `/CLAUDE.md` — CRITICAL 규칙 (특히 "테스트에서 실제 외부 API를 호출하지 말 것")
- **`src/lib/db.ts`** — `openDb`, `getDefaultDbPath`
- **`src/lib/runStore.ts`** — 이전 step이 SQLite로 재작성했다. 새 시그니처를 정확히 확인하라(특히 `constructor(dbPath)`, `saveReport`가 void, `RunNotFoundError`).
- **`src/pipeline/orchestrator.ts`** — 이 step의 주 수정 대상
- **`src/pipeline/e2e.test.ts`** — 최외곽만 가짜인 E2E. 상단 주석의 철학을 반드시 읽어라.
- **`src/pipeline/orchestrator.test.ts`** — 스키마 identity로 분기하는 fake Gemini 패턴
- **`src/cli/index.ts`** — 진입점
- `package.json` — 스크립트

## 배경

이전 step이 `RunStore`를 SQLite로 바꾸면서 **빌드가 깨진 상태다**. orchestrator·cli가 구 시그니처(`new RunStore(runsDir)`, `saveReport()`가 경로를 반환)를 참조하고 있다. 이 step이 그것을 초록으로 되돌린다. (`web/`은 step 5에서 처리한다.)

**ADR-004(하네스 패턴)는 그대로다.** step이 순차 실행되고, 산출물이 persist되며, 실패 시 3회 자가 교정하고, completed step을 건너뛰는 resume이 성립한다 — 이 런타임 설계는 저장 매체와 무관하다. **orchestrator의 실행 로직을 재설계하지 마라.** 바뀌는 것은 저장소를 여는 방법과 리포트 반환값뿐이다.

## 작업

### 1. `src/cli/index.ts`

- `new RunStore(path.resolve(process.cwd(), "runs"))` → `new RunStore(getDefaultDbPath())`.
- 프로세스 종료 시 `store.close()`를 호출하라(정상 종료·에러 종료 양쪽).
- **stdout 계약**: 현재 성공 시 `console.log(result.reportPath)`로 파일 경로를 출력한다. 파일이 더 이상 없으므로 **`runId`를 출력한다**. 사람이 읽을 안내(웹에서 확인하라는 문구 등)는 **stderr로** 보내라 — stdout은 스크립트가 파싱할 수 있는 값 하나만 담는다(기존 계약의 정신).
- 실패 시의 재개 안내(`npm run consult -- --resume {runId}`)는 그대로 유지한다.
- `GEMINI_API_KEY` 체크, `buildResearchSources(process.env)`(키 없는 소스는 배열에서 제외) 로직은 **건드리지 마라**.

### 2. `src/pipeline/orchestrator.ts`

- `PipelineResult`에서 `reportPath`를 제거한다. `saveReport(runId, markdown)`는 이제 `void`다.
- 완료 로그(`[pipeline] 리포트 생성 완료: ${reportPath}`)를 runId 기반 문구로 바꾼다.
- **그 외의 실행 로직(executeStep, 인터뷰 pause/resume, research evidence 영속화, 3회 재시도)은 한 줄도 바꾸지 마라.**

`executeStep`의 resume 판정("`status === "completed"`이고 저장된 산출물이 스키마 검증을 통과하면 skip")은 저장 매체와 무관하게 성립한다. `loadStepOutput`이 파일 대신 `artifacts` 테이블을 읽을 뿐이다.

### 3. `package.json` 스크립트

step 1에서 `NODE_OPTIONS=--disable-warning=ExperimentalWarning`을 붙였는지 확인하고, 빠진 것이 있으면 채워라(`build`·`test`·`lint`·`consult`).

### 4. 테스트 갱신

**`src/pipeline/orchestrator.test.ts`**:
- `store = new RunStore(baseDir)` → tmp 디렉토리의 DB 파일. `afterEach`에서 `store.close()` + 디렉토리 삭제.
- **fake Gemini의 스키마 identity 분기 패턴을 유지하라** — 이 코드베이스의 시그니처 패턴이고 `failOn: VerdictSchema`로 특정 step만 실패시키는 능력이 여기서 나온다.
- **재실행 포크 동작을 여기서 못박아라** (이 step의 핵심 신규 테스트):
  - `createRerun`으로 만든 run을 `runPipeline`에 넣으면 **`interviewer`가 재실행되지 않고**(fake Gemini의 `InterviewQuestionsSchema` 호출이 0회), `context-hunter`부터 실제로 돈다(소스 `collect`가 호출된다).
  - 원본의 인터뷰 답변이 context-hunter 프롬프트에 clarifications로 주입된다.
  - 새 run이 완료돼도 **원본 run의 산출물과 `completedAt`이 그대로 남아 있다**.

**`src/pipeline/e2e.test.ts`**:
- `RunStore`와 DB는 **진짜를 쓴다**(tmp DB 파일). 가짜는 최외곽(`fetch`, GenAI SDK 클라이언트)에만 둔다. 파일 상단 주석의 철학을 어기지 마라 — "GeminiService를 mock하는 단위 테스트는 'LLM 원문 → 파싱 → zod 검증' 구간을 통째로 건너뛴다".
- 기존에 `runs/{id}/*.json` 파일 존재를 확인하던 단언이 있다면 DB 조회로 바꾼다.

### 5. 실 구동 검증 (에이전트가 직접)

`GEMINI_API_KEY`가 있으면 실제로 한 번 돌려서 확인하라. **없으면 이 항목은 건너뛰고 `blocked`로 만들지 마라** — AC의 자동 테스트로 충분하다.

```bash
npm run consult -- "테스트 아이디어"     # stdout에 runId만 나오는가
sqlite3 data/anvil.db "select run_id, status from steps where run_id = '<runId>';"
sqlite3 data/anvil.db "select kind, length(content) from artifacts where run_id = '<runId>';"
```

## Acceptance Criteria

```bash
npm run build   # ★ 이 step에서 다시 초록이 되어야 한다 (web은 아직 깨질 수 있다 — 아래 참고)
npm test        # 루트 vitest 전부 통과
npm run lint    # 통과
```

`npm run build`는 `tsc && npm run build -w web`이므로 **web이 아직 구 `RunStore` 시그니처를 참조해 실패할 수 있다.** 그 경우 루트만 확인하라:

```bash
npx tsc --noEmit        # ★ 반드시 통과
npx vitest run          # ★ 반드시 통과 (web 제외 — vitest.config.ts가 web/**를 exclude한다)
```

web은 step 5에서 초록으로 되돌린다. index.json `summary`에 그 상태를 명시하라.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff src/pipeline/orchestrator.ts`를 읽고, **저장소 관련 변경(생성자, saveReport 반환값, 로그 문구) 외에 실행 로직이 바뀌지 않았음**을 확인하라. executeStep의 상태 전이 순서(산출물 먼저 저장 → 그 다음 상태)가 그대로인지 특히 확인하라.
3. 아키텍처 체크리스트:
   - CLAUDE.md CRITICAL: 외부 API 호출이 `src/services/`에만 있는가? orchestrator가 직접 fetch하지 않는가?
   - CLAUDE.md CRITICAL: 테스트가 실제 외부 API를 때리지 않는가? (`GEMINI_API_KEY` 없이 `npm test`가 통과해야 한다 — **API 키를 지우고 한 번 더 돌려서 확인하라**)
   - ADR-004의 하네스 패턴(순차 step + persist + 3회 자가 교정 + resume)이 유지되는가?
4. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."` (다음 step이 쓸 정보: CLI stdout 계약, `PipelineResult` 변경, web이 아직 깨진 상태인지)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **orchestrator의 실행 로직을 재설계하지 마라.** `executeStep`의 상태 전이, 인터뷰 pause/resume 분기, research evidence 영속화 위치, 3회 재시도 — 전부 그대로다. 이유: ADR-004의 하네스 패턴은 저장 매체와 무관하다. 저장소 교체를 핑계로 런타임을 바꾸면 이 phase의 회귀를 추적할 수 없다.
- **`createRerun`을 orchestrator 안에서 부르지 마라.** 이유: 재실행은 `RunStore`가 run을 만들고(step 2), API가 트리거하고(step 7), orchestrator는 **자기가 받은 run을 그냥 실행할 뿐**이다. 포크 run이 특별한 취급 없이 그대로 돌아가는 것이 설계의 핵심이다.
- **`web/`을 수정하지 마라.** 이유: step 5의 scope다.
- **`src/services/`를 수정하지 마라.** 이유: 이 step과 무관하다. Gemini 타임아웃·재시도 횟수를 건드리면 `STALLED_THRESHOLD_MS(15분)`와의 암묵적 결합이 깨진다.
- **CLI의 stdout에 안내 문구를 섞지 마라.** 이유: stdout은 기계가 읽는 값(runId) 하나만 담는다. 사람이 읽는 것은 stderr다.
- 기존 테스트를 깨뜨리지 마라. 특히 e2e의 "가짜는 최외곽에만" 원칙.
