interface SectionHeadingProps {
  id?: string;
  children: React.ReactNode;
}

// id는 리포트 목차 네비의 앵커 타겟 — scroll-mt로 상단 여백 확보
export function SectionHeading({ id, children }: SectionHeadingProps) {
  return (
    <h2 id={id} className="scroll-mt-6 text-xl font-semibold text-neutral-900">
      {children}
    </h2>
  );
}
