interface CollapsibleProps {
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Collapsible({
  summary,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  return (
    <details open={defaultOpen}>
      <summary className="cursor-pointer text-sm text-neutral-500 transition-colors hover:text-neutral-900">
        {summary}
      </summary>
      <div className="mt-3 text-[15px] leading-relaxed text-neutral-700">
        {children}
      </div>
    </details>
  );
}
