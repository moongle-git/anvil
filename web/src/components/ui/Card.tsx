interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-md border border-neutral-200 bg-white p-6${
        className ? ` ${className}` : ""
      }`}
      {...rest}
    >
      {children}
    </div>
  );
}
