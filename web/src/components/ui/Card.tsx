// 액센트 레일: 카드 한 변만 2px로 강조한다 (UI_GUIDE 정반합 카드 — 미러 액센트 레일).
// 正은 왼쪽 무채색(strong), 反은 오른쪽 severity 색으로 정면 대치를 만든다.
export type AccentSide = "left" | "right";

// Badge와 같은 규율: 컴포넌트는 "의미(tone)"만 다루고 Tailwind 클래스는 이 파일에 격리한다.
// strong = 무채색 강조(正), danger/warning/neutral = severity 팔레트(fatal/major/minor).
export type AccentTone = "strong" | "danger" | "warning" | "neutral";

export interface CardAccent {
  side: AccentSide;
  tone: AccentTone;
}

// 두께(border-l-2)와 색(border-l-*)을 한 변에만 지정한다.
// border-red-600처럼 전체 border 색을 쓰면 기본 골격의 4면이 전부 물든다.
// Tailwind는 클래스 문자열을 정적으로 스캔하므로 조합을 그대로 나열한다.
const ACCENT_CLASSES: Record<AccentSide, Record<AccentTone, string>> = {
  left: {
    strong: "border-l-2 border-l-neutral-900",
    danger: "border-l-2 border-l-red-600",
    warning: "border-l-2 border-l-amber-600",
    neutral: "border-l-2 border-l-gray-500",
  },
  right: {
    strong: "border-r-2 border-r-neutral-900",
    danger: "border-r-2 border-r-red-600",
    warning: "border-r-2 border-r-amber-600",
    neutral: "border-r-2 border-r-gray-500",
  },
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: CardAccent;
  children: React.ReactNode;
}

export function Card({ accent, className, children, ...rest }: CardProps) {
  return (
    <div
      // accent가 없으면 undefined라 속성 자체가 렌더링되지 않는다 — 리포트 밖 화면은 그대로다
      data-accent-side={accent?.side}
      data-accent-tone={accent?.tone}
      className={`rounded-md border border-neutral-200 bg-white p-6${
        accent ? ` ${ACCENT_CLASSES[accent.side][accent.tone]}` : ""
      }${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}
