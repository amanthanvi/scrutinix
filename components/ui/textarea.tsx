import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "sx-input-glow border-input bg-background text-foreground placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-ring/15 flex min-h-28 w-full rounded-md border px-3 py-2 text-sm transition-[border-color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
