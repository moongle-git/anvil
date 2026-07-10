"use client";

import { useId } from "react";

interface TextAreaFieldProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextAreaField({
  label,
  id,
  className,
  ...rest
}: TextAreaFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="text-sm font-medium text-neutral-500">
        {label}
      </label>
      <textarea
        id={fieldId}
        className={`w-full rounded-md border border-neutral-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none${
          className ? ` ${className}` : ""
        }`}
        {...rest}
      />
    </div>
  );
}
