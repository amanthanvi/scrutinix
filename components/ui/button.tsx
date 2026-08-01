"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "sx-btn-press group/button sx-font-sans inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--sx-active-accent)] text-[var(--sx-accent-fg)] hover:opacity-90",
        ghost:
          "text-[var(--sx-text-muted)] hover:bg-muted hover:text-foreground dark:hover:bg-muted/60",
        subtle:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_srgb,var(--secondary)_88%,transparent)]",
        danger:
          "border-[color-mix(in_srgb,var(--sx-malicious)_22%,var(--sx-border))] bg-[color-mix(in_srgb,var(--sx-malicious)_8%,var(--background))] text-[var(--sx-malicious-ink)] hover:bg-[color-mix(in_srgb,var(--sx-malicious)_12%,var(--background))] focus-visible:border-[color-mix(in_srgb,var(--sx-malicious)_55%,var(--sx-border))] focus-visible:ring-[color-mix(in_srgb,var(--sx-malicious)_18%,transparent)]",
        dangerSolid:
          "bg-[var(--sx-malicious)] text-destructive-foreground hover:opacity-90",
        tab: "text-[var(--sx-text-muted)] hover:bg-muted hover:text-foreground data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        view: "text-[var(--sx-text-muted)] hover:bg-muted hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      },
      size: {
        default:
          "h-7 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        sm: "h-6 px-2 text-xs/relaxed [&_svg:not([class*='size-'])]:size-3",
        icon: "size-7 px-0 py-0",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
