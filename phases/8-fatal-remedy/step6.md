# Step 6: web-ledger

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-008**(결론은 최하단 — 이 step의 설계 제약), ADR-017, ADR-006(web은 `src/types`를 단일 소스로 import한다), ADR-009(외부 차트 라이브러리 없음)
- `/docs/UI_GUIDE.md` — **전부 읽어라.** 특히 "색은 데이터 의미에만 쓴다"와 미러 액센트 레일(正=왼쪽 무채색 / 反=오른쪽 severity 색)
- `/docs/PRD.md`, `/docs/ARCHITECTURE.md`, `/CLAUDE.md`
- `web/AGENTS.md` — Next.js 문서를 `node_modules/next/dist/docs/`에서 읽으라는 지시가 있다. 따르라.
- `web/src/components/report/ReportView.tsx`, `SolutionSection.tsx`, `VerdictSection.tsx` — 이번에 바꿀 파일들
- `web/src/components/` 하위의 `SeverityBadge`·`Badge` 등 기존 톤 컴포넌트 — **재사용한다**
- `src/lib/report.ts` — **step 5가 방금 만든 4절/5절 분리를 읽어라.** 웹이 같은 규칙을 따라야 한다.
- `src/types/ledger.ts` — `buildLedger`
- `web/src/test/components/` — 테스트 선례

## 배경

step 5가 `report.md`에 원장을 렌더했다. 이 step은 **웹 리포트 뷰**에 같은 것을 렌더한다. 웹 뷰가 주력 산출물이다 (PRD).

**4절/5절 분리는 step 5와 동일하다** — ADR-008이 두 렌더러 모두를 지배한다:

| 절 | 렌더할 것 | 금지 |
|---|---|---|
| **4절 `SolutionSection`** | 해결책만 (전략 라벨 + 본문) | **감사 결과 절대 금지** |
| **5절 `VerdictSection`** | 원장 전체 (요약 + 3열) — 잔존 리스크 앞 | — |

## 작업

### 1. 신규 `web/src/components/report/RemedyLedger.tsx`

원장 표를 렌더하는 컴포넌트. 4절용/5절용을 어떻게 나눌지는 재량이나, **감사 결과가 4절로 새지 않는 것이 구조적으로 보장되게** 하라 (예: prop 자체를 받지 않게).

### 2. `SolutionSection` · `VerdictSection` · `ReportView`

두 섹션 모두 `criticism`이 필요하다 → `ReportView`가 전달한다. props 배선을 하라.

### 3. 스타일

- `SeverityBadge`·`Badge`의 기존 톤을 **재사용**한다. **새 색을 도입하지 마라** (UI_GUIDE: 색은 데이터 의미에만 쓴다).
- 감사 결과 3값(유효/재주장/비판 기각)에 색을 쓸 거라면 기존 severity 톤 체계 안에서 해결하라.
- 표가 좁은 화면에서 넘치지 않게 하라 (기존 반응형 패턴을 따르라).

### 4. Graceful degradation

- 원장 없는 구 run → 블록 생략 (빈 표 아님)
- `remedyAudits: []` → 감사 열 없이 해결책만
- unknown id → 조용히 드롭, throw 금지

### 5. 테스트

`web/src/test/components/`에 추가. **테스트 원칙**: 브리틀한 클래스 단언을 하지 마라. 접근성 역할·표시 텍스트·시맨틱 `data-*` 훅으로 검증하라.

- 5절에 원장 표와 요약이 렌더된다
- **4절에 감사 결과가 렌더되지 않는다** ← ADR-008의 안전벨트
- 5절 원장이 잔존 리스크보다 앞에 나온다
- 침묵한 fatal이 "해결책 없음"으로 표시된다
- 원장 없는 run은 블록이 생략된다
- unknown id에 throw하지 않는다

## 불변식

- **`src/types`를 단일 소스로 import한다. web에서 타입·라벨을 중복 정의하지 마라** (ADR-006). `REMEDY_STRATEGY_LABELS`·`REMEDY_VERDICT_LABELS`·`buildLedger`를 그대로 쓴다.
- **웹 읽기 경로는 정적 스키마를 계속 쓴다** (step 4의 불변식). 팩토리로 바꾸면 기존 run 5개가 빈 화면이 된다.
- ADR-009: 새 차트 라이브러리 금지.

## Acceptance Criteria

```bash
npm run build
npm test        # root + web 전부
npm run lint
env -u GEMINI_API_KEY -u YOUTUBE_API_KEY -u NAVER_CLIENT_ID -u NAVER_CLIENT_SECRET npm test
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. 아키텍처 체크리스트:
   - web이 `src/types`에서 import하는가? 라벨을 중복 정의하지 않았는가? (ADR-006)
   - UI_GUIDE의 색 원칙을 지켰는가? 새 색을 도입하지 않았는가?
   - ADR-008을 위반하지 않는가? (4절에 결론 누설 없음)
   - 웹 읽기 경로가 정적 스키마를 쓰는가?
3. `phases/8-fatal-remedy/index.json`의 step 6을 업데이트한다.

## 금지사항

- **4절에 감사 결과를 렌더하지 마라.** 이유: ADR-008. 결론을 미리 누설하면 정반합 전개가 장식이 된다.
- **web에서 타입·라벨을 중복 정의하지 마라.** 이유: ADR-006. `src/types`가 단일 소스다.
- **새 색을 도입하지 마라.** 이유: UI_GUIDE — 색은 데이터 의미에만 쓴다.
- **새 npm 의존성을 추가하지 마라.** 이유: 이 프로젝트는 의존성 0 추가를 자랑한다 (node:sqlite, 인라인 SVG).
- **웹 읽기 경로를 팩토리로 바꾸지 마라.** 이유: 기존 run 5개가 조용히 빈 화면이 된다.
- **브리틀한 클래스 단언으로 테스트하지 마라.** 이유: 계약·동작·접근성·시맨틱 `data-*` 훅으로 검증한다.
- **기존 테스트를 깨뜨리지 마라.**
