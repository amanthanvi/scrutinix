"use client";

import { useEffect, useId, useRef, useState } from "react";

import { LinkAnatomyView } from "@/components/scrutinix/link-anatomy";
import { Input } from "@/components/ui/input";
import { getLoadedLinkParser, useLinkAnatomy } from "@/hooks/use-link-anatomy";
import { compareExpectedSite } from "@/lib/domain/expected-site";
import type { LinkAnatomy } from "@/lib/domain/link-anatomy";
import { cn } from "@/lib/utils";

/**
 * The link in the field, taken apart before any scan: which site it
 * belongs to, with each part named, and a look-alike stated plainly. It
 * appears as soon as the field holds a valid web link and steps aside once
 * that link's result (or scan) is on screen, where the result's own
 * anatomy says the same thing.
 */
export function InputAnatomy({ url }: { url: string }) {
  const { anatomy } = useLinkAnatomy(url);
  if (!anatomy) return null;

  return (
    <section aria-label="The link, taken apart" className="flex flex-col gap-3">
      <LinkAnatomyView
        id="sx-input-anatomy"
        url={url}
        anatomy={anatomy}
        captions
      />
      <ExpectedSite anatomy={anatomy} />
    </section>
  );
}

/**
 * "Expecting a particular site?": one optional field, answered instantly
 * in the browser ("Matches paypal.com." / "This link belongs to
 * secure-login.xyz, not paypal.com.").
 */
function ExpectedSite({ anatomy }: { anatomy: LinkAnatomy }) {
  const [open, setOpen] = useState(false);
  const [expected, setExpected] = useState("");
  const fieldId = useId();
  const answerId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  // The button that opened the field is gone: move focus into the field
  // rather than let it fall to the page.
  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);
  const parse = getLoadedLinkParser();
  const comparison =
    open && parse ? compareExpectedSite(parse, anatomy, expected) : null;

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="text-meta sx-link -my-2 inline-flex min-h-11 items-center self-start"
      >
        Expecting a particular site?
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className="text-meta font-medium text-[var(--sx-text)]"
      >
        Which site were you expecting?
      </label>
      <Input
        id={fieldId}
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        ref={fieldRef}
        value={expected}
        onChange={(event) => setExpected(event.target.value)}
        placeholder="paypal.com or PayPal"
        aria-describedby={answerId}
        className="text-body h-11 max-w-sm"
      />
      <p
        id={answerId}
        aria-live="polite"
        className={cn(
          // A long typed domain or name breaks rather than widen a phone.
          "text-body min-h-6 wrap-anywhere",
          comparison?.outcome === "mismatch"
            ? "font-medium text-[var(--sx-text)]"
            : "text-[var(--sx-text-muted)]",
        )}
      >
        {comparison?.sentence ?? ""}
      </p>
    </div>
  );
}
