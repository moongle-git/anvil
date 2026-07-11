# Step 4: link-revocation

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-013**(step 0에서 추가됨 — 이 step의 직접 근거). 특히 "검증되지 않은 URL의 링크를 박탈한다"
- `/docs/ARCHITECTURE.md`, `/docs/UI_GUIDE.md` — 무채색 문서 톤. "색은 데이터의 의미에만 쓴다 — severity·run 상태·링크 외에는 무채색"
- `/CLAUDE.md`
- `src/types/marketContext.ts` — `CODE_INJECTED_CONTEXT_KEYS`가 이제 `["citations", "researchCoverage", "communityVoices"]`다. `CitationSchema.kind`(`"origin" | "redirect"`)
- `src/lib/report.ts` — `competitorRow`, `voiceBlock`, `citationLink`, 출처/검색 인용 렌더. 주 수정 대상
- `web/src/components/report/MarketContextSection.tsx` — 주 수정 대상 (특히 `href={source}`)
- `web/src/components/report/CompetitorTable.tsx` — 주 수정 대상
- `web/src/components/ui/` — 재사용할 공통 컴포넌트를 먼저 찾아라. 새로 만들지 말고 있는 것을 써라

## 배경 — 왜 링크를 박탈하는가

리포트에 표시되는 URL의 출처는 네 종류이고, **신뢰도가 완전히 다르다.**

| 필드 | 누가 만들었나 | 실측 신뢰도 |
|---|---|---|
| `communityVoices[].url` | **코드** (step 3 이후 evidence에서 주입) | 실제 API가 준 permalink |
| `citations[].uri` (`kind: "origin"`) | **코드** (urlContext가 실제로 읽은 원본 URL) | 실재하고 만료되지 않음 |
| `citations[].uri` (`kind: "redirect"`) | **코드** (groundingChunks) | 실재하지만 **만료되면 404** |
| `competitors[].url`, `sources[]` | **LLM이 타이핑** | **89개 중 53개(60%) 사망** |

마지막 줄이 문제다. `sources[]`는 스키마가 `z.string().min(1)`이라 **URL 형식 검증조차 없는데**, 웹 UI는 `MarketContextSection.tsx:221`에서 그 문자열을 그대로 `href={source}`에 넣는다. 실제 산출물에는 이런 값이 들어 있다:

```
https://vertexaisearch.cloud.google.google.com/grounding-api-redirect/AUZIYQEe... [4] 10 Best AI Meeting Assistants and Note-Takers in 2026 - We360.ai
```

URL·각주번호·제목이 한 문자열로 뭉개진 데다 도메인에 `.google`이 중복돼 있다. 이게 `href`가 된다.

**원칙**: 사용자가 링크를 클릭한다는 것은 **그 URL이 검증됐다고 믿는다는 뜻**이다. 형식만 맞는 URL에 `href`를 거는 것은 거짓 신호다. 따라서 **클릭 가능한 링크는 코드가 API 응답에서 주입한 것만** 남긴다.

## 작업

### 1. `src/lib/report.ts` (Markdown 렌더러)

- **`sources[]`** — `#### 출처` 섹션. `bullets(context.sources)`가 문자열을 그대로 찍고 있다. 마크다운에서 벌거벗은 URL은 대부분의 뷰어에서 자동 링크가 된다. 따라서 **자동 링크를 막아야 한다**:
  - 섹션 제목을 `#### 출처 (LLM 자기보고 · 미검증)`으로 바꾼다.
  - 섹션 도입부에 한 줄: `> 아래 항목은 모델이 자기 기억으로 적어낸 것이라 검증되지 않았다. 링크를 걸지 않는다.`
  - 각 항목을 **인라인 코드(`` `...` ``)로 감싸** 자동 링크를 차단한다. 백틱이 포함된 문자열은 이스케이프하라.
- **`competitors[].url`** — `competitorRow`의 `[링크](${competitor.url})`를 제거한다. 링크 컬럼을 없애고 URL을 텍스트로 표시하되, 역시 인라인 코드로 감싼다. 표 셀 안이므로 `tableCell`의 파이프 이스케이프를 반드시 통과시켜라.
- **`citations[]`** — `citationLink`를 `kind`에 따라 분기한다:
  - `kind: "origin"` → **링크 유지** (`[제목](uri)`). 가장 강한 인용이다.
  - `kind: "redirect"` → **링크 제거**. `제목 (도메인) — 만료 가능한 검색 리다이렉트` 형태의 텍스트로 렌더한다. 이유: 이 URL은 만료되면 404가 된다. 지금 리포트에 남아 있는 372개의 vertexaisearch URL이 전부 이것이다.
  - 두 종류를 **섹션 안에서 시각적으로 구분**하라 (예: `#### 검색 인용` 아래 원본/리다이렉트 소분류). 독자가 "무엇을 믿을지 판단"할 수 있어야 한다는 ADR-012의 정신을 따른다.
- **`communityVoices[].url`** — **링크를 유지한다.** step 3에서 코드 주입 필드가 되었으므로 이제 사실이다. `voiceBlock`은 그대로 두되, URL을 벌거벗은 텍스트가 아니라 명시적 마크다운 링크(`[출처](url)`)로 바꿔도 좋다.

