# UI 디자인 가이드

라이트 문서/리포트 스타일. 화면의 주인공은 컨설팅 리포트의 텍스트 콘텐츠다.

## 디자인 원칙
1. 컨설팅 리포트 문서처럼 읽혀야 한다. 마케팅 페이지가 아니라 인쇄해도 어색하지 않은 보고서. 장식은 가독성을 돕는 선에서만.
2. 순차 논증. 리포트는 시장 맥락 → 正 → 反 → 合 → 최종 판정 순으로 읽힌다. 결론을 상단에 미리 노출하지 않는다. 사용자의 현재 위치는 목차 네비의 현재 섹션 강조로 알린다.
3. 색은 데이터의 의미에만 쓴다. severity(fatal/major/minor)·run 상태·링크 외에는 무채색만 사용한다.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |
| 차트 라이브러리 기본 테마(무지개 팔레트) | 색은 데이터 의미에만 쓴다는 원칙 위반 |

## 색상
### 배경
| 용도 | 값 |
|------|------|
| 페이지 | #ffffff |
| 카드 | #ffffff + border #e5e5e5 (neutral-200) |
| 인용/콜아웃/코드성 배경 | #fafafa (neutral-50) |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트(제목) | text-neutral-900 (#171717) |
| 본문 | text-neutral-700 |
| 보조(메타 정보, 캡션) | text-neutral-500 |
| 비활성 | text-neutral-400 |

### 데이터/시맨틱 색상
| 용도 | 값 |
|------|------|
| severity: fatal / run 실패 | #dc2626 (red-600) |
| severity: major | #d97706 (amber-600) |
| severity: minor / 중립 | #6b7280 (gray-500) |
| run 완료 | #16a34a (green-600) |
| run 진행중 / 링크 | #1d4ed8 (blue-700) |

severity 뱃지는 옅은 배경 + 진한 텍스트 조합(예: fatal → bg-red-50 text-red-700 border-red-200)으로 문서 톤을 유지한다.

## 컴포넌트
### 카드
```
rounded-md bg-white border border-neutral-200 p-6
```

### 테두리가 있는 블록은 내부 여백을 반드시 확보한다
테두리(또는 액센트 레일)를 그었으면 텍스트와 그 선 사이에 여백이 있어야 한다. 여백 없이 붙은 텍스트는 잘린 것처럼 보인다.

| 블록 종류 | 규격 |
|---|---|
| 카드 | `p-6` |
| 레일 + 배경 콜아웃 (反의 소결론, 구버전 안내 배너 등) | 카드와 같은 컨테이너를 쓴다 — `Card` + accent + `bg-neutral-50`. 별도 골격을 손으로 만들지 마라 |
| 레일 인용 (배경 없음 — 커뮤니티 목소리, 반박 대상 인용 등) | `border-l-2 border-neutral-300 py-1 pl-4` — **상하 여백을 0으로 두지 마라.** `pl-3`·`pl-4`만 주면 텍스트가 레일 위아래 끝에 딱 붙는다 |

예외:
- 진행 화면(`ProgressView`)의 스텝 리스트 아이템은 조밀함이 목적이므로 `p-4`를 허용한다.
- 목차 네비(`SectionNav`)의 활성 표시와 비교 뷰(`CompareMatrix`)의 컬럼 헤더는 콜아웃이 아니라 표시자다 — 이 규격의 대상이 아니다.

### 정반합 카드 (正/反)
正과 反의 **골격은 완전히 동일**하다.
```
rounded-md border border-neutral-200 bg-white p-6
```
한쪽만 카드가 아니거나, 모서리가 각지거나, padding이 다르면 안 된다. 그건 의도된 차이가 아니라 통일 실패로 읽힌다.

주장이 서로 반대라는 사실은 **액센트 레일의 방향**으로만 표현한다 — 미러 액센트 레일.

| 쪽 | 레일 | 색 |
|---|---|---|
| 正 | **왼쪽** 2px | 무채색 `neutral-900` |
| 反 | **오른쪽** 2px | 해당 항목의 severity 색 (fatal → red-600 / major → amber-600 / minor → gray-500) |

두 레일이 가운데 거터를 사이에 두고 마주 보며 정면 대치를 만든다. 이것이 좌우 컬럼의 정체성 신호다 — 컬럼 헤더가 화면 밖으로 스크롤돼도 어느 쪽 주장인지 알 수 있다.

