# Step 0: workspace-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ARCHITECTURE.md` (특히 "웹 UI 데이터 흐름" 섹션)
- `/docs/ADR.md` (ADR-005, ADR-006)
- `/docs/PRD.md` ("Phase 1-web-ui" 섹션)
- `/CLAUDE.md`
- `package.json`, `tsconfig.json`, `eslint.config.*` (루트 기존 설정)

이전 phase(0-mvp)에서 만들어진 루트 프로젝트 구성을 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

npm workspaces를 도입하고 `web/`에 Next.js 앱을 스캐폴드한다. 이 step은 **설정만** 다룬다 — 화면·API 구현은 이후 step의 scope다.

1. **npm workspaces 전환**
   - 루트 `package.json`에 `"workspaces": ["web"]` 추가.
   - 루트 스크립트가 web까지 포함하도록 체이닝한다 (CLAUDE.md의 명령어 의미를 유지):
     - `build`: 기존 tsc 빌드 → 성공 시 `npm run build -w web`
     - `test`: 기존 vitest → 성공 시 `npm run test -w web`
     - `lint`: 기존 eslint → 성공 시 `npm run lint -w web`
     - `web`: `npm run dev -w web` (dev 서버 실행)

2. **web/ Next.js 앱 생성**
   - Next.js 최신 안정 버전, App Router, TypeScript strict, Tailwind CSS, ESLint, src 디렉토리 사용(`web/src/app/`), import alias `@/*`.
   - `create-next-app`을 비인터랙티브 플래그로 사용해도 되고 수동 구성해도 된다.
   - 홈은 기본 placeholder 페이지 하나만 남긴다 (내용: 프로젝트명 "anvil" 텍스트 정도).

3. **루트 src/types 스키마 공유 설정** (ADR-006의 핵심)
   - web 코드에서 루트 `src/types`의 zod 스키마·타입을 import할 수 있게 한다. 메커니즘(tsconfig paths + Next.js 설정 등)은 재량이되, **스키마를 web에 복제하는 방식은 금지**다.
   - 스모크 테스트로 증명하라: web 테스트에서 `MarketContextSchema`를 import해 유효한 fixture 객체가 parse를 통과하는지 확인.

4. **web 테스트 환경**
   - vitest + @testing-library/react + jsdom(또는 happy-dom)을 web workspace에 설정한다 (`web/vitest.config.ts`).
   - **루트 vitest가 `web/` 하위 테스트를 줍지 않도록** 루트 vitest 설정에 exclude를 추가하라. 두 워크스페이스의 테스트 환경(node vs jsdom)이 다르다.

5. **부수 정리**
   - `.gitignore`에 `web/.next/` 등 Next.js 산출물 추가.
   - `npm install`이 루트에서 한 번으로 양쪽 의존성을 설치하는지 확인.

## Acceptance Criteria

```bash
npm install
npm run build   # 루트 tsc + web next build 모두 성공
npm test        # 루트 vitest + web vitest(스키마 import 스모크 포함) 모두 통과
npm run lint    # 루트 + web ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조(web/ 구조)를 따르는가?
   - ADR-006(workspaces, 스키마 단일 소스)을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (타입 공유 메커니즘 명시)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 루트 `src/`의 기존 모듈 코드를 수정하지 마라. 이유: 이 step은 워크스페이스·설정만 다룬다. (package.json/tsconfig/eslint/vitest 설정 파일은 예외)
- 페이지·API 라우트·컴포넌트를 구현하지 마라. 이유: step 2~8의 scope다.
- zod 스키마·타입을 web에 복제하지 마라. 이유: `src/types`가 단일 소스다 (ADR-006).
- 웹폰트 CDN·외부 아이콘 패키지를 추가하지 마라. 이유: 로컬 도구이며 UI_GUIDE가 시스템 폰트 스택과 인라인 SVG를 지정한다.
- 기존 테스트를 깨뜨리지 마라
