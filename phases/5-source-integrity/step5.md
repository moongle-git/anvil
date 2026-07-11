# Step 5: coverage-disclosure

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/docs/ADR.md` — **ADR-012**(fail-soft 수집), **ADR-013**(step 0에서 추가됨)
- `/docs/ARCHITECTURE.md`, `/docs/UI_GUIDE.md` — 무채색 문서 톤
- `/CLAUDE.md`
- `src/types/research.ts` — `SourceCoverage` (`status: "collected" | "unconfigured" | "failed"`, `count`, `error?`), `SOURCE_LABELS`, `RESEARCH_SOURCE_IDS` (step 2에서 신설됨)
- `src/types/marketContext.ts` — `MarketContext.researchCoverage` (step 2에서 코드 주입 필드로 추가됨)
- `src/lib/report.ts` — `voiceBreakdown`. **이 함수가 이번 문제의 축소판이다** (아래 배경 참조)
- `web/src/components/report/MarketContextSection.tsx`
- `web/src/components/ui/` — 재사용할 공통 컴포넌트를 먼저 찾아라

## 배경 — 리포트가 침묵으로 거짓말한다

`.env`에 `NAVER_CLIENT_SECRET`이 없어서 네이버 소스는 **한 번도 등록된 적이 없다.** `buildResearchSources`(`src/cli/index.ts`)가 키가 없는 소스를 배열에서 제외하고 `console.warn` 한 줄만 남기기 때문이다. 실제로 8개 run 전부 네이버 인용이 **0건**이다.

그런데 **리포트에는 그 사실이 어디에도 없다.** 독자는 "YouTube·Hacker News·네이버 3소스로 조사했다"는 아키텍처 설명을 믿고 리포트를 읽는다. 실제로는 네이버 조사가 통째로 빠져 있는데도.

`src/lib/report.ts`의 `voiceBreakdown`이 이 문제의 축소판이다:

```ts
    .filter(({ count }) => count > 0)      // ← 0건인 소스를 목록에서 지운다
