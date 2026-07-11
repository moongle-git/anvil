# Step 5: report-consistency

## 읽어야 할 파일

먼저 아래 파일들을 읽고 설계 의도를 파악하라:

- `/docs/UI_GUIDE.md` — 특히 테두리 블록 내부 여백 규격, 번호 목록 규격, 정반합 카드 규격
- `/docs/ADR.md` · `/docs/ARCHITECTURE.md`
- `web/src/lib/richText.tsx` — step 1에서 번호 목록 라벨 분리 + `space-y-5`가 적용됐다. `ORDERED`/`UNORDERED` 상수를 확인하라
- `web/src/components/ui/Card.tsx` — step 2에서 `accent` prop이 추가됐다
- `web/src/components/report/DialecticSplit.tsx` — step 4에서 골격이 통일됐다. **이 파일의 최종 형태가 나머지 컴포넌트가 따라야 할 기준이다**
- 수정 대상:
  - `web/src/components/report/ReportView.tsx`
  - `web/src/components/report/VerdictSection.tsx`
  - `web/src/components/report/MarketContextSection.tsx`
  - `web/src/components/compare/ComparePage.tsx` (삭제 대상)

## 배경

step 1~4가 번호 목록·Card accent·레이더·正/反 골격을 고쳤지만, **같은 규격을 손으로 복제해둔 곳들이 리포트 안에 남아 있다.** 이대로 두면 한 리포트 안에서 두 종류의 번호 목록 간격이 공존하고, 옛 콜아웃 골격이 최상단에 남는다.

이 step은 그 잔재를 일괄 정리하고 phase 전체를 육안 검증한다.

## 작업

### 1. `ReportView.tsx` — 구버전 안내 배너를 새 콜아웃 규격으로

현재:

```tsx
<div className="border-l-2 border-neutral-300 bg-neutral-50 p-4 text-[15px] leading-[1.8] text-neutral-700">
  이 리포트는 이전 버전 형식으로 생성되었습니다. …
</div>
```

이건 step 4에서 고친 `DialecticSplit`의 反 리드 콜아웃과 **같은 골격을 손으로 복제한 것**이다. UI_GUIDE 콜아웃 규격에 따라 `Card` + `accent`(왼쪽, 무채색) + `bg-neutral-50`으로 바꿔라. padding은 `Card` 기본값을 쓴다.

이 배너가 결론 스포일러가 아니라 데이터 상태 안내라서 상단에 두어도 ADR-008에 어긋나지 않는다는 기존 주석을 유지하라.

### 2. `VerdictSection.tsx` — "생존 조건" 번호 목록을 공용 규격으로

현재 `:90` 근처:

```tsx
<ol className="list-decimal space-y-3 pl-6 text-[15px] leading-[1.8] text-neutral-700 marker:font-medium marker:text-neutral-500">
  {verdict.conditions.map((condition, index) => (
    <li key={index}>{renderInline(condition)}</li>
  ))}
</ol>
```

문제 두 가지:
- 클래스 문자열이 `richText.tsx`의 `ORDERED` 상수와 **똑같이 복제**되어 있다. step 1이 `space-y-3 → space-y-5`로 바꿨으므로, 그대로 두면 같은 리포트 안에 간격이 다른 두 종류의 번호 목록이 생긴다.
- `<li>`에 `renderInline`을 직접 넣으므로 step 1의 **라벨 분리 렌더링을 적용받지 못한다.**

해결: 번호 목록 렌더링을 한 곳에서만 정의하도록 통합하라. `richText.tsx`가 `ORDERED` 클래스나 목록 렌더링을 재사용 가능한 형태로 export하게 하고(예: 공용 `<OrderedList>` 컴포넌트 또는 클래스 상수 export), `VerdictSection`이 그걸 쓰게 하라. **구현 방식은 재량이지만, 클래스 문자열이 두 파일에 복제된 상태로 남으면 안 된다.**

