# Step 9: final-verify

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` ("Phase 1-web-ui" 전체 — 최종 대조 기준)
- `/docs/UI_GUIDE.md`, `/docs/ARCHITECTURE.md`, `/docs/ADR.md` (ADR-006, ADR-007)
- `/CLAUDE.md`
- `web/src/` 전체 (step 0~8 산출물), `web/src/test/fixtures/` (스모크 검증에 사용)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

phase 마감 step이다. 새 기능을 만들지 말고, 화면 간 일관성을 정리하고 전체를 검증하라.

1. **상태 처리 일관성 점검·보완** (모든 화면 공통)
   - 데이터 로딩 중: 일관된 로딩 표시. fetch 실패: 에러 카드 + "다시 시도" 버튼.
   - 존재하지 않는 run(`/runs/{없는id}`): not-found 화면(안내 + 홈 링크).
   - RunDetail에 산출물 일부가 없는 완료 전 run에서 리포트 섹션이 깨지지 않는지(EmptyState 폴백) 확인.

2. **문서·메타 마감**
   - `web/src/app/layout.tsx`: `lang="ko"`, metadata title "anvil", 한 줄 설명.
   - `/CLAUDE.md` 명령어 섹션에 `npm run web` 한 줄 추가 (형식은 기존 항목과 동일하게).

3. **반응형 점검**: 홈/진행/리포트/비교 각 화면이 375px(모바일)과 1280px(데스크톱)에서 가로 스크롤 없이 동작하는지 확인하고, 깨지는 곳을 수정하라. 넓은 요소(경쟁사 테이블, 비교 매트릭스)는 자체 컨테이너에서 overflow-x 스크롤로 처리.

4. **전체 검증 스모크** — fixture로 실제 서버를 띄워 검증한다 (API 키 불필요):

```bash
# fixture run들을 임시 runs 디렉토리로 복사한 뒤:
SMOKE_RUNS=$(mktemp -d)
cp -R web/src/test/fixtures/<완료run> web/src/test/fixtures/<실패run> "$SMOKE_RUNS"/
npm run build
(cd web && ANVIL_RUNS_DIR="$SMOKE_RUNS" npx next start -p 3100 &) && sleep 3
curl -sf http://localhost:3100/ > /dev/null                                  # 홈 200
curl -sf http://localhost:3100/api/runs | grep -q runId                      # 목록 API
curl -sf http://localhost:3100/api/runs/<완료run-id> | grep -q verdict       # 상세 API
curl -sf http://localhost:3100/runs/<완료run-id> > /dev/null                 # 리포트 페이지 200
curl -sf "http://localhost:3100/compare?a=<완료run-id>&b=<완료run-id2>" > /dev/null || true  # 완료 run이 2개면 200 확인
kill %1
```
   - fixture 완료 run이 1개뿐이면 비교 스모크를 위해 fixture를 하나 복제해 runId만 바꿔 사용하라.

## Acceptance Criteria

```bash
npm run build   # 루트 + web 빌드 성공
npm test        # 전체 테스트 통과
npm run lint    # 루트 + web 통과
# + 위 4번 스모크 커맨드 전부 성공 (curl exit 0)
```

## 검증 절차

1. 위 AC 커맨드와 스모크를 실행한다.
2. PRD "Phase 1-web-ui" 섹션을 처음부터 끝까지 읽으며 화면 요소 하나하나를 최종 대조하라. 누락이 있으면 이 step에서 보완한다 (단, 새 기능 추가는 아님).
3. 아키텍처 체크리스트를 확인한다:
   - web에 Gemini/YouTube 직접 호출이 없는가? (`grep -r "@google/genai" web/src` 가 비어야 함)
   - zod 스키마 중복 정의가 없는가?
   - UI_GUIDE 안티패턴(`backdrop-blur`, `purple`, `indigo`, gradient 텍스트)이 없는가? (grep으로 확인)
4. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "phase 최종 검증 결과 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 새 화면·새 기능을 추가하지 마라. 이유: 이 step은 마감·검증 전용이다. PRD 누락 보완만 허용된다.
- 스모크 검증을 위해 실제 파이프라인(`npm run consult`)을 실행하지 마라. 이유: API 키·비용이 필요하다. fixture 데이터로 충분하다.
- 스모크용 임시 디렉토리·백그라운드 서버를 정리하지 않은 채 끝내지 마라. 이유: 로컬 환경을 더럽히면 안 된다.
- 루트 `runs/`의 실제 run 데이터를 수정·삭제하지 마라. 이유: 사용자의 실행 이력이다.
- 기존 테스트를 깨뜨리지 마라
