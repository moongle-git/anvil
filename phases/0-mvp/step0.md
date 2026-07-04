# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/CLAUDE.md`

## 작업

TypeScript Node 프로젝트를 초기화한다. 이 리포에는 아직 package.json이 없다.

1. `npm init -y` 후 package.json을 정리한다:
   - `"name": "anvil"`, `"private": true`, `"type": "module"`
   - scripts:
     - `"build": "tsc"`
     - `"test": "vitest run"`
     - `"lint": "eslint src"`
     - `"consult": "tsx src/cli/index.ts"`
2. devDependencies 설치: `typescript`, `tsx`, `vitest`, `eslint`, `typescript-eslint`, `@types/node`
3. dependencies 설치: `@google/genai`, `zod`, `dotenv`
4. `tsconfig.json` 생성: `"strict": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2022"`, `"outDir": "dist"`, `"rootDir": "src"`. `include`는 `["src"]`.
5. ESLint flat config(`eslint.config.js`)를 typescript-eslint recommended 프리셋으로 생성한다.
6. 디렉토리 스캐폴드 생성: `src/cli/`, `src/pipeline/`, `src/agents/`, `src/services/`, `src/lib/`, `src/types/`. 각 디렉토리가 빈 채로 커밋되지 않도록 `src/cli/index.ts`에 임시 엔트리(`console.log("anvil")` 수준)를 만들고, 나머지는 이후 step에서 채운다. 빈 디렉토리에는 파일을 만들지 마라.
7. `.gitignore`에 다음을 추가한다(기존 내용 유지): `node_modules/`, `dist/`, `.env`, `runs/`
8. `.env.example` 파일을 생성한다:
   ```
   GEMINI_API_KEY=
   YOUTUBE_API_KEY=
   ```
9. 스모크 테스트 1개를 작성한다 (`src/lib/smoke.test.ts` — vitest가 동작하는지 확인하는 trivial 테스트).

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 스모크 테스트 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택(ADR-005: TypeScript strict + vitest + zod)을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 API 키를 요구하거나 .env 파일을 생성하지 마라. 이유: 이 step은 프로젝트 골격만 만들며, 테스트는 전부 mock 기반으로 설계된다. `.env.example`만 만든다.
- Next.js, Express 등 웹 프레임워크를 설치하지 마라. 이유: MVP는 CLI 전용이다 (PRD의 MVP 제외 사항).
- 비즈니스 로직(에이전트, 파이프라인)을 작성하지 마라. 이유: 이후 step의 scope다.
- 기존 테스트를 깨뜨리지 마라 (`scripts/test_execute.py`는 건드리지 않는다)
