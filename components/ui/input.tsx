import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "text-body flex min-h-11 w-full rounded-md border border-[var(--sx-control)] bg-[var(--sx-surface)] px-4 py-1 text-[var(--sx-text)] transition-[border-color] outline-none hover:border-[var(--sx-control-hover)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--sx-danger-border)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
