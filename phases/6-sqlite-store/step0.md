# Step 0: design-docs

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — 특히 **ADR-002**(저장은 파일 기반, DB 없음), **ADR-004**(하네스 패턴 런타임), **ADR-007**(웹의 CLI detached spawn + state.json 폴링). 이번 phase는 ADR-002를 폐기한다.
- `/docs/ARCHITECTURE.md` — `runs/{run-id}/` 산출물 목록, 데이터 흐름, "상태 관리" 절
- `/docs/PRD.md` — "run 상태 파생 규칙", Phase 1-web-ui의 제외 사항
- `/docs/UI_GUIDE.md` — 버튼·뱃지 규격, 색 사용 원칙
- `/CLAUDE.md` — CRITICAL 규칙
- `src/lib/runStore.ts` — 현재의 파일 기반 저장소 (이번 phase가 SQLite로 바꿀 대상)

## 배경 — 이 phase가 존재하는 이유

ADR-002는 이렇게 끝난다:

> **트레이드오프**: 이력 조회·검색이 불편하다. 웹 UI phase에서 필요해지면 그때 DB를 도입한다.

그 시점이 왔다. 필요해진 것 세 가지:

1. **삭제** — run 삭제 기능이 코드베이스 전체에 없다. `RunStore`에 `deleteRun`이 없고 API에 `DELETE` 핸들러가 없다. PRD Phase 1의 제외 사항에 "run 삭제"가 명시적으로 들어가 있다.
2. **재실행** — 완료된 run을 **같은 아이디어·같은 인터뷰 답변으로 자료조사부터 처음부터** 다시 돌리는 경로가 없다. 현재의 "이어서 실행"(resume)은 완료된 step을 건너뛰므로 정반대 동작이고, `POST /api/runs/{id}/resume`는 completed run을 409로 거절한다.
3. **상태 판정의 정직성** — `deriveRunStatus`는 `state.json`의 **파일 mtime**으로 "중단됨(stalled)"을 추정한다. 프로세스 생존 여부를 파일시스템 메타데이터로 짐작하는 휴리스틱이다.

### 왜 SQLite인가 (이미 결정됨 — 문서에 근거를 남기는 것이 이 step의 일이다)

- 로컬 단일 사용자 도구다. 서버형 DB(PostgreSQL)는 순수 비용이다.
- **CLI 프로세스와 Next.js 서버가 같은 저장소를 동시에 읽고 쓴다**(ADR-007). SQLite의 **WAL 모드**가 "쓰는 프로세스 1 + 읽는 프로세스 N"을 정확히 해결한다.
- 삭제가 외래키 `ON DELETE CASCADE` 한 줄이 된다.
- 구현체는 **Node 24 내장 `node:sqlite`** (`DatabaseSync`). 새 의존성 0개 — 현재 런타임 deps가 `@google/genai`·`dotenv`·`zod` 3개뿐인 이 프로젝트의 "외부 의존성 최소화" 철학(ADR 서문)과 맞는다. Node v24.14.1에서 동작을 확인했다.

## 작업

**코드는 절대 건드리지 않는다. 문서만 수정한다.**

`scripts/execute.py`가 `CLAUDE.md`와 `docs/*.md`를 **매 step 프롬프트에 가드레일로 주입**한다. 문서를 먼저 고치지 않으면 이후 8개 step의 에이전트가 "저장은 파일 기반, DB 없음"(ADR-002)을 근거로 변경을 되돌린다.

### 1. `docs/ADR.md`에 ADR-014, ADR-015 추가

기존 ADR들의 서술 톤과 구조(**결정 / 이유 / 뒤집는 결정 / 기각한 대안 / 트레이드오프 / 하위호환**)를 그대로 따르라. ADR-013 바로 아래에 붙인다.

#### `### ADR-014: 저장소를 SQLite로 전환한다 (ADR-002를 폐기)`

