export type ButtonVariant = "primary" | "secondary" | "text";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700",
  secondary:
    "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50",
  text: "text-sm font-medium text-neutral-500 underline-offset-4 transition-colors hover:text-neutral-900 hover:underline",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = "primary",
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={`${VARIANT_CLASSES[variant]}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {children}
    </button>
  );
}
