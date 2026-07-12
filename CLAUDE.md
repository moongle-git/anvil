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
- 모든 Gemini 호출의 토큰 사용량은 **재시도와 실패한 시도까지 포함해** `usage` 테이블에 기록한다 — 검증에 실패한 응답도 과금된다. `services/`는 DB를 모르므로 `onUsage` 콜백으로 흘려보내고, DB 기록은 `cli/`가 배선한다 (ADR-016)
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

## 환경변수 (.env — git 미추적)
GEMINI_API_KEY       # Gemini API 키
YOUTUBE_API_KEY      # YouTube Data API v3 키
NAVER_CLIENT_ID      # 네이버 개발자센터 검색 API Client ID
NAVER_CLIENT_SECRET  # 네이버 개발자센터 검색 API Client Secret
ANVIL_DB_PATH        # (선택) SQLite DB 경로. 기본값 data/anvil.db

`GEMINI_API_KEY`만 필수다. 나머지 키는 없으면 해당 자료조사 소스를 건너뛴다 (Hacker News는 키가 필요 없다).
