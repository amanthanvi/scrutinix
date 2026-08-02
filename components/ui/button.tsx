"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "sx-btn-press inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent text-[0.8125rem]/relaxed font-medium whitespace-nowrap outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--sx-accent)] text-[var(--sx-accent-fg)] hover:opacity-90 disabled:bg-muted disabled:text-[var(--sx-text-soft)] disabled:opacity-100",
        ghost:
          "text-[var(--sx-text-muted)] hover:bg-muted hover:text-foreground",
        outline: "border-border text-foreground hover:bg-muted",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2",
        icon: "size-8 min-w-11 px-0 py-0",
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