주의: `verdict.conditions`는 `string[]`이라 각 항목이 이미 개별 문자열이다. `renderRichText`(블록 파서)를 통째로 태우면 항목마다 `<div>` 래퍼가 생겨 리스트 구조가 망가진다. 항목 배열을 받아 `<ol>`로 렌더링하는 경로가 필요하다.

`web/src/test/components/verdict.test.tsx`가 `ol > li` 개수 = `conditions.length`를 단언한다. 이 계약을 유지하라.

### 3. `MarketContextSection.tsx` — 레일 인용 여백

`:28` 근처의 `<figure data-voice-source={...} className="border-l-2 border-neutral-300 pl-4">`는 **상하 여백이 0**이다. 텍스트가 레일 끝에 붙어 잘린 것처럼 보인다.

UI_GUIDE 레일 인용 규격(`border-l-2 border-neutral-300 py-1 pl-4`)을 적용하라. step 4에서 고친 `DialecticSplit`의 `rebuttedClaim` 인용과 **같은 값**이어야 한다 — 같은 시맨틱이 다른 값을 갖고 있던 게 원래 문제였다.

`data-voice-source` 훅은 유지하라 (`report.test.tsx`가 쓴다).

### 4. `compare/ComparePage.tsx` 삭제

이 파일은 **어디서도 import되지 않는 죽은 코드**다. 실제 경로는 `app/compare/page.tsx` → `CompareClient` → `CompareLoader` → `CompareMatrix`다.

게다가 `<Card className="min-h-full p-5">`로 Card의 기본 `p-6`을 덮어쓰려 하는데, Tailwind는 클래스 순서가 아니라 CSS 정의 순서로 우선순위가 정해져서 **어느 쪽이 이길지 불안정하다.** step 2가 Card accent를 도입한 마당에 이 파일을 살려두면 "className으로 padding을 덮어쓴다"는 잘못된 선례가 남는다.

삭제 전 확인:
```bash
grep -rn "ComparePage" web/src --include=*.ts --include=*.tsx
```
import가 하나도 없으면 삭제하라. **하나라도 있으면 삭제하지 말고 그 사실을 summary에 적어라.**

`ComparePage.tsx`가 `@/lib/client/types`·`@/lib/client/format`의 유일한 소비자라면 그 파일들도 죽은 코드다. `grep`으로 확인하고, 다른 소비자가 없으면 함께 삭제하라. 확신이 없으면 `ComparePage.tsx`만 지우고 나머지는 남겨라 — 죽은 코드 정리는 이 phase의 부수 목표이지 주 목표가 아니다.

### 5. 잔여 규격 위반 훑기

리포트·비교 화면에서 **테두리가 있는데 내부 여백이 UI_GUIDE 규격을 벗어난 블록**이 더 있는지 확인하라:

```bash
grep -rn "border-l-2\|border-r-2\|border " web/src/components/report web/src/components/compare --include=*.tsx
```

**건드리면 안 되는 것 (콜아웃이 아니다):**
- `SectionNav.tsx`의 `border-l-2 px-3 py-1.5` — 목차 네비의 활성 섹션 **표시자**
- `CompareMatrix.tsx`의 `border-t-2 border-neutral-900 pt-3` — 컬럼 헤더
- `progress/ProgressView.tsx`의 `p-4`/`p-3` — 진행 화면 스텝 리스트. 조밀함이 목적이고 UI_GUIDE가 예외로 허용한다. **이번 스코프 밖이다**
- `CompetitorTable.tsx`의 셀 padding — 표 셀은 콜아웃이 아니다. 손대지 마라

## Acceptance Criteria

리포지토리 루트에서 실행:

```bash
npm run build -w web   # next build --webpack — 타입 체크 겸함, 에러 0
npm run test  -w web   # vitest run — 전부 통과
npm run lint  -w web   # eslint — 에러 0
npm run build          # 루트 tsc + web 빌드 — 전체가 여전히 성립하는지 최종 확인
npm run test           # 루트 vitest + web vitest — 전체 통과
```

추가로 안티패턴 잔존 여부를 확인하라 (출력이 비어야 한다):