```

주석은 `소스별 수집 편중이 <summary> 한 줄에 드러나야 한다 — HN 0건은 근거 편향이다`라고 **의도를 정확히 적어놓고**, 정작 코드는 0건을 `filter`로 지워서 그 편향을 **보이지 않게** 만든다. 없는 것이 안 보이면 독자는 없다는 걸 모른다.

**원칙**: 수집되지 않은 소스는 **명시적으로 표시**한다. 그리고 세 가지 상태를 절대 뭉개지 않는다:
- `collected` (count N) — 조사했고 N건 나왔다. **`count: 0`도 유효한 사실이다** (HN에 한국어 쿼리가 가면 실제로 0건이 된다 — 그건 시장 신호다).
- `unconfigured` — **키가 없어 조사조차 안 했다.** 우리 설정 문제이지 시장 신호가 아니다.
- `failed` — 조사하려 했으나 에러(quota 초과 등). 사유를 함께 보여준다.

## 작업

### 1. `src/lib/report.ts` — 자료조사 커버리지 렌더

시장 맥락 섹션 **상단**(트렌드·경쟁사보다 먼저)에 커버리지를 렌더한다. 근거의 범위를 먼저 알려주고 그 다음에 근거를 보여주는 순서다.

- `context.researchCoverage`를 순회해 소스별 한 줄씩 렌더한다. 라벨은 `SOURCE_LABELS`를 쓴다 (하드코딩 금지).
  - `collected` → `YouTube — 12건`
  - `collected` + `count: 0` → `Hacker News — 0건 (검색됐으나 결과 없음)`
  - `unconfigured` → `네이버 — 미설정으로 수집하지 않음` ← **이 줄이 이번 step의 존재 이유다**
  - `failed` → `네이버 — 수집 실패: {error}`
- `researchCoverage`가 **빈 배열이면** (구 run — step 2 이전에 생성됨) 커버리지 블록을 통째로 생략하라. 거짓 정보를 만들지 마라.
- **`citations`가 0건이면 명시하라**: `웹검색 인용 없음 — grounding이 인용을 반환하지 않았다`. 이것이 8/8 run에서 조용히 일어났던 실패다. 보이게 만들어라.
- **`voiceBreakdown`의 `.filter(({ count }) => count > 0)`를 제거하라.** 0건 소스도 `<summary>` 요약줄에 나타나야 한다. 주석이 원래 의도한 그대로다. `unconfigured` 소스는 `미설정`으로 표기해 0건과 구분하라.

### 2. `web/src/components/report/MarketContextSection.tsx` — 동일한 커버리지 표시

- 시장 맥락 섹션 상단에 커버리지를 렌더한다. UI_GUIDE의 무채색 톤을 따르되, **`unconfigured`와 `failed`는 독자가 놓치면 안 되는 정보**이므로 시각적으로 눈에 띄어야 한다. UI_GUIDE의 색 규정("색은 데이터의 의미에만 쓴다")을 위반하지 않는 선에서 처리하라 — severity 팔레트를 새 의미로 전용하지 말고, 무채색 + 타이포그래피 위계 또는 기존 UI 컴포넌트로 해결하라.
- 검증을 위한 시맨틱 훅을 노출하라: 각 커버리지 항목에 `data-coverage-source={source}`와 `data-coverage-status={status}`. **클래스 문자열로 테스트하지 않기 위해서다.**
- 아코디언 `<summary>` 요약줄도 0건/미설정 소스를 반영하도록 갱신하라.

### 3. 테스트

**이 프로젝트의 테스트 철학**: 브리틀한 클래스 단언을 쓰지 마라. **계약·동작·접근성·시맨틱 `data-*` 훅**으로 검증한다.

- `src/lib/report.test.ts`:
  - `unconfigured`인 소스가 리포트 본문에 "미설정" 취지의 문구로 나타나는가
  - `collected` + `count: 0`과 `unconfigured`가 **서로 다른 문구**로 렌더되는가 (이 둘을 뭉개는 것이 이번 phase가 고치는 버그다)
  - `failed`의 `error` 메시지가 리포트에 나타나는가
  - `citations`가 0건일 때 "인용 없음"이 명시되는가
  - `researchCoverage`가 빈 배열(구 run)이면 커버리지 블록이 생략되는가
  - `voiceBreakdown`이 0건 소스를 더 이상 숨기지 않는가
- `web/src/components/report/MarketContextSection.test.tsx`:
  - `data-coverage-status="unconfigured"`인 항목이 렌더되는가
  - 세 상태가 서로 다른 텍스트로 구분되는가
  - `researchCoverage`가 빈 배열이면 커버리지 영역이 렌더되지 않는가

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 테스트 통과 (루트 + web 워크스페이스 전부)
npm run lint    # ESLint 통과
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. **육안 검증**:
   ```bash
   npm run web    # 기존 run의 리포트 페이지를 연다
   ```
   구 run(`researchCoverage`가 없는 run)에서 커버리지 블록이 **생략**되고 페이지가 깨지지 않는지 확인하라.
3. 아키텍처 체크리스트:
   - `SOURCE_LABELS`를 썼는가? 라벨을 하드코딩하지 않았는가?
   - UI_GUIDE의 색 규정을 위반하지 않았는가? (severity 팔레트를 커버리지 의미로 전용하지 마라)
   - 테스트가 클래스가 아니라 `data-*` 훅/역할/텍스트로 검증하는가?
4. 결과에 따라 `phases/5-source-integrity/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`

## 금지사항

- **`unconfigured`를 "0건"으로 표기하지 마라.** 이유: "네이버 키가 없어 조사를 안 했다"와 "네이버를 조사했는데 결과가 0건이다"는 완전히 다른 사실이다. 전자는 우리 설정 문제이고 후자는 시장 신호다. 뭉개면 이 phase가 고치려는 바로 그 거짓말을 다시 만든다.
- **0건인 소스를 목록에서 `filter`로 지우지 마라.** 이유: 그게 지금 `voiceBreakdown`이 저지르고 있는 잘못이다. 없는 것이 안 보이면 독자는 없다는 걸 모른다.
- **`.env`나 `.env.example`을 수정하지 마라.** 이유: 네이버 secret 발급은 사용자의 몫이다. 코드는 키가 없는 상태를 **정직하게 표시**하기만 하면 된다. 키가 없어도 파이프라인은 완주해야 한다(ADR-012 fail-soft).
- **커버리지가 나쁘다고 파이프라인을 실패시키지 마라.** 이유: fail-soft가 설계 결정이다. 소스가 0개여도 웹검색만으로 완주한다.
- 기존 테스트를 깨뜨리지 마라.