正에 색을 쓰지 않는 이유: 낙관 주장에는 severity가 없다. 색은 데이터의 의미에만 쓴다(원칙 3).

좌우 카드는 모두 **"제목 → 메타 → 근거"** 순서를 지킨다. 反의 `RiskScoreBadge`는 제목 **아래** 메타 줄에 놓는다 — 제목 위에 두면 좌우 카드의 첫 줄 baseline이 어긋나 같은 축의 두 주장이 나란히 읽히지 않는다.

레일 색 등 정확한 Tailwind 클래스는 `Card` 컴포넌트 내부 구현으로 격리하고, 호출부는 의미(side/tone)만 넘긴다 — `Badge`가 tone→색을 격리한 것과 같은 규율이다.

### 버튼
```
Primary:   rounded-md bg-neutral-900 text-white hover:bg-neutral-700 px-4 py-2 text-sm font-medium
Secondary: rounded-md bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50
Text:      text-neutral-500 hover:text-neutral-900 underline-offset-4 hover:underline
Danger:    rounded-md bg-red-600 text-white hover:bg-red-700 px-4 py-2 text-sm font-medium
```
`Danger`는 **확인 단계에서만** 쓴다 — 아래 "삭제 버튼" 참조.

### 삭제 버튼 (Phase 6)
run 삭제는 되돌릴 수 없다. run의 상태·산출물·리포트가 CASCADE로 함께 사라진다(ADR-015).

**진입 버튼은 무채색이다.** 목록 행과 상세 헤더의 "삭제"는 `Text` 버튼을 쓴다(`text-neutral-500 hover:text-neutral-900`).
빨강을 진입 버튼에 쓰지 않는 이유는 원칙 3이다 — red-600은 이미 `severity: fatal` / `run 실패`라는 **데이터의 의미**를 갖는다. 아직 아무것도 파괴하지 않은 버튼에 그 색을 쓰면 목록에서 "실패한 run"과 "삭제 가능한 run"이 같은 빨강으로 섞인다. 빨강은 **파괴가 실제로 임박한 순간**, 즉 확인 단계에서만 등장한다.

**확인은 인라인이다.** 모달을 만들지 마라 — 포커스 트랩·스크롤 잠금·오버레이 골격이 통째로 필요한데, 이 프로젝트에는 모달이 하나도 없고 문서 톤에도 맞지 않는다. "삭제"를 누르면 **그 자리에서** 버튼이 확인 줄로 바뀐다.

```
[삭제]  →  되돌릴 수 없습니다. 리포트와 수집 증거가 모두 삭제됩니다.  [삭제] [취소]
           └ text-sm text-neutral-700                                  └ Danger  └ Secondary
```
- 확인 줄은 콜아웃이 아니라 액션 줄이다 — `Card`로 감싸지 않는다.
- 기본 포커스는 **[취소]** 에 둔다. Esc는 취소와 같다.
- 삭제 진행 중에는 두 버튼을 disabled로 두고 [삭제]의 라벨을 "삭제 중…"으로 바꾼다.

**실행 중(running)인 run은 삭제할 수 없다.** 버튼을 숨기지 말고 **비활성**으로 둔다(`text-neutral-400` + `cursor-not-allowed`, `disabled`) — 사라지는 버튼은 기능이 없는 것처럼 보인다. 사유("실행 중에는 삭제할 수 없습니다")를 `title`과 접근성 레이블로 남긴다.

### 재실행 버튼 (Phase 6)
재실행(rerun)은 **완료된 run**에서만 뜨고, resume("이어서 실행")은 **error·stalled**에서만 뜬다. 한 화면에 동시에 나타나지는 않지만, 사용자가 둘을 같은 것으로 오해하면 안 된다.

| 액션 | 라벨 | 부제 | 버튼 | 어디서 |
|---|---|---|---|---|
| resume | **이어서 실행** | (없음) | `Primary` | error·stalled run |
| rerun | **재실행** | 자료조사부터 다시 | `Secondary` | completed run 상세 |

