interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

// 중앙 정렬은 빈 상태 안내에만 허용된다 (UI_GUIDE 레이아웃)
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-6 py-16 text-center">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      {description ? (
        <p className="text-[15px] leading-relaxed text-neutral-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
