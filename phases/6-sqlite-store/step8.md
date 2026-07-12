# Step 8: final-verify

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-014**, **ADR-015** (이번 phase가 추가한 것). ADR-002가 폐기 표시돼 있는지 확인하라.
- `/docs/ARCHITECTURE.md` — DB 스키마, 데이터 흐름, 상태 관리
- `/docs/PRD.md` — Phase 6 섹션, run 상태 파생 규칙
- `/docs/UI_GUIDE.md` — 삭제·재실행·계보 규격
- `/CLAUDE.md` — CRITICAL 규칙
- 이번 phase가 만들거나 고친 코드 전부: `src/lib/db.ts`, `src/lib/runStore.ts`, `src/pipeline/orchestrator.ts`, `src/cli/index.ts`, `scripts/migrateRuns.ts`, `web/src/lib/server/runs.ts`, `web/src/app/api/runs/**`, `web/src/components/home/RunList.tsx`, `web/src/components/progress/RunDetailClient.tsx`, `web/src/components/report/ReportHeader.tsx`

## 배경

phase 6이 저장소를 파일에서 SQLite로 바꾸고 삭제·재실행을 붙였다. 이 step은 **새 기능을 만들지 않는다.** 전체가 정합한지 검증하고, 파일 시대의 잔재를 정리한다.

## 작업

### 1. 전체 AC 통과 확인

```bash
npm run build && npm test && npm run lint
```

### 2. 파일 시대 잔재 grep — 남아 있으면 제거하거나 정정하라

```bash
# 코드에 runs/ 디렉토리 경로 조립이 남아 있는가
grep -rn "runs/" src/ web/src/ --include=*.ts --include=*.tsx | grep -v test | grep -v "api/runs"

# report.md 파일 경로를 만드는 코드가 남아 있는가
grep -rn "report\.md" src/ web/src/ --include=*.ts --include=*.tsx

# state.json / context.json 등 파일명 상수
grep -rn "state\.json\|context\.json\|criticism\.json\|research\.json\|answers\.json" src/ web/src/ docs/

# 파일 시대의 상수·헬퍼
grep -rn "STEP_OUTPUT_FILES\|atomicWriteFileSync\|ANVIL_RUNS_DIR\|getRunsDir" src/ web/src/
```

**허용되는 잔존**:
- `scripts/migrateRuns.ts`와 그 테스트 — 파일에서 읽는 것이 그 일이다.
- `web/src/test/fixtures/` — 픽스처 JSON을 읽어 DB에 seed한다.
- `docs/ADR.md`의 ADR-002 등 **과거 기록** — ADR은 append-only다. 지우지 마라.
- `.gitignore`의 `/runs/`.

**남아 있으면 안 되는 것**: 프로덕션 코드가 `runs/{id}/*.json` 경로를 조립하거나, `report.md` 파일을 읽고 쓰거나, `ANVIL_RUNS_DIR`을 참조하는 것.

### 3. 문서–코드 정합성

- `docs/ARCHITECTURE.md`의 DB 스키마가 **`src/lib/db.ts`의 실제 DDL과 일치**하는가? (컬럼 이름·제약까지)
- `docs/ADR.md` ADR-014의 스키마와 ARCHITECTURE.md의 스키마가 서로 일치하는가?
- `docs/PRD.md`의 "run 상태 파생 규칙"이 `deriveRunStatus`의 실제 구현과 일치하는가? (`completed` → `error` → `waiting` → `running`/`stalled`, 15분)
- `docs/UI_GUIDE.md`가 정한 삭제·재실행 규격을 step 6·7이 실제로 따랐는가? 어긋나면 **코드를 문서에 맞추는 것이 원칙**이되, 구현 과정에서 규격이 실무적으로 틀렸다고 판명됐다면 문서를 고치고 그 이유를 `summary`에 적어라.
- `CLAUDE.md`의 "명령어" 절에 `npm run migrate:runs`가 빠져 있으면 추가하라. "환경변수" 절에 `ANVIL_DB_PATH`(선택, 기본 `data/anvil.db`)를 추가하라.

### 4. CLAUDE.md CRITICAL 규칙 전수 확인

- 외부 API(Gemini/YouTube/HN/네이버) 호출이 `src/services/`에만 있는가? `agents/`·`pipeline/`·`cli/`·`research/`·`web/`에서 직접 fetch하지 않는가?
- 모든 에이전트 산출물이 zod 검증을 통과해야 다음 step으로 가는가? (저장소가 바뀌어도 `executeStep`의 검증이 살아 있는가)
- **API 키 없이 `npm test`가 통과하는가?** 실제로 확인하라:
  ```bash
  env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
  ```
