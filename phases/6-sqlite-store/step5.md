# Step 5: web-data-layer

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-014**(SQLite 전환), **ADR-006**(스키마는 `src/types` 단일 소스, web에서 중복 정의 금지), **ADR-007**(웹은 외부 API를 직접 호출하지 않고 CLI를 detached spawn한다)
- `/docs/ARCHITECTURE.md` — "웹 UI 데이터 흐름" 절 (요청마다 커넥션을 열고 닫는 규칙이 여기 있다)
- `/CLAUDE.md` — CRITICAL 규칙
- **`/web/AGENTS.md`** — "This is NOT the Next.js you know." Next.js 16이다. **필요하면 `node_modules/next/dist/docs/`의 가이드를 읽어라.**
- **`src/lib/runStore.ts`** — SQLite 저장소. `loadRunRecord`, `loadReport`, `close()` 시그니처를 정확히 확인하라.
- **`src/lib/db.ts`** — `getDefaultDbPath`
- **`web/src/lib/server/runs.ts`** — 이 step의 주 수정 대상
- **`web/src/app/api/runs/[id]/report/route.ts`** — 파일을 읽고 있다. DB로 바꾼다.
- `web/src/app/api/runs/route.ts`, `web/src/app/api/runs/[id]/route.ts`, `.../resume/route.ts`, `.../answers/route.ts`
- **`web/src/test/fixtures.ts`** + `web/src/test/fixtures/` — `makeTempRunsDir()`, `ageStateFile()`. 이 step에서 DB 기반으로 교체한다.
- `web/src/test/server/runs.test.ts`, `web/src/test/server/api-routes.test.ts`
- `web/next.config.ts` — `externalDir`로 루트 `src/`를 직접 컴파일한다. webpack 강제인 이유가 주석에 있다.

## 배경

루트의 `RunStore`가 SQLite로 바뀌었다(step 2·3). web은 아직 파일시스템을 전제하고 있어 **빌드가 깨진 상태다.** 이 step이 초록으로 되돌린다.

web은 `@anvil/runStore` alias로 루트 `RunStore`를 그대로 import한다(ADR-006: 스키마·타입은 `src/types` 단일 소스). 그 구조를 유지한다 — web에 별도의 DB 접근 계층을 만들지 마라.

## 작업

### 1. `web/src/lib/server/runs.ts`

- `getRunsDir()` → **`getDbPath()`**: `process.env.ANVIL_DB_PATH ?? path.resolve(process.cwd(), "..", "data", "anvil.db")`.
  - 루트 `getDefaultDbPath()`를 재사용할 수 있으면 그렇게 하라. 단 web의 `process.cwd()`는 `web/`이므로 상대 경로 기준이 다르다는 점에 주의하라(현재 `getRunsDir`가 `"..", "runs"`인 이유가 그것이다).
- `getRepoRoot()`는 **그대로 유지**한다 — `spawnConsult`가 CLI를 띄울 cwd로 여전히 필요하다.
- **커넥션 수명 — `withRunStore` 헬퍼를 만들어라**:

  ```ts
  export function withRunStore<T>(fn: (store: RunStore) => T): T;   // finally에서 store.close()
  ```

  요청마다 열고 닫는다. 이유: Next dev 서버의 HMR이 모듈 싱글턴을 재활용하면 죽은 DB 핸들이 남는다. 로컬 도구라 커넥션 오픈 비용은 무시할 수 있다. **모듈 최상위에 `const store = new RunStore(...)` 같은 싱글턴을 두지 마라.**

  기존 `getRunStore()`를 남길지 `withRunStore`로 통일할지는 재량이되, **커넥션을 닫지 않는 경로가 하나도 없어야 한다.**