**결정**: 실행 상태·에이전트 산출물·리포트를 `runs/{run-id}/` 파일이 아니라 SQLite DB(`data/anvil.db`) 한 파일에 저장한다. 구현체는 Node 내장 `node:sqlite`의 `DatabaseSync`다. 새 npm 의존성을 추가하지 않는다.

테이블은 3개다:

```
runs(run_id PK, idea, created_at, updated_at, completed_at NULL,
     interview INTEGER, rerun_of NULL REFERENCES runs(run_id) ON DELETE SET NULL)
steps(run_id REFERENCES runs ON DELETE CASCADE, name, ordinal, status,
      started_at, completed_at, failed_at, error_message, PRIMARY KEY(run_id, name))
artifacts(run_id REFERENCES runs ON DELETE CASCADE, kind, content TEXT, updated_at,
          PRIMARY KEY(run_id, kind))
```

`artifacts.kind` ∈ `questions | answers | research | context | thesis | criticism | solution | verdict | report`.

**핵심 규칙으로 못박을 것 3가지** (이후 step들이 이 문장을 근거로 구현한다):

- **에이전트 산출물을 컬럼으로 정규화하지 않는다.** `artifacts.content`는 JSON 직렬화 문자열이고(`kind='report'`만 마크다운 원문), 검증 권위는 계속 zod다. 이유: 에이전트 스키마는 자주 바뀐다(ADR-011의 criticism 평탄화, ADR-013의 citations·communityVoices 코드 주입). 정규화하면 스키마 변경마다 SQL 마이그레이션이 따라붙고, zod와 DDL 두 곳에 스키마가 중복된다. **DB는 바이트를 보관하고, 의미는 zod가 소유한다.**
- **`saveRun`은 UPDATE-only다.** INSERT는 `createRun`/`createRerun`만 한다. 존재하지 않는 run에 `saveRun`이 호출되면 에러다. 이유: 삭제된 run을 아직 살아 있는 detached CLI 프로세스가 다시 INSERT해 되살리는 것을 구조적으로 막는다(ADR-015).
- **모든 쓰기는 `runs.updated_at`을 갱신한다.** 이 값이 `stalled` 판정의 유일한 근거이며, 기존 `state.json` 파일 mtime을 대체한다.

연결 시 반드시 설정할 PRAGMA: `journal_mode = WAL`(CLI 쓰기와 Next 서버 읽기의 동시 접근), `busy_timeout = 5000`(잠금 경합 시 즉시 실패 대신 대기), `foreign_keys = ON`(**이게 꺼져 있으면 CASCADE 삭제가 조용히 동작하지 않는다** — SQLite의 기본값은 OFF다).

**뒤집는 결정**: ADR-002("저장은 파일 기반, DB 없음")를 폐기한다. ADR-002가 예고한 "웹 UI phase에서 필요해지면 그때 DB를 도입한다"의 그 시점이다. 다만 **ADR-004(하네스 패턴 런타임)는 그대로다** — step이 순차 실행되고, 산출물이 persist되며, 실패 시 3회 자가 교정하고, completed step을 건너뛰는 resume이 성립한다는 런타임 설계는 저장 매체와 무관하다. 바뀌는 것은 persist의 매체뿐이다.

**기각한 대안**:
- *PostgreSQL* — 로컬 도구에 데몬 프로세스와 접속 설정을 요구한다. 순수 비용이다.
- *better-sqlite3* — 성숙하고 경고가 없지만 네이티브 바이너리라 설치 시 컴파일 리스크가 있고 Next.js에 `serverExternalPackages` 설정이 필요하다. 내장 모듈은 번들러가 자동으로 externalize한다.
- *Drizzle/Prisma 같은 ORM* — 테이블이 3개인데 마이그레이션 도구 체계가 통째로 들어온다. 이미 zod가 검증을 소유하고 있어 스키마가 두 곳으로 갈라진다.
- *파일은 두고 인덱스 DB만 추가* — 진실 공급원이 둘이 되어 삭제·재실행에서 반드시 어긋난다.

