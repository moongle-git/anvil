# Step 4: runs-migration

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-014**의 "하위호환" 절(기존 runs/를 일회성 스크립트로 이송, 검증 실패해도 원문 그대로), **ADR-011**(구 run은 읽기 시점에 `null`로 페일소프트)
- `/docs/ARCHITECTURE.md` — DB 스키마
- `/CLAUDE.md` — CRITICAL 규칙
- **`src/lib/db.ts`** — `openDb`, `getDefaultDbPath`, `ArtifactKind`
- **`src/lib/runStore.ts`** — SQLite 저장소. `createRun`이 새 runId를 만들어버리므로 **마이그레이션은 이걸 쓸 수 없다**(아래 참고).
- `src/types/run.ts` — `RunStateSchema`
- `scripts/execute.py` — 이 디렉토리에 스크립트를 두는 관례 참고 (단, 이건 파이썬이다)
- 실제 데이터: `runs/` 디렉토리를 `ls`로 열어 무엇이 들어 있는지 눈으로 확인하라. run 10개가 있고 구조가 서로 다르다(구버전 run은 `research.json`·`questions.json`이 없다).

## 배경

기존 `runs/{run-id}/`에 run 10개가 있다. 실제 컨설팅 결과이므로 버리지 않고 DB로 이송한다.

**마이그레이션은 검증기가 아니라 이송기다.** 구 run 중에는 ADR-011(criticism 평탄화) 이전 스키마라 zod 검증에 실패하는 것이 섞여 있다. 그것들도 **원문 그대로 넣는다.** 읽기 시점에 zod가 실패하면 지금처럼 `null`이 되어 UI가 빈 상태를 보여준다(ADR-011). 이송 단계에서 거르면, 지금은 못 읽지만 나중에 스키마가 다시 바뀌면 읽힐 수도 있는 데이터를 영영 버리는 셈이다.

## 작업

### 1. `scripts/migrateRuns.ts` 신규 생성

```ts
export interface MigrationResult {
  imported: string[];   // 새로 이송한 runId
  skipped: string[];    // 이미 DB에 있어서 건너뛴 runId
  failed: { runId: string; reason: string }[];  // state.json 부재·손상 등
}

export function migrateRuns(runsDir: string, dbPath: string): MigrationResult;
```

`package.json`에 `"migrate:runs": "NODE_OPTIONS=--disable-warning=ExperimentalWarning tsx scripts/migrateRuns.ts"` 추가.

기본 경로는 `<repo>/runs`와 `getDefaultDbPath()`. CLI 인자로 덮어쓸 수 있게 해도 좋지만 필수는 아니다.

### 2. 이송 규칙 — 반드시 지킬 것

**`RunStore.createRun`을 쓰지 마라.** `createRun`은 새 `runId`를 timestamp+suffix로 생성한다. 마이그레이션은 **원본 `runId`를 그대로 보존해야 한다** — 웹의 기존 북마크·비교 URL이 살아 있어야 하고, 무엇보다 같은 run을 두 번 이송하면 안 된다(멱등성). `db.ts`의 `openDb`로 커넥션을 직접 열어 SQL로 INSERT하라. `RunStore`의 private 내부를 억지로 뚫지 마라.

**멱등**: 이미 같은 `run_id`가 `runs`에 있으면 건너뛴다(`skipped`). 여러 번 돌려도 안전해야 한다. 이미 이송한 run을 덮어쓰지 마라 — 이송 후 그 run을 재실행하거나 삭제했을 수 있다.

**fail-soft**: `state.json`이 없거나, JSON 파싱에 실패하거나, `RunStateSchema` 검증에 실패한 디렉토리는 **건너뛰고 `failed`에 기록**한다. 예외를 던져 전체 이송을 중단시키지 마라. 현재 `listRuns`가 손상 run을 `continue`로 건너뛰는 것과 같은 태도다.

**`state.json`만은 검증한다** — `runs`·`steps` 행을 만들려면 구조를 알아야 하기 때문이다. **그 외 아티팩트 JSON은 검증하지 않는다.** 파일을 읽어 `artifacts.content`에 **문자열 그대로** 넣는다. `JSON.parse` 후 다시 `stringify`하지 마라 — 파싱조차 하지 마라. 유일한 예외는 "JSON으로 파싱조차 안 되는 파일"인데, 그것도 넣어라(읽기 시점에 `null`이 된다).

**파일 → `artifacts.kind` 매핑**:

| 파일 | `kind` |
|---|---|
| `questions.json` | `questions` |
| `answers.json` | `answers` |
| `research.json` | `research` |
| `context.json` | `context` |
| `thesis.json` | `thesis` |
| `criticism.json` | `criticism` |
| `solution.json` | `solution` |
| `verdict.json` | `verdict` |
| `report.md` | `report` (마크다운 원문) |

없는 파일은 그냥 없는 것이다(구 run에는 `research.json`·`questions.json`이 없다).

**`updated_at`은 원본 `state.json`의 파일 mtime을 쓴다.** now를 쓰면 안 된다 — 미완료 상태로 남은 과거 run이 갑자기 "running"으로 표시된다(`deriveRunStatus`가 `updated_at` 기준 15분 이내면 running으로 판정한다). `artifacts.updated_at`도 각 원본 파일의 mtime을 쓰면 좋지만, `state.json` mtime으로 통일해도 무방하다.

**`interview`**는 `state.json`의 `interview` 필드에서, **`rerun_of`는 NULL**이다(구 run에는 재실행 계보가 없다).

