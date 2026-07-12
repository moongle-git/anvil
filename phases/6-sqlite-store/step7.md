# Step 7: rerun

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-015**(재실행은 포크: idea·questions·answers만 복사하고 자료조사부터 새로. resume과 다른 버튼), **ADR-007**(createRun 선생성 + CLI detached spawn)
- `/docs/PRD.md` — Phase 6 섹션의 재실행·계보 요구사항
- **`/docs/UI_GUIDE.md`** — 재실행 버튼과 계보 표시 규격. **step 0이 정한 것을 따르라.**
- `/CLAUDE.md` — CRITICAL 규칙
- **`/web/AGENTS.md`** — Next.js 16이다.
- **`src/lib/runStore.ts`** — `createRerun(sourceRunId): RunState`. **무엇을 복사하고 무엇을 복사하지 않는지** 구현을 직접 읽어 확인하라.
- **`src/pipeline/orchestrator.ts`** — 인터뷰 pause/resume 분기. 포크된 run이 왜 질문을 다시 묻지 않는지 이해하라.
- **`web/src/lib/server/spawnConsult.ts`** — detached spawn. 재실행도 **같은 함수**를 쓴다.
- **`web/src/app/api/runs/route.ts`** — `POST`가 createRun → spawn → 201을 하는 패턴. 재실행이 이것과 같은 모양이어야 한다.
- **`web/src/app/api/runs/[id]/resume/route.ts`** — 409 패턴
- **`web/src/lib/server/runs.ts`** — `withRunStore`, `RunDetail.rerunOf`(step 5에서 추가됨)
- **`web/src/components/report/ReportHeader.tsx`** — 완료된 run의 리포트 헤더. "report.md 다운로드" 링크가 여기 있다.
- **`web/src/components/home/RunList.tsx`** — 이력 목록
- **`web/src/components/progress/RunDetailClient.tsx`** — run 상세. 계보 안내가 들어갈 자리.
- `web/src/components/compare/` — 비교 화면. `/compare?a=..&b=..` URL 규약을 확인하라.

## 배경

사용자의 요구: **"결과는 받았지만 동일한 질문과 내용을 바탕으로 다시 자료조사와 결과값을 받을 수 있는 재실행"**.

ADR-015가 이것을 **포크**로 정의했다: 원본의 `idea`·인터뷰 `questions`·`answers`만 복사한 새 run을 만들고, `research`·`context`·`thesis`·`criticism`·`solution`·`verdict`·`report`는 복사하지 않는다. 즉 **자료조사부터 전부 새로 돈다.**

**포크된 run은 특별한 취급 없이 그냥 돌아간다.** `createRerun`이 `interviewer` step을 `completed`로 seed하고 `answers` 아티팩트를 복사해두었으므로, orchestrator는 인터뷰 분기에서 `answers !== null` 경로를 타서 질문을 다시 묻지 않고 `formatClarifications`로 답변을 프롬프트에 주입한 뒤, `pending`인 `context-hunter`부터 새로 수집한다. **orchestrator를 수정할 필요가 없다.**

**resume과 rerun은 다른 버튼이다** — resume은 중단 지점부터(완료 step 건너뜀), rerun은 자료조사부터(전부 새로). UI에서 둘을 합치지 마라.

> **⚠️ `web/src/components/home/HomePage.tsx`는 죽은 파일이다.** 어디서도 import되지 않는다. 살아 있는 경로는 `page.tsx` → `HomeClient` → `RunList`다. 고치지도, 지우지도 마라.

## 작업

### 1. `POST /api/runs/[id]/rerun`

`web/src/app/api/runs/[id]/rerun/route.ts` 신규.

| 상황 | 응답 |
|---|---|
| 원본이 없음 | `404` |
| 원본이 `running` 또는 `waiting` | **`409`** + 사유(아직 결과가 없다 / 실행 중이다) |
| `completed` / `error` / `stalled` | `createRerun` → `spawnConsult(newRunId)` → **`201 { runId: newRunId }`** |

**순서를 지켜라** (ADR-007): `createRerun`으로 새 run을 **DB에 먼저 쓴 뒤** spawn하고 즉시 응답한다. spawn된 CLI가 `--resume {newRunId}`로 그 run을 읽기 때문에, 순서가 뒤집히면 CLI가 존재하지 않는 run을 찾는다. 기존 `POST /api/runs`의 테스트가 이 순서를 검증하듯, 재실행도 같은 단언을 두어라.

`spawnConsult`는 **그대로 재사용**한다. 새 spawn 경로를 만들지 마라.

### 2. UI — 재실행 버튼

- **완료된 run의 리포트 화면**(`ReportHeader`)에 "재실행". 이것이 주 진입점이다("결과는 받았지만 다시 돌려보고 싶다").
- **이력 목록**(`RunList`)의 완료된 run에도 노출할지는 `docs/UI_GUIDE.md`의 규격을 따르라. 목록이 버튼으로 붐비지 않게 주의하라(이미 체크박스·비교·삭제·이어서 실행이 있다).
- 클릭 → `POST` → 응답의 새 `runId`로 **`/runs/{newId}`로 이동**한다. 사용자는 새 run의 진행 화면을 보게 된다.
- 요청 in-flight 동안 버튼 비활성화(더블클릭으로 run이 두 개 생기지 않게 — 실제 API 쿼터를 두 배 쓴다).
- **resume 버튼과 시각적으로 구분**하라. 문구는 "재실행", 부제/툴팁으로 "자료조사부터 다시".

### 3. UI — 계보 표시

