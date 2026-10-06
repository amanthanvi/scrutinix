"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "sx-btn-press inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent text-meta font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none aria-disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--sx-accent-solid)] text-[var(--sx-accent-fg)] hover:bg-[var(--sx-accent-solid-hover)] disabled:border-[var(--sx-border)] disabled:bg-[var(--sx-subtle)] disabled:text-[var(--sx-text-soft)] aria-disabled:border-[var(--sx-border)] aria-disabled:bg-[var(--sx-subtle)] aria-disabled:text-[var(--sx-text-soft)] aria-disabled:hover:bg-[var(--sx-subtle)]",
        ghost:
          "text-[var(--sx-text-muted)] hover:bg-[var(--sx-subtle)] hover:text-[var(--sx-text)] disabled:opacity-60 aria-disabled:opacity-60",
        outline:
          "border-[var(--sx-control)] bg-[var(--sx-surface)] text-[var(--sx-text)] hover:border-[var(--sx-control-hover)] hover:bg-[var(--sx-subtle)] disabled:opacity-60 aria-disabled:opacity-60",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-2.5",
        icon: "size-9 min-w-11 px-0 py-0",
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