**트레이드오프**: `node:sqlite`는 Node 24에서 실험적(experimental)이라 실행 시 `ExperimentalWarning`이 출력된다. node를 띄우는 npm 스크립트에 `NODE_OPTIONS=--disable-warning=ExperimentalWarning`을 붙여 억제한다. 또한 산출물이 더 이상 사람이 직접 열어보는 파일이 아니다 — 대신 웹 UI와 `report.md` 다운로드가 그 역할을 한다.

**하위호환**: 기존 `runs/*/`는 일회성 스크립트(`npm run migrate:runs`)로 DB에 이송한다. 원본 디렉토리는 지우지 않는다. 스키마 검증에 실패하는 구 run(ADR-011의 평탄화 이전 criticism 등)도 **원문 그대로 이송한다** — 마이그레이션은 검증기가 아니라 이송기다. 읽기 시점에 zod가 실패하면 지금처럼 `null`이 되어 UI가 빈 상태를 보여준다.

#### `### ADR-015: 삭제는 CASCADE, 재실행은 포크`

**결정**:

- **삭제** — `DELETE FROM runs WHERE run_id = ?` 한 줄이 FK CASCADE로 steps·artifacts를 함께 지운다. 단 **`running` 상태인 run은 삭제할 수 없다**(409). 아직 살아 있는 CLI 프로세스가 쓰기를 계속하기 때문이다. `waiting`·`completed`·`error`·`stalled`는 삭제할 수 있다.
- **재실행(rerun) = 새 run으로 포크** — 원본을 덮어쓰지 않는다. 원본의 `idea`·인터뷰 `questions`·`answers`만 복사해 새 `run_id`를 만들고, `research`·`context`·`thesis`·`criticism`·`solution`·`verdict`·`report`는 **복사하지 않는다**. 즉 자료조사부터 전부 새로 돈다. 계보는 `runs.rerun_of` 컬럼에 남긴다.

**이유**:

- 포크는 원본 리포트를 보존한다. 재실행이 실패해도 멀쩡했던 결과를 잃지 않는다.
- 이미 있는 `/compare` 화면으로 **"이전 결과 vs 새 결과"** 비교가 공짜로 성립한다. 같은 입력으로 두 번 돌렸을 때 결론이 얼마나 흔들리는지가 곧 이 도구의 신뢰도이므로, 그 비교는 부산물이 아니라 기능이다.
- 덮어쓰기는 되돌릴 수 없다. 파괴적 동작은 사용자가 명시적으로 요청한 삭제 하나로 충분하다.

**`stalled` run 삭제의 잔여 위험과 그 처리**: `stalled`는 "프로세스가 죽었다고 **추정**"하는 상태다. 실제로는 살아 있는 좀비 프로세스가 나중에 쓰기를 시도할 수 있다. 그래서 **`saveRun`을 UPDATE-only로 만든다**(ADR-014) — 삭제된 run에 대한 쓰기는 0 rows 갱신으로 에러가 되고, 좀비는 되살아나지 못한 채 죽는다. 삭제의 안전성이 애플리케이션의 조심성이 아니라 저장 계층의 불변식으로 보장된다.

**resume과 rerun은 다른 버튼이다**: resume은 **중단 지점부터**(완료 step 건너뜀), rerun은 **자료조사부터**(전부 새로). UI에서 둘을 같은 버튼으로 합치지 않는다.

**기각한 대안**:
- *기존 run 덮어쓰기(in-place reset)* — 이력이 늘지 않는 대신 이전 결과가 사라지고 비교가 불가능하다.
- *`research.json`을 재사용해 LLM만 다시 돌리기* — 사용자의 요구는 "**다시 자료조사**와 결과값"이다. 자료조사 결과가 고정되면 재실행의 의미가 절반이 된다.

**트레이드오프**: 재실행할 때마다 run이 하나씩 늘어나고 외부 API 쿼터를 다시 쓴다. 삭제 기능이 함께 들어가므로 이력 증가는 사용자가 정리할 수 있다.

