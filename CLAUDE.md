# 프로젝트: anvil — AI 서비스 기획 컨설팅 에이전트

## 기술 스택
- Node.js + TypeScript (strict mode)
- Gemini API (`@google/genai`) — 에이전트 실행 엔진, Google Search grounding
- YouTube Data API v3 — 영상 검색·댓글 수집
- zod — 에이전트 산출물 스키마 검증
- vitest — 테스트

## 아키텍처 규칙
- CRITICAL: 외부 API(Gemini, YouTube) 호출은 반드시 `src/services/`에서만 처리할 것. agents/·pipeline/·cli/에서 직접 fetch나 SDK를 호출하지 말 것
- CRITICAL: 모든 에이전트 산출물은 zod 스키마 검증을 통과해야 다음 step으로 전달할 것. 검증 실패는 에러 피드백과 함께 재시도(최대 3회)
- CRITICAL: 테스트에서 실제 외부 API를 호출하지 말 것. Gemini/YouTube는 반드시 mock으로 대체 (API 키 없이 `npm test`가 통과해야 함)
- 파이프라인 상태는 `runs/{run-id}/state.json`이 단일 진실 공급원. resume 시 completed step은 건너뛴다
- 디렉토리 구조·데이터 흐름은 docs/ARCHITECTURE.md를, 기술 결정은 docs/ADR.md를 따를 것

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:, chore:)

## 명령어
npm run build      # tsc 컴파일 (에러 0이어야 함)
npm run test       # vitest 실행
npm run lint       # ESLint
npm run consult -- "아이디어 텍스트"   # 컨설팅 파이프라인 실행 (CLI)

## 환경변수 (.env — git 미추적)
GEMINI_API_KEY     # Gemini API 키
YOUTUBE_API_KEY    # YouTube Data API v3 키
