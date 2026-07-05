# Step 4: home-run-list

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/PRD.md` ("Phase 1-web-ui" → "홈 (/)" 섹션 — 이 step의 스펙이다)
- `/docs/UI_GUIDE.md` (레이아웃·타이포·빈 상태 규칙)
- `/docs/ARCHITECTURE.md` ("웹 UI 데이터 흐름")
- `/CLAUDE.md`
- `web/src/app/api/` 및 `web/src/lib/server/` (step 2 산출물 — API 계약)
- `web/src/components/ui/` (step 3 산출물 — 공통 컴포넌트)
- `web/src/test/fixtures/` (step 2 산출물 — 테스트 fixture)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

홈 화면(`web/src/app/page.tsx`)을 TDD로 작성한다. 구성 요소는 `web/src/components/home/` 하위에 둔다.

1. **아이디어 입력 폼** (상단)
   - TextAreaField + "컨설팅 시작" Primary 버튼. 제출 시 `POST /api/runs` → 응답 runId로 `/runs/{runId}` 이동.
   - 공백 입력이면 제출 버튼 비활성. 제출 중 이중 제출 방지(버튼 disabled).
   - API 실패 시 폼 아래 에러 메시지 표시(입력 유지).

2. **run 이력 목록** (하단)
   - `GET /api/runs`로 조회. 각 행: 아이디어 제목(→ `/runs/{id}` 링크), 실행 일시(로컬 포맷), RunStatusBadge.
   - 검색 input(아이디어 키워드) + 상태 필터(전체/완료/진행중/중단됨/실패) — API의 `q`/`status` 파라미터를 사용하라.
   - `error`/`stalled` run 행에는 "이어서 실행" Secondary 버튼 → `POST /api/runs/{id}/resume` → 성공 시 `/runs/{id}` 이동.
   - **비교 선택**: `completed` run에만 체크박스. 정확히 2개 선택 시 "비교하기" 버튼 활성화 → `/compare?a={id1}&b={id2}` 이동. 2개 초과 선택은 불가(재량: 3번째 클릭 무시 또는 가장 오래된 선택 해제).

3. **빈 상태**: run이 하나도 없으면 EmptyState — 서비스 소개 한 줄 + 예시 아이디어 2~3개 버튼(클릭 시 폼에 채움).

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. 페이지의 데이터 접근은 **반드시 API route를 통해서만** 하라. 서버 컴포넌트에서 RunStore를 직접 호출하지 마라. 이유: 데이터 접근 경로를 API로 단일화해야 진행 뷰 폴링(step 5)과 정합하고 테스트가 단순해진다.
2. 목록은 클라이언트 컴포넌트로 구현하라(검색·필터·선택 인터랙션 때문). 검색 입력은 과도한 요청을 피하도록 디바운스(300ms 내외)하라.

테스트(@testing-library/react, fetch mock): 목록 렌더링, 상태 필터 요청 파라미터, 빈 상태 렌더링, 폼 제출 → POST 후 이동, 비교 버튼 활성화 조건(2개 선택).

## Acceptance Criteria

```bash
npm run build
npm test        # 홈 화면 테스트 통과 (목록/필터/빈 상태/폼 제출/비교 선택)
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - PRD "홈 (/)" 스펙의 요소가 모두 있는가?
   - step 3 공통 컴포넌트를 재사용했는가? (동일 역할 컴포넌트를 새로 만들지 않았는가)
   - UI_GUIDE 안티패턴이 없는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `/runs/[id]`·`/compare` 페이지를 구현하지 마라. 이유: step 5~8의 scope다. 링크만 걸어라.
- SWR·react-query 등 데이터 fetching 라이브러리를 설치하지 마라. 이유: 의존성 최소화 철학 — 이 규모에는 fetch + 상태 훅이면 충분하다.
- run 삭제 기능을 만들지 마라. 이유: PRD Phase 1-web-ui 제외 사항이다.
- 테스트에서 실제 API route·실제 runs/를 호출하지 마라. 이유: fetch mock과 fixture만 사용한다.
- 기존 테스트를 깨뜨리지 마라
