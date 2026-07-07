// 시맨틱 톤 → UI_GUIDE 데이터/시맨틱 색상(옅은 배경 + 진한 텍스트)으로 매핑한다.
// 컴포넌트는 "의미(tone)"만 다루고 정확한 Tailwind 클래스는 이 파일의 내부 구현으로 격리한다.
// 덕분에 리스타일이 뱃지 계약(fatal=위험 등)을 깨지 않는다.
export type BadgeTone = "danger" | "warning" | "success" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  success: "border-green-200 bg-green-50 text-green-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  neutral: "border-gray-200 bg-gray-50 text-gray-600",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: BadgeTone;
}

export function Badge({ tone, className, children, ...rest }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </span>
  );
}
