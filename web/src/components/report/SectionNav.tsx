// 리포트 섹션 순서(근거→진단→처방→수익화)는 PRD가 정한 내러티브 — 바꾸지 않는다.
export const REPORT_SECTIONS = [
  { id: "market", label: "① 시장 맥락" },
  { id: "thesis", label: "② 낙관적 논제" },
  { id: "criticism", label: "③ 냉정한 반론" },
  { id: "solution", label: "④ 종합과 재설계" },
  { id: "monetization", label: "⑤ 비즈니스 모델" },
] as const;

// 앵커 목차. 위치(데스크톱 좌측 sticky / 모바일 상단 가로)는 부모 레이아웃이 정한다.
export function SectionNav() {
  return (
    <nav aria-label="리포트 목차">
      <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
        {REPORT_SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
