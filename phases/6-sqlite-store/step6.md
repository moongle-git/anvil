# Step 6: delete-run

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-015**(삭제는 CASCADE, `running` run은 삭제 불가, `saveRun` UPDATE-only가 좀비 프로세스를 막는다), **ADR-014**
- `/docs/PRD.md` — Phase 6 섹션의 삭제 요구사항
- **`/docs/UI_GUIDE.md`** — 삭제 버튼(파괴적 액션)과 확인 단계의 규격. **step 0이 정한 것을 따르라. 새로 지어내지 마라.**
- `/CLAUDE.md` — CRITICAL 규칙
- **`/web/AGENTS.md`** — Next.js 16이다. route handler 규약(`params`가 `Promise`)을 확인하라.
- **`src/lib/runStore.ts`** — `deleteRun(runId): boolean`, `deriveRunStatus`
- **`web/src/lib/server/runs.ts`** — `withRunStore`, `getRunDetail`
- **`web/src/app/api/runs/[id]/resume/route.ts`** — 409를 내는 기존 패턴. 삭제도 같은 모양이어야 한다.
- **`web/src/components/home/RunList.tsx`** — 살아 있는 이력 목록. "이어서 실행" 버튼이 여기 있다.
- **`web/src/components/home/HomeClient.tsx`** — `RunList`의 부모. 목록 상태를 소유한다.
- **`web/src/components/progress/RunDetailClient.tsx`** — run 상세
- `web/src/components/ui/` — `Button`, `Card`, `Badge` 등 디자인 시스템 (barrel: `index.ts`)
- `web/src/test/components/home.test.tsx`, `web/src/test/server/api-routes.test.ts`

## 배경

run 삭제 기능이 코드베이스 전체에 없다. `RunStore.deleteRun`은 step 2에서 만들어졌으므로, 이 step은 **API와 UI만** 붙인다.

> **⚠️ 함정 — `web/src/components/home/HomePage.tsx`는 죽은 파일이다.**
> 같은 기능(검색/필터/목록/이어서 실행/비교)을 테이블 UI로 구현한 374줄짜리 완성형 컴포넌트지만 **어디서도 import되지 않는다**. `web/src/app/page.tsx`는 `HomeClient`를 쓴다. **여기를 고치면 화면에 아무 변화가 없다.** 살아 있는 경로는 `page.tsx` → `HomeClient` → `RunList`다. 이 step에서 `HomePage.tsx`를 고치지도, 지우지도 마라(정리는 step 8에서 판단한다).

## 작업

### 1. `DELETE /api/runs/[id]`

기존 `web/src/app/api/runs/[id]/route.ts`에 `DELETE` 핸들러를 **추가**한다(`GET`은 그대로).

| 상황 | 응답 |
|---|---|
| run이 없음 | `404` |
| `status === "running"` | **`409`** + 사유 메시지 |
| 그 외(`completed`/`error`/`waiting`/`stalled`) | `deleteRun` 후 **`204`** |

**왜 `running`만 막는가**: 살아 있는 detached CLI 프로세스가 계속 쓰기 때문이다. `waiting`은 프로세스가 정상 종료하고 답변을 기다리는 상태이므로 살아 있는 writer가 없다 — 삭제할 수 있다. `stalled`는 "프로세스가 죽었다고 **추정**"하는 상태라 좀비의 여지가 남지만, `saveRun`이 UPDATE-only(ADR-015)라 좀비의 쓰기는 깨끗하게 실패한다. 그래서 삭제를 허용한다.

409 응답 형태는 `resume/route.ts`의 기존 패턴을 그대로 따르라(같은 종류의 거절이 두 가지 모양을 갖게 하지 마라).

### 2. UI — 목록 (`RunList.tsx` + `HomeClient.tsx`)

- 각 run 항목에 삭제 버튼. **확인 단계 필수** — 되돌릴 수 없다. 형태(인라인 확인 vs 모달)는 **`docs/UI_GUIDE.md`가 step 0에서 정한 것**을 따르라.
- 삭제 성공 → 목록에서 제거(재조회 또는 낙관적 갱신 — `HomeClient`가 목록 상태를 소유하므로 거기서 처리하라).
- **409(실행 중)** → 사용자에게 이유를 보여준다. 조용히 실패하지 마라. 기존 `ErrorState`/에러 표시 패턴을 재사용하라.
- 삭제 대기 중(요청 in-flight) 버튼은 비활성화한다 — 더블클릭으로 두 번 삭제되지 않게.
- **비교 체크박스와의 상호작용**: 체크된 run이 삭제되면 선택 상태에서도 빠져야 한다(그러지 않으면 존재하지 않는 run으로 `/compare` 이동이 가능해진다).