```bash
grep -rn "backdrop-blur\|bg-gradient\|purple-\|indigo-\|blur-3xl" web/src --include=*.tsx --include=*.css
```

## 검증 절차

1. 위 AC 커맨드를 전부 실행한다.
2. **육안 검증 (필수).** 개발 서버를 띄우고 완료된 run 하나를 연다:

   ```bash
   npm run web    # http://localhost:3000
   ```

   `runs/` 디렉토리에서 완료된 run id를 찾아 `/runs/{id}`를 열고 아래를 **직접 확인**하라. 확인 결과를 summary에 적어라.

   - [ ] 正/反 카드의 테두리·모서리·padding이 동일하고, **레일 방향과 severity 뱃지 유무를 빼면** 시각적 차이가 없는가
   - [ ] 레일이 실제로 **한 변만** 강조되는가 (4면이 다 색칠되면 side-specific border 색 유틸리티를 안 쓴 것이다)
   - [ ] "해자와 카피캣" 축까지 스크롤해도 좌우가 구분되는가 (컬럼 헤더가 화면 밖일 때)
   - [ ] 삼각형 레이더가 反 컬럼 **가로 가운데**에 오는가
   - [ ] 合 섹션의 1·2·3 라벨이 별도 줄로 떨어지고, 본문이 번호에 물리지 않고 내어쓰기로 정렬되는가
   - [ ] 최종 판정의 "생존 조건" 번호 목록이 合 섹션의 번호 목록과 **같은 간격**인가
   - [ ] 테두리 안 텍스트가 테두리에서 충분히 떨어져 있는가 (레일 인용 포함)
   - [ ] 모바일 폭(브라우저 좁히기)에서 컬럼이 세로 스택되고 `正 (낙관)`/`反 (비판)` 칩이 보이는가

   서버 기동이나 run 데이터 확인이 불가능하면 **`blocked`로 표시하고 중단하라.** 육안 검증 없이 completed로 넘기지 마라 — 이 phase는 시각 작업이고, 테스트는 레이아웃을 검증하지 못한다(jsdom은 레이아웃을 계산하지 않는다).
3. 아키텍처 체크리스트:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR-008(결론 상단 노출 금지)·ADR-009(차트 라이브러리 금지)를 지켰는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
4. 결과에 따라 `phases/4-dialectic-ui-polish/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약 + 육안 검증 결과"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (서버 기동 불가, run 데이터 없음 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- **번호 목록 클래스 문자열을 두 파일에 복제된 채로 남기지 마라.** 이유: 그게 애초에 이 step이 존재하는 이유다. step 1이 `richText.tsx`만 고쳐서는 `VerdictSection`의 목록이 옛 간격으로 남는다.
- **`SectionNav.tsx`·`CompareMatrix.tsx`의 border를 건드리지 마라.** 이유: 각각 목차 활성 표시자와 컬럼 헤더다. 콜아웃이 아니므로 콜아웃 여백 규격의 대상이 아니다. 고치면 네비 강조가 깨진다.
- **`progress/` 디렉토리를 건드리지 마라.** 이유: 진행 화면의 스텝 리스트는 조밀함이 목적이고 UI_GUIDE가 `p-4`를 명시적으로 허용한다. 이번 스코프는 리포트 화면이다.
- **`ComparePage.tsx`에 import가 하나라도 있으면 삭제하지 마라.** 이유: 죽은 코드라는 판단이 틀린 것이다. 삭제하면 빌드가 깨진다. `grep`으로 반드시 먼저 확인하라.
- **육안 검증을 건너뛰고 completed로 표시하지 마라.** 이유: 이 phase의 4가지 목표(골격 통일·레이더 중앙 정렬·번호 목록 가독성·padding)는 전부 **레이아웃** 문제인데, jsdom은 레이아웃을 계산하지 않으므로 `npm test`가 통과해도 아무것도 보장하지 못한다.
- 새 색상 hex·차트 라이브러리·마크다운 라이브러리를 도입하지 마라.
- 기존 테스트를 깨뜨리지 마라.
