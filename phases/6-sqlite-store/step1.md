# Step 1: db-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-014**(저장소 SQLite 전환)가 이 step의 헌법이다. 스키마와 PRAGMA가 여기 적혀 있다.
- `/docs/ARCHITECTURE.md` — DB 스키마 블록, `src/` 디렉토리 구조 (`lib/`에 `db`가 추가돼 있다)
- `/CLAUDE.md` — CRITICAL 규칙 (특히 TDD: 테스트를 먼저 쓰고 통과하는 구현을 쓴다)
- `src/lib/runStore.ts` — 현재의 파일 기반 저장소. **이 step에서는 건드리지 않는다** (step 2의 일이다). 어떤 데이터가 저장되는지만 파악하라.
- `src/types/run.ts` — `RunState`, `StepState`, `PIPELINE_STEPS`
- `src/lib/html.ts` + `src/lib/html.test.ts` — 이 프로젝트의 순수 유틸 모듈과 테스트가 어떤 모양인지 참고하라.

## 배경

이 step은 **DB 연결과 스키마만** 만든다. `RunStore`를 SQLite로 바꾸는 것은 step 2다. 두 개를 한 step에서 하면 "연결이 잘못됐는가, 저장 로직이 잘못됐는가"를 분리할 수 없다.

Node v24.14.1에서 `node:sqlite`의 `DatabaseSync`가 동작하는 것을 확인했다. 새 npm 의존성을 설치하지 마라 — 내장 모듈이다.

## 작업

### 1. `src/lib/db.ts` 신규 생성

```ts
import { DatabaseSync } from "node:sqlite";

/** 스키마를 보장한 DB 커넥션을 연다. dbPath는 ":memory:"도 허용한다(테스트). */
export function openDb(dbPath: string): DatabaseSync;

/** ANVIL_DB_PATH ?? <repo-root>/data/anvil.db */
export function getDefaultDbPath(): string;
```

`openDb`가 반드시 수행할 것 — **전부 데이터 무결성의 핵심이다**:

1. 파일 경로면 상위 디렉토리를 `mkdir -p` 한다(`:memory:`는 예외).
2. PRAGMA 3종:
   ```sql
   PRAGMA journal_mode = WAL;    -- CLI(쓰기)와 Next 서버(읽기)가 같은 파일에 동시 접근한다
   PRAGMA busy_timeout = 5000;   -- 잠금 경합 시 즉시 SQLITE_BUSY로 죽지 말고 기다린다
   PRAGMA foreign_keys = ON;     -- SQLite 기본값은 OFF다. 꺼져 있으면 CASCADE 삭제가 조용히 동작하지 않는다
   ```
   `journal_mode = WAL`은 `:memory:` DB에서는 적용되지 않는다(SQLite가 `memory`를 반환한다). 그것을 에러로 취급하지 마라.
3. DDL을 `CREATE TABLE IF NOT EXISTS`로 실행한다. **여러 번 열어도 안전해야 한다**(멱등).

DDL — ADR-014와 ARCHITECTURE.md에 적힌 것과 일치해야 한다:

```sql
CREATE TABLE IF NOT EXISTS runs (
  run_id       TEXT PRIMARY KEY,
  idea         TEXT NOT NULL,
  created_at   TEXT NOT NULL,               -- ISO 8601
  updated_at   TEXT NOT NULL,               -- ISO 8601. 모든 쓰기가 갱신한다 (stalled 판정의 유일한 근거)
  completed_at TEXT,
  interview    INTEGER NOT NULL DEFAULT 0,  -- 0|1
  rerun_of     TEXT REFERENCES runs(run_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS steps (
  run_id        TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,           -- PIPELINE_STEPS 순서. 조회 시 정렬 기준
  status        TEXT NOT NULL,              -- pending|completed|error|waiting
  started_at    TEXT,
  completed_at  TEXT,
  failed_at     TEXT,
  error_message TEXT,
  PRIMARY KEY (run_id, name)
);

CREATE TABLE IF NOT EXISTS artifacts (
  run_id     TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                 -- questions|answers|research|context|thesis|criticism|solution|verdict|report
  content    TEXT NOT NULL,                 -- JSON 직렬화 문자열. kind='report'만 마크다운 원문
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, kind)
);

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
```

`schema_version`은 최초 생성 시 `1`을 넣고, 이미 행이 있으면 건드리지 않는다. **지금은 마이그레이션 로직을 만들지 마라** — 버전을 기록만 해두고, 실제로 스키마를 바꿔야 할 때 그때 만든다. 지금 쓰지 않을 마이그레이션 프레임워크를 짓는 것은 낭비다.

### 2. `ArtifactKind` 타입

`artifacts.kind`의 9개 값을 문자열 리터럴 유니온으로 export하라. 어디에 둘지는 재량이되(`src/lib/db.ts` 또는 `src/types/`), **문자열을 코드 여기저기에 흩뿌리지 마라** — step 2·4·5가 전부 이 값을 쓴다.

