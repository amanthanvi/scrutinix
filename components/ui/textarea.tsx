import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "text-body flex min-h-28 w-full rounded-md border border-[var(--sx-control)] bg-[var(--sx-surface)] px-4 py-3 text-[var(--sx-text)] transition-[border-color] outline-none hover:border-[var(--sx-control-hover)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[var(--sx-danger-border)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
