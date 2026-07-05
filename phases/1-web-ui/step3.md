# Step 3: design-system

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — **이 step의 스펙이다. 색상·컴포넌트·타이포·안티패턴 표를 그대로 따라라**
- `/docs/PRD.md` ("Phase 1-web-ui" 섹션 — 뱃지가 표현할 severity·run 상태 종류)
- `/CLAUDE.md`
- `web/` 설정 (step 0 산출물), `src/types/criticism.ts` (CriticismSeverity), `src/lib/runStore.ts` (RunDisplayStatus)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

UI_GUIDE 기반 공통 컴포넌트를 `web/src/components/ui/`에 TDD로 작성한다. 이후 모든 화면 step(4~8)이 이 컴포넌트만 사용해 UI_GUIDE 위반을 구조적으로 차단하는 것이 목적이다.

```tsx
// 모두 web/src/components/ui/ 하위. props 상세는 재량이되 아래 역할을 지켜라.
PageShell        // 상단 헤더(로고 텍스트 "anvil" + 홈 링크) + max-w-5xl 컨테이너
Card             // rounded-md bg-white border border-neutral-200 p-6
Button           // variant: "primary" | "secondary" | "text" — UI_GUIDE 버튼 스펙
TextAreaField    // 라벨 + textarea — UI_GUIDE 입력 필드 스펙
SeverityBadge    // severity: CriticismSeverity → 라벨·색 매핑
RunStatusBadge   // status: RunDisplayStatus → 라벨·색 매핑
Collapsible      // <details>/<summary> 기반 접기. summary 텍스트를 prop으로
EmptyState       // 아이콘 없이 제목+설명+액션 슬롯. 빈 목록·데이터 없음 안내용
SectionHeading   // 섹션 제목(id 앵커 지원 — 리포트 목차 네비가 사용)
```

핵심 규칙 (설계 의도 — 반드시 지켜라):

1. **한국어 라벨 매핑을 이 step에서 한 곳에 확정하라** (이후 step이 재사용):
   - severity: `fatal` → "치명적", `major` → "중대", `minor` → "경미"
   - run 상태: `completed` → "완료", `error` → "실패", `running` → "진행중", `stalled` → "중단됨"
2. **색은 UI_GUIDE 시맨틱 표의 값만** 사용하라. severity 뱃지는 옅은 배경+진한 텍스트 조합(예: fatal → bg-red-50 text-red-700 border-red-200).
3. 아이콘이 필요하면 인라인 SVG(strokeWidth 1.5)로 직접 그려라.

테스트(@testing-library/react): SeverityBadge·RunStatusBadge의 값별 라벨 렌더링, Collapsible 접힘/펼침, Button variant 클래스 분기 정도면 충분하다. 스타일 클래스 전체를 스냅샷으로 고정하지 마라 — 라벨·역할 중심으로 검증하라.

## Acceptance Criteria

```bash
npm run build
npm test        # 뱃지 라벨 매핑·Collapsible·Button variant 테스트 통과
npm run lint
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - UI_GUIDE의 "AI 슬롭 안티패턴 — 하지 마라" 표를 위반한 스타일이 없는가? (blur, gradient text, 보라색, glow 등)
   - 컴포넌트가 web/src/components/ui/에만 있는가?
3. 결과에 따라 `phases/1-web-ui/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 (컴포넌트 목록 포함)"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 페이지(라우트)를 구현하지 마라. 이유: step 4~8의 scope다.
- 외부 UI 라이브러리(shadcn, MUI, 아이콘 패키지 등)를 설치하지 마라. 이유: 의존성 최소화 철학(ADR)이며 UI_GUIDE 스펙만으로 충분하다.
- UI_GUIDE 안티패턴 표의 항목(backdrop-blur, gradient text, 보라/인디고, glow 애니메이션, 균일 rounded-2xl, gradient orb)을 쓰지 마라. 이유: UI_GUIDE가 명시적으로 금지한다.
- 다크 모드를 구현하지 마라. 이유: PRD Phase 1-web-ui 제외 사항이다.
- 기존 테스트를 깨뜨리지 마라