- 파이프라인 상태의 단일 진실 공급원이 하나인가? (DB의 `runs`·`steps`. 파일과 DB가 공존하지 않는가)

### 5. 죽은 코드 판단 — `web/src/components/home/HomePage.tsx`

이 파일은 이번 phase 이전부터 죽어 있었다(374줄, 어디서도 import되지 않음). `web/src/lib/client/format.ts`·`client/types.ts`도 이 파일과 테스트 픽스처만 참조한다.

**삭제할지 말지 판단하고, 판단 근거를 `summary`에 적어라.** 삭제한다면 함께 죽는 파일(`lib/client/*`)과 그것을 참조하는 테스트도 정리해야 한다. 이번 phase가 삭제·재실행 UI를 `RunList`에만 붙였으므로 `HomePage.tsx`는 이제 **기능적으로도 뒤처진 화면**이다 — 언젠가 누군가 이 파일을 "옛날 홈 화면"으로 착각하고 고칠 위험이 있다.

**애매하면 지우지 마라.** 이번 phase의 목표가 아니다. 대신 파일 상단에 `// 사용되지 않는 파일 — page.tsx는 HomeClient를 쓴다` 주석을 다는 선에서 그쳐도 된다.

`web/src/app/layout.js`(create-next-app 잔재, `layout.tsx`와 공존)도 같은 기준으로 판단하라.

### 6. 전체 시나리오 수동 검증

`GEMINI_API_KEY`가 있으면 끝에서 끝까지 한 번 돌려라. **없으면 이 항목을 건너뛰고 `blocked`로 만들지 마라** — 그 사실을 `summary`에 적어라.

```bash
npm run web
```

1. 새 아이디어로 컨설팅 실행 → 인터뷰 질문 → 답변 제출 → 진행 → 리포트 완료.
2. 그 run을 **재실행** → 새 run이 생기고 **질문을 다시 묻지 않고** 자료조사부터 진행 → 완료.
3. 새 run 상세에서 원본 링크와 **비교 바로가기** → `/compare`가 두 run을 나란히 보여준다.
4. 원본 run **삭제** → 목록에서 사라진다. 재실행 run은 **살아남고** 계보 안내만 사라진다(`ON DELETE SET NULL`).
5. 완료된 run에서 **report.md 다운로드** → DB에서 내려온 마크다운이 정상이다.
6. `npm run consult -- "CLI 아이디어"` → stdout에 runId만 나오고, 웹 목록에 그 run이 보인다(인터뷰 없이).

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 0
npm test        # 루트 + web 전부 통과
npm run lint    # 통과
env -u GEMINI_API_KEY npm test   # API 키 없이도 통과 (CLAUDE.md CRITICAL)
```

## 검증 절차

1. 위 AC를 실행한다.
2. 2·3·4절의 grep과 정합성 점검을 **전부** 수행하고, 발견한 것과 조치를 `summary`에 적어라. "확인했다"만 적지 말고 **무엇을 찾았고 무엇을 고쳤는지** 적어라.
3. 결과에 따라 `phases/6-sqlite-store/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "..."`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **새 기능을 만들지 마라.** 이유: 이 step은 검증과 정리다. 구현 중 아쉬웠던 것을 여기서 슬쩍 추가하면 그것은 테스트도 리뷰도 받지 않은 코드가 된다.
- **`docs/ADR.md`의 과거 ADR을 삭제하지 마라.** 이유: append-only 기록이다. ADR-002는 폐기 표시만 하고 본문은 남긴다.
- **`runs/` 디렉토리를 삭제하지 마라.** 이유: 사용자가 DB를 확인한 뒤 직접 지운다. 되돌릴 수 없다.
- **테스트를 통과시키기 위해 단언을 약화하지 마라.** 이유: 실패하는 테스트는 신호다. 특히 "API 키 없이 통과" 조건을 우회하려고 테스트를 skip 처리하지 마라.
- **애매한 죽은 코드를 확신 없이 지우지 마라.** 이유: 삭제는 되돌리기 쉽지만, 잘못 지운 것을 아무도 눈치채지 못하는 것이 더 나쁘다. 판단 근거를 남겨라.
