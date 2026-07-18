# 프로젝트: anvil — AI 서비스 기획 컨설팅 에이전트

## 기술 스택
- Node.js + TypeScript (strict mode)
- Gemini API (`@google/genai`) — 에이전트 실행 엔진, Google Search grounding
- YouTube Data API v3 — 영상 검색·댓글 수집
- zod — 에이전트 산출물 스키마 검증
- vitest — 테스트

## 아키텍처 규칙
- CRITICAL: 외부 API(Gemini, YouTube, Hacker News, 네이버) 호출은 반드시 `src/services/`에서만 처리할 것. agents/·pipeline/·cli/·research/에서 직접 fetch나 SDK를 호출하지 말 것 — `research/`는 services/를 주입받아 `CommunityVoice`로 정규화만 한다
- CRITICAL: 모든 에이전트 산출물은 zod 스키마 검증을 통과해야 다음 step으로 전달할 것. 검증 실패는 에러 피드백과 함께 재시도(최대 3회)
- CRITICAL: 테스트에서 실제 외부 API를 호출하지 말 것. Gemini/YouTube는 반드시 mock으로 대체 (API 키 없이 `npm test`가 통과해야 함)
- 파이프라인 상태는 `runs/{run-id}/state.json`이 단일 진실 공급원. resume 시 completed step은 건너뛴다
- CRITICAL: 비판이 `severity: "fatal"`로 판정한 항목은 재설계가 **전부** 해결책을 내야 한다(`solution.remedies[]`) — 스키마 팩토리 `solutionSchemaFor(criticism)`이 강제하고, 실패하면 자가 교정 재시도가 돈다. 판정은 그 해결책을 항목별로 감사한다(`verdict.remedyAudits[]`). **코드는 침묵·참조 무결성·귀속만 잡고, 유효성 판단은 판정이 한다** — "이 해결책이 유효한가"는 주입할 사실이 없다. 점수 하한(floor)을 코드로 강제하지 말 것(ADR-010 위반). 재설계 프롬프트에 점수 규칙을 넣지 말 것 (ADR-017)
- 모든 Gemini 호출의 토큰 사용량은 **재시도와 실패한 시도까지 포함해** `usage` 테이블에 기록한다 — 검증에 실패한 응답도 과금된다. `services/`는 DB를 모르므로 `onUsage` 콜백으로 흘려보내고, DB 기록은 `cli/`가 배선한다 (ADR-016)
- CRITICAL: 배포·서버에서 의존성을 설치할 때 **devDependencies를 빼지 말 것** (`npm ci --include=dev`). `npm run consult`는 `tsx`로 TS 소스를 직접 실행하므로 **devDeps는 CLI 파이프라인의 런타임 의존이기도 하다**. `--omit=dev`(또는 셸에 샌 `NODE_ENV=production`)로 설치하면 웹은 멀쩡히 뜨고 run만 죽는데, `spawnConsult`가 `stdio: "ignore"`라 **에러가 어디에도 남지 않고** run이 영원히 `pending`에 머문다 (ADR-018)
- 배포는 단일 VM 전용이다 — 웹이 파이프라인을 같은 머신에 spawn하고(ADR-007) 상태가 로컬 SQLite 파일이라(ADR-014) 수평 확장이 구조적으로 불가능하다. 접근 통제는 앱이 아니라 리버스 프록시(Caddy basic auth)에 있고 **앱 코드에는 사용자·세션 개념이 없다** (ADR-018). 배포 절차는 docs/DEPLOY.md를 따를 것
- 디렉토리 구조·데이터 흐름은 docs/ARCHITECTURE.md를, 기술 결정은 docs/ADR.md를 따를 것

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:, chore:)

## 명령어
npm run build      # tsc 컴파일 (에러 0이어야 함)
npm run test       # vitest 실행
npm run lint       # ESLint
npm run web        # 웹 UI 개발 서버 실행 (Next.js)
npm run consult -- "아이디어 텍스트"   # 컨설팅 파이프라인 실행 (CLI)
npm run migrate:runs                   # 구 runs/{run-id}/ 파일을 SQLite DB로 이송 (일회성, 멱등 — ADR-014)
./scripts/deploy.sh                    # 재배포 — 서버에서만 실행한다 (cd /opt/anvil && ./scripts/deploy.sh).
                                       #   pull → npm ci --include=dev → build → systemctl restart anvil-web.
                                       #   최초 배포는 이 스크립트가 아니라 docs/DEPLOY.md의 수동 절차다 (ADR-018)

## 환경변수 (.env — git 미추적)
GEMINI_API_KEY       # Gemini API 키
YOUTUBE_API_KEY      # YouTube Data API v3 키
NAVER_CLIENT_ID      # 네이버 개발자센터 검색 API Client ID
NAVER_CLIENT_SECRET  # 네이버 개발자센터 검색 API Client Secret
ANVIL_DB_PATH        # (선택) SQLite DB 경로. 기본값 data/anvil.db
                     #   CLI는 <cwd>/data/anvil.db, 웹은 <cwd>/../data/anvil.db(웹의 cwd는 web/)가 기본값이라
                     #   기본값에 기대면 둘이 다른 DB를 본다. 배포에서는 반드시 절대경로로 명시한다
ANVIL_REPO_ROOT      # (선택) 레포 루트 절대경로. 웹이 CLI를 spawn할 때의 cwd다 (ADR-007).
                     #   기본값은 웹 프로세스 cwd의 상위(<cwd>/..). 배포에서는 /opt/anvil로 명시한다

배포에서는 위 두 경로 변수를 `.env.production`에 **절대경로로 명시한다** (ADR-018). 기본값도 유닛의 cwd에서는 같은 곳으로 풀리지만, 그 정합이 **cwd에 의존한다는 것 자체가 위험**이다 — cwd가 한 칸 어긋나면 웹과 CLI가 조용히 다른 DB를 보게 되고, 증상은 "CLI로 만든 run이 웹 목록에 없다"로만 나타난다 (docs/DEPLOY.md §9).

`GEMINI_API_KEY`만 필수다. 나머지 키는 없으면 해당 자료조사 소스를 건너뛴다 (Hacker News는 키가 필요 없다).