**한 run의 이송은 한 트랜잭션이다.** run 하나가 중간에 실패하면 그 run의 부분 데이터가 남지 않아야 한다.

### 3. 원본은 지우지 않는다

`runs/` 디렉토리를 **삭제하지 마라.** 스크립트가 완료 시 요약과 함께 "원본 `runs/`는 그대로 두었다. DB를 확인한 뒤 직접 지워라"를 출력한다.

출력 예:
```
이송 완료: 10개 (건너뜀 0, 실패 0)
원본 runs/ 디렉토리는 지우지 않았다. 웹 UI에서 확인한 뒤 직접 삭제하라.
```

### 4. `.gitignore`

step 1에서 `/data/`를 추가했는지 확인하라. 없으면 추가한다. `/runs/`는 그대로 둔다.

### 5. 테스트 (`scripts/migrateRuns.test.ts`) — TDD

**실제 `runs/` 디렉토리를 읽는 테스트를 쓰지 마라.** tmp 디렉토리에 가짜 run 디렉토리를 만들어 검증한다:

- 정상 run 하나가 `runs`·`steps`·`artifacts`에 전부 들어간다.
- **멱등**: 같은 디렉토리를 두 번 이송하면 두 번째는 전부 `skipped`이고 DB의 행 수가 늘지 않는다.
- **손상 run 격리**: `state.json`이 없는 디렉토리, 깨진 JSON, 스키마 검증 실패 — 각각 `failed`에 들어가고 **다른 run의 이송은 성공한다**.
- **검증 실패 아티팩트도 이송된다**: `criticism.json`에 구 스키마(평탄화 이전 3그룹 배열) 또는 아예 깨진 JSON을 넣어도 `artifacts`에 원문이 들어간다. 그리고 `RunStore.loadStepOutput`으로 읽으면 `null`이 나온다(throw하지 않는다).
- **`updated_at`이 원본 mtime이다**: `fs.utimesSync`로 `state.json`의 mtime을 과거로 돌린 뒤 이송하면, `deriveRunStatus`가 `running`이 아니라 `stalled`로 판정한다.
- `report.md`가 `artifacts.kind='report'`로 들어가고 `RunStore.loadReport`로 원문 그대로 읽힌다.

### 6. 실제 이송 실행

테스트가 통과하면 **실제로 한 번 돌려라**:

```bash
npm run migrate:runs
sqlite3 data/anvil.db "select count(*) from runs;"        # 10이어야 한다
sqlite3 data/anvil.db "select count(*) from artifacts;"
npm run migrate:runs                                       # 두 번째 실행 — 전부 skipped
sqlite3 data/anvil.db "select count(*) from runs;"        # 여전히 10
```

`sqlite3` CLI가 없으면 `node -e`로 `node:sqlite`를 써서 확인하라.

## Acceptance Criteria

```bash
npm run build        # 컴파일 에러 없음 (web은 아직 깨질 수 있다 — step 5에서 해소)
npx tsc --noEmit     # ★ 반드시 통과
npx vitest run       # ★ 루트 테스트 전부 통과 (신규 migrateRuns.test.ts 포함)
npm run lint         # 통과
npm run migrate:runs && npm run migrate:runs   # 두 번 돌려도 에러 없음 (멱등)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 실제 이송 후 DB의 run 수가 `ls runs | wc -l`과 일치하는지(또는 손상 run만큼 적은지) 확인하라. 실패한 run이 있으면 그 사유를 `summary`에 적어라.
3. `runs/` 디렉토리가 **그대로 남아 있는지** 확인하라.
4. 아키텍처 체크리스트:
   - `scripts/migrateRuns.ts`가 `RunStore.createRun`을 쓰지 않는가? (원본 runId 보존)
   - 아티팩트 JSON을 재직렬화하지 않고 원문 그대로 넣는가?
   - CLAUDE.md CRITICAL: 외부 API 호출 없음.
5. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."` (이송된 run 수, 실패한 run과 사유 포함)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`runs/` 디렉토리를 삭제하지 마라.** 이유: 되돌릴 수 없다. 사용자가 DB를 확인한 뒤 직접 지운다.
- **`RunStore.createRun`으로 이송하지 마라.** 이유: 새 runId가 생성되어 원본 ID가 사라지고, 두 번 돌리면 중복된다.
- **아티팩트를 zod로 검증해서 거르지 마라.** 이유: 마이그레이션은 이송기다. 구 스키마 데이터를 여기서 버리면 영영 복구할 수 없다. 읽기 시점 페일소프트(ADR-011)가 이미 그 역할을 한다.
- **아티팩트 JSON을 `JSON.parse` → `JSON.stringify`로 재직렬화하지 마라.** 이유: 파싱이 실패하는 파일이 있고, 성공하더라도 원문을 바꿀 이유가 없다. 바이트를 그대로 옮겨라.
- **`updated_at`에 `Date.now()`를 넣지 마라.** 이유: 미완료 상태로 죽은 과거 run이 전부 "실행 중"으로 표시된다.
- **한 run의 실패가 전체 이송을 중단시키게 하지 마라.** 이유: 손상 run 하나 때문에 나머지 9개를 못 옮기는 것은 말이 안 된다.
- **기존 테스트가 실제 `runs/` 디렉토리를 읽게 하지 마라.** 이유: CI/다른 머신에는 그 디렉토리가 없다. tmp 픽스처를 쓴다.
- 기존 테스트를 깨뜨리지 마라.