- 라벨은 **"재실행"으로 통일**한다. "다시 실행"·"새로 실행"처럼 섞어 쓰지 마라.
- 부제 "자료조사부터 다시"는 버튼 아래(또는 옆) `text-xs text-neutral-500`으로 분리 노출하고, `title`에도 같은 문구를 넣는다. 뱃지 안에 문구를 밀어 넣지 않는다(`RiskScoreBadge`와 같은 규율).
- resume이 `Primary`인 이유: 중단된 run에서 사용자가 원하는 유일한 다음 행동이다. rerun이 `Secondary`인 이유: 완료된 run의 주인공은 리포트이고, 재실행은 부차적 행동이다.
- **확인 단계를 두지 않는다.** rerun은 파괴적이지 않다 — 원본을 보존하고 새 run을 만든다. 실수로 눌렀다면 새 run을 삭제하면 된다.

### 계보 표시 (Phase 6)
재실행으로 생긴 run은 원본으로 되돌아가는 길을 항상 갖는다.

- 위치는 **상세 헤더의 제목 아래 메타 줄**이다(실행 일시와 같은 줄 계열). 상단 배너·콜아웃을 만들지 마라 — 리포트 상단 배너 금지(원칙 2, ADR-008)와 충돌한다. 계보는 요약이 아니라 **메타데이터**다.
- 규격: `text-xs text-neutral-500`, 원본 run 링크만 링크 색(blue-700)을 쓴다.

```
재실행 — 원본: {원본 아이디어 제목}          · 비교하기
         └ blue-700, /runs/{원본 id}로 이동    └ Text 버튼, 둘 다 완료일 때만
```
- **비교 바로가기는 원본과 이번 run이 둘 다 완료일 때만** 표시한다(`/compare?a={원본}&b={이번}`). 미완료면 비교 뷰가 차단되므로 죽은 링크가 된다.
- 원본이 삭제됐으면(`rerun_of`가 끊긴다) 계보 줄 전체를 그리지 않는다.

### 입력 필드
```
rounded-md bg-white border border-neutral-300 px-4 py-3 text-neutral-900
placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none
```

### 뱃지 (severity / run 상태)
```
inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium
```

### 접기 (Collapsible)
네이티브 `<details>/<summary>` 기반. summary는 text-sm text-neutral-500, 펼친 내용은 본문 스타일.

### RiskRadar
축별 위험도 점수(0~100)를 그리는 인라인 SVG. 차트 라이브러리를 쓰지 않는다(ADR-009).
- 격자·축선: `neutral-200`
- 데이터 폴리곤: stroke는 해당 리포트의 최고 severity 색, fill은 같은 색 opacity 0.08
- 축 라벨: `text-xs text-neutral-500`
- 좌표 애니메이션·트랜지션 금지(정적 SVG). 아이콘 컨테이너로 감싸지 않는다
- `<figure>` + `<figcaption>`(캡션: "축별 최고 위험도")으로 감싸고, **SVG는 컨테이너 안에서 가로 중앙 정렬**한다. 고정폭 SVG를 블록 컨테이너에 그냥 넣으면 좌측에 붙어 컬럼 안에서 치우쳐 보인다
- figure는 카드 골격(`rounded-md border border-neutral-200 p-6`)을 쓴다. 테두리 없이 두면 그림이 허공에 떠 보인다

### SurvivalGauge
최종 판정의 생존 점수(0~100)를 표시한다.
- 트랙: `neutral-200`
- 값 부분: 점수 밴드 색 — 0~39 red-600 / 40~69 amber-600 / 70~100 green-600
- 숫자는 `tabular-nums`

### RiskScoreBadge
기존 뱃지 규격을 따른다.
```
inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium
```
- 점수는 `tabular-nums`
- 리스크 키워드는 뱃지 안에 넣지 않고, 뱃지 옆 `text-xs text-neutral-500`으로 분리 노출한다

## 정보 밀도
원시 데이터는 본문에 나열하지 않는다. 경쟁사 표, YouTube 댓글 원문, 출처 URL 목록은 반드시
`Collapsible`(네이티브 `<details>`) 안에 넣는다. 본문에는 에이전트가 정제한 인사이트 문단만 놓는다.
접힌 영역의 summary에는 건수를 표기한다(예: "경쟁 서비스 12개", "실제 유저 목소리 8건").

## 레이아웃
- 전체 너비: max-w-5xl mx-auto px-6
- 리포트 본문(장문 텍스트): max-w-3xl — 문서 가독 폭 유지
  - 예외: 正/反 Split View 섹션은 `max-w-5xl`을 쓴다. `max-w-3xl`(768px)을 좌우로 나누면 컬럼당 약 360px가 되어 한국어 본문 가독 폭에 못 미친다. 이 섹션만 넓히고, 나머지 장문 섹션은 3xl을 유지한다.
