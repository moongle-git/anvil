# UI 디자인 가이드

라이트 문서/리포트 스타일. 화면의 주인공은 컨설팅 리포트의 텍스트 콘텐츠다.

## 디자인 원칙
1. 컨설팅 리포트 문서처럼 읽혀야 한다. 마케팅 페이지가 아니라 인쇄해도 어색하지 않은 보고서. 장식은 가독성을 돕는 선에서만.
2. 결론 우선(역피라미드). 사용자가 스크롤 없이 verdict와 severity 집계를 파악할 수 있어야 한다.
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

### 버튼
```
Primary:   rounded-md bg-neutral-900 text-white hover:bg-neutral-700 px-4 py-2 text-sm font-medium
Secondary: rounded-md bg-white text-neutral-700 border border-neutral-300 hover:bg-neutral-50
Text:      text-neutral-500 hover:text-neutral-900 underline-offset-4 hover:underline
```

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

## 레이아웃
- 전체 너비: max-w-5xl mx-auto px-6
- 리포트 본문(장문 텍스트): max-w-3xl — 문서 가독 폭 유지
- 정렬: 좌측 정렬 기본. 중앙 정렬 금지(빈 상태 안내 제외)
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
| 번호 목록 | list-decimal pl-6 space-y-3 marker:text-neutral-500 marker:font-medium |
| 불릿 목록 | list-disc pl-5 space-y-2 marker:text-neutral-400 (중첩: list-[circle] pl-5 space-y-1.5) |
| 메타(일시, 카운트) | text-xs text-neutral-500 tabular-nums |
| 인용(YouTube 목소리) | text-[15px] text-neutral-700 leading-[1.8], 좌측 2px border-neutral-300 |

폰트는 시스템 폰트 스택(한국어: Pretendard 있으면 사용, 없으면 system-ui 폴백). 웹폰트 CDN 로드 금지 — 로컬 도구다.

본문 줄간격은 1.8이다. 한국어 장문은 leading-relaxed(1.625)로는 촘촘하다. 입력 필드(TextAreaField)는 본문이 아니라 입력 규격이므로 예외.

에이전트 산출물의 마크다운(**볼드**, `N. **항목:**` 번호 목록, `*   ` 2계층 불릿)은 `web/src/lib/richText.tsx`의 `renderRichText`가 `<p>/<ol>/<ul>`로 변환한다. 이미 `<p>`나 `<li>` 안에 있는 문자열에는 블록 래퍼가 없는 `renderInline`을 쓴다. 산출물 문자열을 그대로 JSX에 넣지 말 것 — `**`가 화면에 노출된다.

## 애니메이션
- 허용: fade-in (0.3s, 페이지/섹션 진입), 진행 스테퍼의 현재 step 스피너(animate-spin)
- 그 외 모든 애니메이션 금지 (hover 색 전환 transition-colors 150ms는 예외로 허용)

## 아이콘
- SVG 인라인, strokeWidth 1.5, 크기 16~20px
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다
- 상태 표현: 완료 체크·실패 X·진행 스피너·대기 빈 원 정도로 최소화