#### ADR-002, ADR-007 정리

- ADR-002 제목 줄 아래에 `**상태**: ADR-014로 폐기됨 (2026-07-12)` 한 줄을 추가한다. 본문은 지우지 않는다 — ADR은 append-only 기록이다.
- ADR-007 본문의 트레이드오프에 남아 있는 `mtime 휴리스틱(10분)`은 두 번 낡았다. ADR-012에서 15분으로 바뀌었고, 이제 mtime 자체가 `updated_at` 컬럼으로 대체된다. `updated_at 휴리스틱(15분)`으로 정정하라. **ADR-007의 결정 자체(createRun 선생성 + CLI detached spawn + 폴링)는 유효하다** — 폴링 대상이 파일에서 DB 행으로 바뀔 뿐이다.

### 2. `docs/ARCHITECTURE.md` 갱신

- **`runs/{run-id}/` 산출물 블록을 DB 스키마 블록으로 교체**한다. 파일명(`state.json`, `context.json` …)과 `artifacts.kind` 값의 대응이 드러나야 이후 step들이 매핑을 지어낼 필요가 없다. `data/anvil.db`가 git 미추적임을 명시하라.
- `src/` 구조 설명의 `lib/`에 `db` (SQLite 연결·스키마)를 추가하고, `runStore`의 설명을 "runs/ 파일 I/O"에서 "SQLite 저장소"로 바꾼다.
- **데이터 흐름** 다이어그램의 `→ runs/{id}/*.json` 표기를 DB 저장(`artifacts.kind=...`)으로 바꾼다.
- **웹 UI 데이터 흐름**의 "RunStore로 runs/ 파일 읽기"를 "RunStore로 DB 읽기"로, "state.json이 진행 상태의 단일 진실 공급원"을 "`runs`·`steps` 테이블이 진행 상태의 단일 진실 공급원"으로 바꾼다. 요청마다 커넥션을 열고 닫는다는 규칙(Next dev 서버의 HMR이 모듈 싱글턴을 재활용하면 죽은 핸들이 남는다)을 적어라.
- **상태 관리** 절: "`runs/{run-id}/state.json`이 단일 진실 공급원" → "DB의 `runs`·`steps` 테이블", "state.json의 mtime 휴리스틱" → "`runs.updated_at` 컬럼". `STALLED_THRESHOLD_MS = 15분`과 그 근거(가장 긴 step인 context-hunter가 최악 6분)는 **그대로 유지**한다. 멱등성 요구("같은 입력으로 여러 번 실행해도 결과가 달라지지 않는다")도 그대로다.
- **패턴** 절에 항목 추가: `**저장소는 바이트를, zod는 의미를** (ADR-014) — 에이전트 산출물은 artifacts 테이블에 JSON 문자열로 통째로 들어간다. 컬럼으로 정규화하지 않는다. 스키마의 권위는 zod 단독이다.`

### 3. `docs/PRD.md` 갱신

- **Phase 6 섹션 신설** (기존 Phase 섹션들의 구조를 따를 것): 목표(저장소 SQLite 전환 + 삭제 + 재실행), 화면·동작 요구사항.
  - 삭제: 목록과 상세 양쪽에서 가능. **확인 단계 필수**(되돌릴 수 없다). 실행 중인 run은 삭제 불가.
  - 재실행: 완료된 run에서 "재실행" → 같은 아이디어·같은 인터뷰 답변으로 새 run이 생기고 자료조사부터 다시 돈다. 인터뷰 질문을 **다시 묻지 않는다**. 새 run 상세로 이동한다.
  - 계보: 재실행으로 생긴 run 상세에 원본 링크와, 둘 다 완료됐을 때 비교 바로가기를 표시한다.