- `getRunDetail(runId)`:
  - `fs.statSync(state.json).mtimeMs` + `store.loadRun` → **`store.loadRunRecord(runId)`** (없으면 `null` 반환 → 404).
  - `deriveRunStatus(state, updatedAtMs)`.
  - `hasReport`: `fs.existsSync(report.md)` → **`store.loadReport(runId) !== null`** (또는 존재 여부만 보는 값싼 조회를 `RunStore`에 추가해도 좋다).
  - 나머지 아티팩트 로딩(zod 검증 실패 시 `null` → 필드 생략)은 **그대로**다. ADR-011 페일소프트를 유지하라.
  - `RunDetail`에 **`rerunOf?: string`**을 추가한다(step 7의 UI가 쓴다. 지금 넣어두면 step 7이 데이터 계층을 다시 건드리지 않는다).
- `searchRuns(q, status)`:
  - **아이디어 키워드 검색을 SQL로 내려라** — `RunStore.listRuns`에 옵션 인자를 추가하거나(`listRuns(opts?: { q?: string; nowMs?: number })`) 전용 메서드를 두어, `WHERE idea LIKE '%' || ? || '%'`로 필터한다. 대소문자를 무시해야 한다(SQLite의 `LIKE`는 ASCII에 대해 기본적으로 대소문자를 무시한다. 한글은 무관하다). **이것이 DB 도입의 실익이다.**
  - **상태 필터는 SQL로 내리지 마라.** `deriveRunStatus`의 결과로 메모리에서 거른다. 이유: 상태는 `updated_at`과 현재 시각의 비교로 파생되는 값이고, 판정 규칙을 SQL에 복제하면 `deriveRunStatus`와 반드시 갈라진다. 상태의 권위는 `deriveRunStatus` 단독이다.

### 2. `web/src/app/api/runs/[id]/report/route.ts`

- `fs.readFileSync(runs/{id}/report.md)` → `store.loadReport(id)`. `null`이면 404.
- 경로 트래버설 방어(`path.basename(id) !== id` 체크)는 DB 키 조회가 되면서 **불필요해진다** — 제거해도 좋다. 다만 제거한다면 그 이유를 주석 한 줄로 남겨라(왜 있던 방어가 사라졌는지 다음 사람이 알아야 한다).
- **한글 runId 때문에 `content-disposition` 헤더에 runId를 넣지 않는 기존 처리는 유지하라** (ByteString 제약). `filename="report.md"` 그대로다.
- `content-type: text/markdown; charset=utf-8`도 그대로다.

### 3. 나머지 API route

`POST /api/runs`, `GET /api/runs/[id]`, `POST .../resume`, `POST .../answers` — **로직은 바꾸지 마라.** `getRunStore()` 호출을 `withRunStore`로 감싸는 것 외에는 그대로다.

특히 `POST /api/runs`의 **"createRun으로 runId를 먼저 확보한 뒤 spawn한다"** 순서(ADR-007)를 유지하라. 기존 테스트가 "spawn 시점에 run이 이미 저장돼 있는가"를 검증한다 — DB에서도 같은 단언이 성립해야 한다.

### 4. 테스트 픽스처 교체

**`web/src/test/fixtures.ts`**:
- `makeTempRunsDir()` → **`makeTempDb()`**: tmp 디렉토리에 DB를 만들고 `process.env.ANVIL_DB_PATH`를 주입한다. 정리(cleanup) 함수도 함께 반환한다.
- **기존 픽스처 JSON(`web/src/test/fixtures/{run-id}/*.json`)을 재작성하지 마라.** 그 파일들을 **읽어서 `RunStore` API로 seed**하라 — 픽스처 데이터(완료 run, context만 있는 run, waiting run 등)는 그대로 살리고 저장 매체만 바꾼다. 파일→`ArtifactKind` 매핑은 step 4의 `scripts/migrateRuns.ts`와 같다(로직을 재사용할 수 있으면 그렇게 하라).
- `ageStateFile()`(`fs.utimesSync`로 mtime을 과거로) → **`touchUpdatedAt(runId, isoString)`**: `runs.updated_at`을 직접 과거로 돌린다. `stalled` 판정 테스트가 이것에 의존한다.

