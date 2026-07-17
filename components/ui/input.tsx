import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "sx-input-glow border-input bg-background text-foreground placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-ring/15 flex h-9 w-full rounded-md border px-3 py-1 text-sm transition-[border-color,box-shadow] outline-none selection:bg-[color-mix(in_srgb,var(--sx-active-accent)_20%,transparent)] file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