- **"run 상태 파생 규칙"**의 `state.json 파일 mtime` → `runs.updated_at`. 나머지 규칙(completed → error → waiting → running/stalled, 15분)은 불변이다.
- Phase 1-web-ui의 제외 사항에서 "run 삭제"와 "DB 도입(ADR-002 유지)"을 **삭제하지 말고**, "→ Phase 6에서 도입"이라고 표시하라. PRD도 기록이다.
- PRD는 Phase 3에서 멈춰 있고 Phase 4·5 섹션이 없다. **그것을 소급해 채우려 하지 마라** — 이번 phase의 scope가 아니다.

### 4. `docs/UI_GUIDE.md` 갱신

이후 step 6·7의 에이전트가 이 규격을 보고 UI를 만든다. 다음을 정하라:

- **삭제 버튼** — 파괴적 액션의 시각 규격(기존 색 사용 원칙과 충돌하지 않게: UI_GUIDE의 "색은 의미를 가진다" 원칙을 확인하고, severity 팔레트를 재사용할지 별도 톤을 쓸지 결정하라). 확인 단계의 형태(인라인 확인 vs 모달)와 문구.
- **재실행 버튼** — resume("이어서 실행")과 **시각적으로 구분**되어야 한다. 두 버튼이 같은 화면에 동시에 뜨는 경우는 없지만(resume은 error/stalled, rerun은 completed), 사용자가 둘을 같은 것으로 오해하면 안 된다. 문구는 "재실행"으로 통일하고, 부제/툴팁으로 "자료조사부터 다시"를 밝힌다.
- **계보 표시** — 재실행 run 상세 상단의 안내 문구와 링크 규격.

## Acceptance Criteria

```bash
npm run build           # 컴파일 에러 없음 (코드 무변경이므로 당연히 통과해야 한다)
npm test                # 테스트 통과
npm run lint            # 통과
git diff --name-only    # docs/ 아래 파일만 나와야 한다
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 코드 무변경이므로 build·test·lint는 당연히 통과해야 한다 — 통과하지 않으면 문서 외의 파일을 건드린 것이다.
2. `git diff --name-only`에 `docs/` 밖의 파일이 하나라도 있으면(단 `phases/6-sqlite-store/index.json` 제외) 되돌려라.
3. 아키텍처 체크리스트:
   - ADR-014가 ADR-002를 폐기한다는 것과, **ADR-004(하네스 패턴)는 유지된다**는 것이 둘 다 명시됐는가?
   - ARCHITECTURE.md의 DB 스키마가 ADR-014의 스키마와 **글자 그대로 일치**하는가? (이후 step들이 두 문서를 모두 읽는다. 어긋나면 구현이 갈라진다.)
   - PRD의 "run 상태 파생 규칙"과 ARCHITECTURE의 "상태 관리"가 `updated_at`으로 일치하는가?
4. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **코드를 수정하지 마라.** `src/`, `web/`, `scripts/`, `package.json` 전부. 이유: 이 step의 산출물은 이후 8개 step의 가드레일이다. 문서와 코드를 같은 step에서 바꾸면 무엇이 설계이고 무엇이 구현인지 분리되지 않는다.
- **ADR-002·ADR-007을 삭제하거나 재작성하지 마라.** 이유: ADR은 append-only 기록이다. 폐기는 새 ADR이 "뒤집는 결정" 절에서 명시하고 구 ADR에 상태 한 줄을 다는 방식으로만 한다(ADR-008·ADR-012·ADR-013의 선례).
- **`STALLED_THRESHOLD_MS`를 15분에서 바꾸지 마라.** 이유: 이 값은 가장 긴 step(context-hunter, grounding + urlContext 왕복으로 최악 6분)과 암묵적으로 결합돼 있다. 저장 매체가 바뀌어도 step 실행 중에는 `updated_at`이 갱신되지 않는다는 전제가 mtime 시절과 동일하다.
- **ORM·마이그레이션 프레임워크를 문서에 도입하지 마라.** 이유: 테이블 3개에 도구 체계가 통째로 들어오고, zod와 스키마가 이중화된다.
- 기존 테스트를 깨뜨리지 마라.