**`web/src/test/server/runs.test.ts`**, **`api-routes.test.ts`**: `ANVIL_RUNS_DIR` → `ANVIL_DB_PATH`. `vi.mock("@/lib/server/spawnConsult")`로 **실제 spawn을 막는 것은 그대로 유지**하라.

**`web/src/test/schema-share.test.tsx`**(구 fixture 하위호환 parse)는 zod 스키마 테스트이므로 저장 매체와 무관하다. 건드릴 필요가 없다면 두어라.

### 5. Next.js 빌드 확인

`node:sqlite`는 **내장 모듈**이라 webpack이 자동으로 externalize한다(네이티브 `.node` 바이너리가 없는 것이 `better-sqlite3` 대비 장점이다). 그래도 반드시 확인하라:

```bash
npm run build -w web    # ★ 통과해야 한다
```

번들 에러가 나면 `web/next.config.ts`의 `serverExternalPackages`를 검토하되, **먼저 `node:` 프리픽스로 import되고 있는지 확인하라**(`import { DatabaseSync } from "node:sqlite"` — 프리픽스 없이 `"sqlite"`로 쓰면 npm 패키지를 찾는다).

## Acceptance Criteria

```bash
npm run build   # ★ 루트 + web 전부 통과 — 이 step에서 빌드가 완전히 초록이 된다
npm test        # ★ 루트 vitest + web vitest 전부 통과
npm run lint    # 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. **이 step 이후로는 빌드·테스트가 항상 초록이어야 한다.**
2. 실제 구동 확인:
   ```bash
   npm run web
   ```
   홈에서 이력 목록(step 4가 이송한 run들)이 보이는가? run 하나를 열어 리포트가 렌더되는가? "report.md 다운로드"가 정상 동작하는가? 검색·상태 필터가 동작하는가?
3. 아키텍처 체크리스트:
   - **커넥션을 닫지 않는 경로가 없는가?** (`grep -n "new RunStore" web/src/`로 전부 확인 — 각각 `close()`가 보장되는가)
   - 모듈 최상위 싱글턴 커넥션이 없는가?
   - ADR-006: web이 스키마를 중복 정의하지 않고 `@anvil/types`에서 import하는가?
   - ADR-007: `POST /api/runs`가 createRun → spawn 순서를 지키는가?
   - 상태 판정 규칙이 SQL에 복제되지 않았는가?
   - CLAUDE.md CRITICAL: web이 외부 API(Gemini/YouTube)를 직접 호출하지 않는가?
4. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."` (다음 step이 쓸 정보: `withRunStore` 시그니처, `RunDetail`의 `rerunOf`, 픽스처 헬퍼 이름)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **모듈 최상위에 DB 커넥션 싱글턴을 두지 마라.** 이유: Next dev 서버의 HMR이 모듈을 재평가하면서 죽은 핸들을 재활용한다. 요청마다 열고 닫는다.
- **삭제·재실행 API를 여기서 만들지 마라.** 이유: step 6·7의 scope다. 이 step은 **기존 기능을 DB 위에서 그대로 동작시키는 것**이 전부다. 회귀와 신규를 같은 step에 섞으면 원인을 분리할 수 없다.
- **UI 컴포넌트를 수정하지 마라.** 이유: 이 step은 데이터 계층이다. `RunDetail`에 `rerunOf`를 **추가만** 하고, 그것을 화면에 그리는 것은 step 7이다.
- **상태 필터를 SQL WHERE 절로 구현하지 마라.** 이유: `deriveRunStatus`와 규칙이 이중화되어 반드시 갈라진다.
- **web에 새 zod 스키마를 정의하지 마라.** 이유: ADR-006 — 타입·스키마는 `src/types` 단일 소스다.
- **기존 픽스처 JSON 데이터를 재작성하지 마라.** 이유: 그 데이터는 실제 run에서 뽑은 회귀 방지 자산이다(완료·waiting·구스키마 run). 읽어서 seed하라.
- 기존 테스트를 깨뜨리지 마라. 특히 `spawnConsult` mock으로 실제 spawn을 막는 부분.
