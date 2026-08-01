import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "sx-font-sans inline-flex items-center rounded-md border px-2 py-0.5 text-[0.65rem] font-semibold tracking-[0.08em] uppercase transition-colors",
  {
    variants: {
      variant: {
        safe: "border-[color-mix(in_srgb,var(--sx-safe)_20%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-safe)_9%,var(--background))] text-[var(--sx-safe-ink)]",
        suspicious:
          "border-[color-mix(in_srgb,var(--sx-suspicious)_22%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-suspicious)_10%,var(--background))] text-[var(--sx-suspicious-ink)]",
        malicious:
          "border-[color-mix(in_srgb,var(--sx-malicious)_22%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-malicious)_10%,var(--background))] text-[var(--sx-malicious-ink)]",
        critical:
          "border-[color-mix(in_srgb,var(--sx-critical)_22%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-critical)_10%,var(--background))] text-[var(--sx-critical-ink)]",
        active:
          "border-[color-mix(in_srgb,var(--sx-info)_22%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-info)_10%,var(--background))] text-[var(--sx-info-ink)]",
        error:
          "border-[color-mix(in_srgb,var(--sx-error)_22%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-error)_10%,var(--background))] text-[var(--sx-error-ink)]",
        skipped:
          "border-[var(--sx-border)] bg-transparent text-[var(--sx-text-soft)]",
        neutral:
          "border-[var(--sx-border)] bg-secondary text-[var(--sx-text-muted)]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge };
