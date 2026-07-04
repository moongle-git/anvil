# Architecture Decision Records

## 철학
MVP 속도 최우선. 외부 의존성 최소화. 작동하는 최소 구현을 선택하되, 하네스 엔지니어링 패턴(순차 step + 파일 기반 상태 + 자가 교정)을 런타임 설계의 기준으로 삼는다.

---

### ADR-001: 실행 엔진으로 Gemini API 직접 오케스트레이션 채택
**결정**: 에이전트 실행을 `@google/genai` SDK(Gemini API)로 직접 오케스트레이션한다. claude CLI 헤드리스 방식은 채택하지 않는다.
**이유**: 독립 배포 가능한 서비스로 만들기 위해 특정 CLI 도구 설치에 의존하지 않는다. Gemini는 Google Search grounding을 내장해 별도 검색 API 없이 실시간 웹검색이 가능하다.
**트레이드오프**: GEMINI_API_KEY가 필요하고, 재시도·검증 로직을 직접 구현해야 한다.

### ADR-002: 저장은 파일 기반, DB 없음
**결정**: 실행 상태와 산출물을 `runs/{run-id}/` 디렉토리의 JSON + Markdown 파일로 저장한다. SQLite/PostgreSQL은 도입하지 않는다.
**이유**: execute.py의 phases/ 상태 관리와 동일한 패턴이라 프로젝트 전체의 일관성이 유지되고, 스키마 관리·마이그레이션 부담이 없다. 산출물이 사람이 직접 읽는 파일(report.md)이므로 파일 시스템이 자연스러운 저장소다.
**트레이드오프**: 이력 조회·검색이 불편하다. 웹 UI phase에서 필요해지면 그때 DB를 도입한다.

### ADR-003: 웹검색은 Gemini grounding, YouTube는 Data API 직접 연동
**결정**: 일반 웹검색은 Gemini의 Google Search grounding 기능을 사용하고, YouTube는 YouTube Data API(v3)로 영상 검색과 댓글(commentThreads) 원문을 직접 수집한다.
**이유**: grounding은 추가 키·비용 없이 검색을 제공한다. 그러나 grounding만으로는 YouTube 댓글 원문(실제 유저 목소리 인용)을 확보할 수 없어, 리포트 품질의 핵심인 "실제 페인포인트 인용"을 위해 Data API를 병행한다.
**트레이드오프**: YOUTUBE_API_KEY 발급과 quota 관리(검색·댓글 수집 상위 N개 제한)가 필요하다. 자막(Transcript) 수집은 MVP에서 제외한다.

### ADR-004: 파이프라인 런타임에 하네스 패턴 채택
**결정**: LangGraph 등 오케스트레이션 프레임워크 대신, scripts/execute.py와 동형인 자체 하네스 패턴(순차 step 실행 + state.json persist + 컨텍스트 누적 주입 + 최대 3회 자가 교정 재시도 + resume)을 구현한다.
**이유**: 에이전트 3개의 선형 파이프라인에 그래프 프레임워크는 과잉이다. 프로젝트에 이미 검증된 동일 패턴(execute.py)이 있어 설계·디버깅 비용이 낮다.
**트레이드오프**: 분기·병렬 실행이 필요해지면 직접 확장해야 한다.

### ADR-005: TypeScript (Node) 단일 스택
**결정**: TypeScript strict mode + Node로 구현한다. 테스트는 vitest, 스키마 검증은 zod를 사용한다.
**이유**: 다음 phase의 웹 UI(Next.js)와 스택을 통일해 타입·스키마를 공유할 수 있다.
**트레이드오프**: execute.py(Python)와 언어가 갈리지만, 하네스 스크립트와 제품 코드는 역할이 분리되어 있어 문제가 없다.