`RunDetail.rerunOf`(step 5에서 데이터 계층에 추가됨)가 있는 run의 상세 상단에:

- "이 실행은 **{원본 아이디어}**의 재실행입니다" + 원본 run 링크(`/runs/{rerunOf}`).
- **둘 다 `completed`이면 비교 바로가기**: `/compare?a={rerunOf}&b={runId}`. 같은 입력으로 두 번 돌렸을 때 결론이 얼마나 흔들리는지가 이 도구의 신뢰도이므로, 이 링크는 부산물이 아니라 기능이다.
- 원본이 **삭제됐을 수 있다**(`rerun_of`는 `ON DELETE SET NULL`이므로 그 경우 `rerunOf`가 없다). 원본이 없는데 링크를 그리는 경로가 생기지 않게 하라 — `getRunDetail`이 원본의 아이디어를 함께 실어 보내야 한다면 step 5의 `RunDetail`을 확장하라(원본 조회가 필요하면 `withRunStore` 안에서 한 번에 처리한다).

### 4. 테스트

**API** (`web/src/test/server/api-routes.test.ts`):
- 완료된 run 재실행 → 201 + 새 runId + **`spawnConsult`가 새 runId로 호출됨**(`vi.mock`으로 실제 spawn을 막는다).
- **새 run이 spawn 시점에 이미 DB에 있다**(순서 검증 — 기존 `POST /api/runs` 테스트와 같은 방식).
- 새 run에 원본의 `questions`·`answers`가 있고, `context`·`report`는 **없다**.
- `running`/`waiting` 원본 → 409 + **새 run이 생기지 않았다**.
- 없는 run → 404.

**UI**:
- 완료된 리포트 화면에 "재실행" 버튼이 있고, 클릭하면 새 run 상세로 이동한다.
- `rerunOf`가 있는 run 상세에 원본 링크가 보인다. 둘 다 완료면 비교 링크가 보인다.
- 원본이 삭제된(=`rerunOf` 없는) run에서는 계보 안내가 뜨지 않는다.

**검증 방식**: 클래스명 단언 금지. `getByRole("button"/"link", { name })`과 시맨틱 `data-*` 훅을 쓴다.

**실제 파이프라인 동작**(포크 run이 인터뷰를 건너뛰고 context-hunter부터 도는 것)은 **step 3의 orchestrator 테스트가 이미 검증한다.** 여기서 중복 검증하지 마라 — API 계층은 "올바른 run을 만들고 spawn했는가"까지가 책임이다.

## Acceptance Criteria

```bash
npm run build   # 통과
npm test        # 루트 + web 전부 통과
npm run lint    # 통과
```

수동 확인 (`GEMINI_API_KEY`가 필요하다. 없으면 이 항목은 건너뛰되 **`blocked`로 만들지 마라** — 자동 테스트로 충분하다):
```bash
npm run web
```
1. 완료된 run 열기 → **재실행** → 새 run 상세로 이동한다.
2. 진행 화면에서 **인터뷰 질문을 다시 묻지 않고** `context-hunter`부터 진행된다. (`waiting` 상태로 멈추면 실패다.)
3. 새 run이 완료되면 상단에 원본 링크와 **비교 바로가기**가 보이고, 눌러서 `/compare`가 정상 동작한다.
4. 원본 run의 리포트가 **그대로 남아 있다**(포크이므로 덮어쓰지 않는다).
5. DB 확인:
   ```bash
   sqlite3 data/anvil.db "select run_id, rerun_of from runs where rerun_of is not null;"
   ```

## 검증 절차

1. 위 AC와 수동 확인을 실행한다.
2. 아키텍처 체크리스트:
   - `createRerun` → `spawnConsult` 순서를 지켰는가? (ADR-007)
   - `spawnConsult`를 재사용했는가? 새 spawn 경로를 만들지 않았는가?
   - resume 버튼과 rerun 버튼이 시각적으로 구분되는가? (UI_GUIDE)
   - `HomePage.tsx`(죽은 파일)를 고치지 않았는가?
   - orchestrator·`RunStore`를 수정하지 않았는가?
   - CLAUDE.md CRITICAL: web이 외부 API를 직접 호출하지 않는가?
3. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 7을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`src/pipeline/orchestrator.ts`를 수정하지 마라.** 이유: 포크된 run은 특별한 취급 없이 그냥 돌아가는 것이 설계의 핵심이다(`createRerun`의 seed가 그것을 보장한다). orchestrator를 고쳐야 한다면 `createRerun`의 seed가 잘못된 것이므로, step 2의 구현을 먼저 읽어라.
- **`src/lib/runStore.ts`를 수정하지 마라.** 이유: `createRerun`은 step 2에서 이미 만들어졌고 테스트로 못박혀 있다.
- **재실행이 원본을 덮어쓰게 하지 마라.** 이유: ADR-015. 원본 보존이 포크를 선택한 이유 자체다.
- **재실행 버튼을 resume("이어서 실행") 버튼과 합치지 마라.** 이유: 동작이 정반대다. resume은 완료 step을 건너뛰고, rerun은 전부 다시 돈다. 사용자가 오해하면 API 쿼터를 예상치 못하게 소모한다.
- **새 spawn 경로를 만들지 마라.** `spawnConsult`를 재사용하라. 이유: ADR-007의 detached spawn 규약(cwd, stdio ignore, unref)이 한 곳에 있어야 한다.
- **`web/src/components/home/HomePage.tsx`를 수정하지 마라.** 이유: 죽은 파일이다.
- **테스트에서 클래스명을 단언하지 마라.**
- 기존 테스트를 깨뜨리지 마라.