- 정렬: 좌측 정렬 기본. **텍스트의** 중앙 정렬 금지(빈 상태 안내 제외). 단, 차트·다이어그램 같은 **도형(figure)은 자기 컨테이너 안에서 가로 중앙 정렬**한다 — 고정폭 도형을 좌측에 붙이면 컬럼 안에서 치우쳐 보인다
- 간격: 요소 간 gap-3~4, 섹션 간 space-y-10. 리포트 섹션 내부는 gap-6로 통일
- 리포트 목차 네비: 데스크톱 좌측 sticky, 모바일 상단 가로 스크롤
- 한국어 줄바꿈: globals.css가 텍스트 엘리먼트에 `word-break: keep-all`을 전역 적용한다(어절 중간 줄바꿈 방지). 긴 URL 등 끊어야 하는 곳에만 `break-all`을 개별 지정

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-3xl font-semibold text-neutral-900 tracking-tight |
| 섹션 제목 | text-xl font-semibold text-neutral-900 |
| 서브섹션 제목 | text-base font-semibold text-neutral-900 |
| 카드 제목/라벨 | text-sm font-medium text-neutral-500 |
| 본문 | text-[15px] text-neutral-700 leading-[1.8] |
| 번호 목록 | list-decimal pl-6 space-y-5 marker:text-neutral-500 marker:font-medium (항목 내부는 아래 "번호 목록" 절 참조) |
| 불릿 목록 | list-disc pl-5 space-y-2 marker:text-neutral-400 (중첩: list-[circle] pl-5 space-y-1.5) |
| 메타(일시, 카운트) | text-xs text-neutral-500 tabular-nums |
| 인용(커뮤니티 목소리) | text-[15px] text-neutral-700 leading-[1.8], 좌측 2px border-neutral-300 — 내부 여백은 "테두리가 있는 블록" 규격의 레일 인용(`py-1 pl-4`)을 따른다 |

폰트는 시스템 폰트 스택(한국어: Pretendard 있으면 사용, 없으면 system-ui 폴백). 웹폰트 CDN 로드 금지 — 로컬 도구다.

본문 줄간격은 1.8이다. 한국어 장문은 leading-relaxed(1.625)로는 촘촘하다. 입력 필드(TextAreaField)는 본문이 아니라 입력 규격이므로 예외.

에이전트 산출물의 마크다운(**볼드**, `N. **항목:**` 번호 목록, `*   ` 2계층 불릿)은 `web/src/lib/richText.tsx`의 `renderRichText`가 `<p>/<ol>/<ul>`로 변환한다. 이미 `<p>`나 `<li>` 안에 있는 문자열에는 블록 래퍼가 없는 `renderInline`을 쓴다. 산출물 문자열을 그대로 JSX에 넣지 말 것 — `**`가 화면에 노출된다.

### 번호 목록
- 항목 간격은 `space-y-5`다. 본문 줄간격이 1.8이라 `space-y-3`으로는 항목 사이 여백이 줄 사이 여백과 구분되지 않아 경계가 안 보인다.
- 에이전트 산출물의 번호 목록은 `N. **라벨:** 본문…` 꼴이다. **볼드 라벨을 별도 줄로 띄우고, 본문은 그 아래 블록으로 내린다.** 라벨과 본문이 한 줄에 이어붙으면 1·2·3 번호가 있어도 통짜 문단이 되어 스캔이 안 된다.
- 내어쓰기는 `list-decimal`의 기본 동작(marker outside)이 이미 처리한다. 별도 지시가 필요 없다.
- 이 라벨 분리는 **번호 목록에만** 적용한다. 불릿 목록은 항목 전체가 볼드인 경우가 많아, 분리하면 본문 없는 라벨만 남는다.

## 애니메이션
- 허용: fade-in (0.3s, 페이지/섹션 진입), 진행 스테퍼의 현재 step 스피너(animate-spin)
- 그 외 모든 애니메이션 금지 (hover 색 전환 transition-colors 150ms는 예외로 허용)

## 아이콘
- SVG 인라인, strokeWidth 1.5, 크기 16~20px
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다
- 상태 표현: 완료 체크·실패 X·진행 스피너·대기 빈 원 정도로 최소화