### 3. UI — 상세 (`RunDetailClient.tsx`)

- 삭제 → 성공 시 홈(`/`)으로 이동(`router.push`).
- 실행 중인 run(`running`)에서는 삭제 버튼을 **애초에 노출하지 마라**(409를 UI에서 미리 막는다). 단 API의 409는 그대로 유지한다 — UI는 방어의 2선이지 1선이 아니다.

### 4. 테스트

**API** (`web/src/test/server/api-routes.test.ts`): 삭제 성공(204 + 실제로 DB에서 사라짐), 없는 run(404), `running` run(409 + **DB에 그대로 남아 있음**). `running` 픽스처는 `updated_at`이 최근인 미완료 run이다(step 5의 `touchUpdatedAt` 헬퍼를 반대로 쓰면 된다).

**UI** (`web/src/test/components/home.test.tsx` 등):
- 삭제 버튼 클릭 → 확인 → `DELETE` 요청이 나가고 목록에서 사라진다.
- 확인을 취소하면 요청이 나가지 않는다.
- 409 응답 시 에러 메시지가 보인다.

**검증 방식** — 이 프로젝트의 규율이다: **클래스명을 단언하지 마라.** 접근성 역할(`getByRole("button", { name: ... })`)과 시맨틱 `data-*` 훅으로 검증하라. 기존 테스트(`data-coverage-source`, `data-citation-list` 등)의 패턴을 따르라.

## Acceptance Criteria

```bash
npm run build   # 통과
npm test        # 루트 + web 전부 통과
npm run lint    # 통과
```

수동 확인:
```bash
npm run web
```
1. 목록에서 완료된 run 삭제 → 확인 → 사라진다. **새로고침해도 없다**(DB에서 실제로 지워졌다).
2. run 상세에서 삭제 → 홈으로 이동한다.
3. 실행 중인 run을 삭제 시도 → 409로 막히고 이유가 보인다. (실행 중인 run이 없으면 `npm run consult -- "아무 아이디어"`를 백그라운드로 띄우고 그 사이에 시도하라.)
4. 삭제한 run의 `steps`·`artifacts` 행이 DB에 남아 있지 않다:
   ```bash
   sqlite3 data/anvil.db "select count(*) from steps where run_id='<지운 runId>';"       # 0
   sqlite3 data/anvil.db "select count(*) from artifacts where run_id='<지운 runId>';"   # 0
   ```

## 검증 절차

1. 위 AC와 수동 확인을 실행한다.
2. 아키텍처 체크리스트:
   - `docs/UI_GUIDE.md`가 정한 파괴적 액션 규격을 따랐는가? (색·확인 단계·문구)
   - `HomePage.tsx`(죽은 파일)를 고치지 않았는가? 살아 있는 `RunList.tsx`를 고쳤는가?
   - 409 응답 형태가 `resume/route.ts`와 일관적인가?
   - 테스트가 클래스명이 아니라 role·`data-*`로 검증하는가?
   - CLAUDE.md CRITICAL: web이 외부 API를 직접 호출하지 않는가?
3. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`web/src/components/home/HomePage.tsx`를 수정하지 마라.** 이유: 죽은 파일이다. 고쳐도 화면에 반영되지 않아 "동작하지 않는다"고 오판하게 된다. 살아 있는 것은 `HomeClient` → `RunList`다.
- **확인 단계 없이 바로 삭제하지 마라.** 이유: 되돌릴 수 없다. 실제 컨설팅 결과가 사라진다.
- **`running` run의 삭제를 허용하지 마라.** 이유: 살아 있는 CLI 프로세스가 계속 쓴다.
- **`RunStore`·`src/`를 수정하지 마라.** 이유: `deleteRun`은 step 2에서 이미 만들어졌다. 이 step은 API와 UI만 붙인다. `src/`를 고쳐야 한다면 step 2에 버그가 있는 것이므로, 고치기 전에 그것이 정말 버그인지 확인하라.
- **재실행(rerun) 기능을 여기서 만들지 마라.** 이유: step 7의 scope다.
- **테스트에서 클래스명을 단언하지 마라.** 이유: 브리틀하다. 이 프로젝트는 role·`data-*` 훅으로 검증한다.
- 기존 테스트를 깨뜨리지 마라.