### 2. `web/src/components/report/MarketContextSection.tsx`

- **`href={source}` (221번째 줄 근처)를 제거하라.** `<a>`를 일반 텍스트 요소로 교체한다. UI_GUIDE의 무채색 톤을 따르고, 링크 색(blue-700)을 쓰지 마라 — **색이 곧 "클릭 가능"이라는 신호**다.
- 출처 목록 제목/라벨에 **"LLM 자기보고 · 미검증"**을 명시하라. 아코디언 `<summary>` 요약줄의 `출처 N개`도 오해를 부르므로 문구를 조정하라.
- `citations` 렌더(244번째 줄 근처)를 `kind`로 분기한다. `origin`만 `<a href>`, `redirect`는 텍스트 + "만료 가능" 표시.
- `communityVoices[].url` 링크(39번째 줄 근처)는 **유지**한다.
- **접근성**: 링크가 아닌 요소를 링크처럼 보이게 만들지 마라. 반대로, 링크에서 텍스트로 강등된 항목은 `title`/`aria-label` 등으로 "미검증 출처"임이 스크린리더에도 전달되게 하라.

### 3. `web/src/components/report/CompetitorTable.tsx`

- `competitor.url`의 `<a href>`(50~52번째 줄 근처)를 제거하고 텍스트로 표시한다. 링크 컬럼 헤더 문구도 조정하라.

### 4. 테스트

**이 프로젝트의 테스트 철학**: 브리틀한 클래스 단언(`toHaveClass("text-blue-700")`)을 쓰지 마라. **계약·동작·접근성·시맨틱 `data-*` 훅**으로 검증한다. 기존 `web/src/components/**/*.test.tsx`의 패턴을 먼저 읽고 따르라.

- `src/lib/report.test.ts`:
  - `sources[]`의 항목이 마크다운 자동 링크가 되지 않는가 (인라인 코드로 감싸졌는가)
  - `competitors[].url`이 `[링크](...)` 형태로 나타나지 **않는가**
  - `kind: "origin"` citation은 `[제목](uri)` 링크로 렌더되고, `kind: "redirect"`는 링크가 **아닌지**
  - `communityVoices[].url`은 여전히 링크인가 (회귀 방지)
- `web/src/components/report/*.test.tsx`:
  - `sources` 항목에 대해 `role="link"`인 요소가 **존재하지 않는가** (`queryAllByRole("link")`로 검증 — 클래스가 아니라 역할로)
  - `competitors[].url`에 대해 `role="link"`가 존재하지 않는가
  - `citations` 중 `kind: "origin"`만 `role="link"`이고 그 `href`가 `uri`와 일치하는가
  - `communityVoices`의 출처는 여전히 `role="link"`인가 (회귀 방지)

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (루트 + web 워크스페이스 전부)
npm run lint    # ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **육안 검증** — 기존 run 하나로 리포트를 렌더해 눈으로 확인하라:
   ```bash
   npm run web    # http://localhost:3000 에서 기존 run의 리포트 페이지를 연다
   ```
   `출처` 아코디언의 항목이 **클릭되지 않아야** 하고, `검색 인용`의 vertexaisearch 리다이렉트 항목도 **클릭되지 않아야** 한다. 유저 목소리의 출처 링크는 **클릭돼야** 한다.
3. 아키텍처 체크리스트:
   - UI_GUIDE의 무채색 톤을 지켰는가? 링크 색을 링크가 아닌 것에 쓰지 않았는가?
   - `src/types`를 단일 소스로 import했는가? (web에서 타입 중복 정의 금지 — ADR-006)
   - 테스트가 클래스 문자열이 아니라 role/동작으로 검증하는가?
4. 결과에 따라 `phases/5-source-integrity/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`sources[]`에 `z.url()`을 추가해서 "고치려" 하지 마라.** 이유: 형식 검증은 실존을 보장하지 않는다. `https://play.google.com/store/apps/details?id=com.groupride.app`은 완벽한 URL 형식이면서 404다. 실측 사망률 60%가 전부 형식은 멀쩡한 URL이었다.
- **`sources[]` 필드를 스키마에서 삭제하지 마라.** 이유: ADR-012의 상보성 논거(자기보고는 부정확하지만 만료되지 않는다)는 유효하다. 이번 결정은 삭제가 아니라 **링크 박탈**이다.
- **죽은 링크를 감지하려고 렌더 시점에 HTTP 요청을 보내지 마라.** 이유: (1) `src/lib/`와 web 컴포넌트는 외부 네트워크를 호출하지 않는다 — 외부 호출은 `src/services/`에서만 한다(CLAUDE.md CRITICAL). (2) "살아있는 URL"이 "맞는 출처"를 뜻하지도 않는다. 도달성은 신뢰의 대용물이 아니다.
- **`communityVoices`의 링크를 박탈하지 마라.** 이유: step 3에서 코드 주입 필드가 되었다. 이건 사실이다.
- 기존 테스트를 깨뜨리지 마라.