### 3. `NODE_OPTIONS` — ExperimentalWarning 억제

`node:sqlite`는 Node 24에서 실험적이라 `import`만 해도 stderr에 경고가 뜬다. 루트 `package.json`의 스크립트 중 **node를 띄우는 것 전부**에 `NODE_OPTIONS=--disable-warning=ExperimentalWarning`을 붙여라: `build`, `test`, `lint`, `consult`.

특히 `consult`는 필수다 — 웹이 `spawnConsult`로 `npm run consult`를 detached spawn하므로, 이 스크립트를 거치지 않는 경로가 없다.

`web/package.json`의 `dev`·`build`·`start`에도 붙여라 (Next 서버가 `RunStore`를 통해 `node:sqlite`를 로드한다).

### 4. 테스트 (`src/lib/db.test.ts`) — TDD, 먼저 쓴다

이 프로젝트의 테스트는 소스 옆에 co-locate한다. 최소한 다음을 검증하라:

- `openDb(":memory:")`가 3개 테이블을 만든다.
- **멱등**: 같은 파일 경로로 `openDb`를 두 번 호출해도 에러 없이 열리고, 기존 데이터가 보존된다.
- **`foreign_keys = ON`이 실제로 켜져 있다**: `PRAGMA foreign_keys`가 1을 반환한다. 그리고 존재하지 않는 `run_id`로 `steps`/`artifacts`에 INSERT하면 **실패한다**(FK 위반). 이 테스트가 없으면 CASCADE가 조용히 죽어도 아무도 모른다.
- **CASCADE 동작**: `runs`에서 행을 지우면 그 run의 `steps`·`artifacts`가 함께 사라진다.
- **`rerun_of`의 `ON DELETE SET NULL`**: 원본 run을 지워도 재실행 run은 남고 `rerun_of`만 `NULL`이 된다.
- **WAL / 동시 접근**: 같은 **파일** DB(`:memory:`가 아니라 tmp 파일)를 커넥션 2개로 열고, 한쪽이 INSERT하는 동안 다른 쪽이 SELECT해도 실패하지 않으며 커밋된 데이터가 보인다. 이것이 ADR-014의 근거 자체이므로 반드시 테스트로 못박아라.
- `getDefaultDbPath()`가 `ANVIL_DB_PATH` 환경변수를 존중한다.

테스트가 만드는 파일 DB는 `fs.mkdtempSync(path.join(os.tmpdir(), ...))`에 만들고 `afterEach`에서 지운다(기존 `runStore.test.ts`의 패턴).

### 5. `.gitignore`

`/data/`를 추가한다. DB 파일은 git에 들어가지 않는다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (신규 db.test.ts 포함)
npm run lint    # 통과
npm run consult 2>&1 | head -3   # ExperimentalWarning이 출력되지 않아야 한다 (사용법 안내만 나온다)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. `git diff --stat`으로 `src/lib/runStore.ts`, `src/pipeline/`, `web/`이 **변경되지 않았음**을 확인한다(package.json 스크립트 제외).
3. 아키텍처 체크리스트:
   - `src/lib/db.ts`의 DDL이 `docs/ADR.md`(ADR-014)·`docs/ARCHITECTURE.md`의 스키마와 **글자 그대로 일치**하는가?
   - 새 npm 의존성이 추가되지 않았는가? (`git diff package.json`의 `dependencies`가 그대로여야 한다)
   - CLAUDE.md CRITICAL: 외부 API 호출 없음, 테스트가 실제 API를 때리지 않음 — 이 step은 해당 없음.
4. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"` (다음 step이 쓸 정보: 함수 시그니처, `ArtifactKind`의 위치, 파일 경로)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`better-sqlite3`·`drizzle-orm`·`prisma` 등 어떤 DB 패키지도 설치하지 마라.** 이유: ADR-014가 `node:sqlite` 내장 모듈을 명시적으로 선택했고, 새 의존성 0개가 그 선택의 근거다.
- **`src/lib/runStore.ts`를 수정하지 마라.** 이유: step 2의 scope다. 연결 계층과 저장 로직을 같은 step에서 바꾸면 실패 원인을 분리할 수 없다.
- **`artifacts`의 내용을 컬럼으로 쪼개지 마라.** 이유: ADR-014 — 에이전트 스키마는 자주 바뀐다. DB는 바이트를 보관하고 의미는 zod가 소유한다.
- **마이그레이션 러너를 만들지 마라.** `schema_version`에 1을 기록만 하라. 이유: 지금 필요 없는 추상화다. 스키마 v2가 실제로 필요해질 때 만든다.
- **`PRAGMA foreign_keys = ON`을 빠뜨리지 마라.** 이유: SQLite의 기본값은 OFF이고, 꺼진 상태에서는 `ON DELETE CASCADE`가 **에러 없이 조용히 무시된다**. 삭제 기능이 고아 행을 남기며 성공한 것처럼 보인다.
- 기존 테스트를 깨뜨리지 마라.
