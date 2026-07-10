"use client";

import { useEffect, useState } from "react";

// 리포트 5단계 순차 논증 서사 순서 (ADR-008 결론 후치): 시장 맥락 → 正 → 反 → 合 → 최종 판정.
export const REPORT_SECTIONS = [
  { id: "market", label: "① 시장 맥락" },
  { id: "thesis", label: "② 낙관적 가설 (正)" },
  { id: "antithesis", label: "③ 냉정한 비판 (反)" },
  { id: "solution", label: "④ 인사이트 및 재설계 (合)" },
  { id: "verdict", label: "⑤ 최종 판정" },
] as const;

// 현재 뷰포트에 있는 섹션 id를 추적한다. IntersectionObserver가 없는 환경(jsdom 기본)에서는
// 강조 없이 정적 목차로 동작한다 — 가드 없이 호출하면 테스트가 죽는다 (throw 금지).
function useActiveSection(): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target.id);
        } else {
          visible.delete(entry.target.id);
        }
      }
      // 서사 순서(REPORT_SECTIONS)에서 가장 앞선 교차 섹션을 현재로 삼는다.
      // 正(thesis)/反(antithesis)은 데스크톱에서 같은 스크롤 위치라, 먼저 나오는 thesis가
      // 결정적으로 우선한다. 모바일에서는 실제로 분리돼 있어 자연히 구분된다.
      const current = REPORT_SECTIONS.find((section) => visible.has(section.id));
      setActiveId(current?.id ?? null);
    });

    for (const section of REPORT_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el !== null) {
        observer.observe(el);
      }
    }

    return () => observer.disconnect();
  }, []);

  return activeId;
}

// 앵커 목차. 위치(데스크톱 좌측 sticky / 모바일 상단 가로)는 부모 레이아웃이 정한다.
// 현재 섹션 강조는 색이 아니라 굵기 + 좌측 보더(무채색)로 표현한다 (UI_GUIDE 원칙 3).
export function SectionNav() {
  const activeId = useActiveSection();

  return (
    <nav aria-label="리포트 목차">
      <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
        {REPORT_SECTIONS.map((section) => {
          const active = section.id === activeId;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active ? "location" : undefined}
                className={[
                  "block whitespace-nowrap border-l-2 px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-neutral-900 font-medium text-neutral-900"
                    : "border-transparent text-neutral-500 hover:text-neutral-900",
                ].join(" ")}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
