"use client";

import { useSyncExternalStore } from "react";

/*
 * One polite status region, in the page from the first paint (the root
 * layout renders it), for what isn't the scan's own progress or verdict:
 * notifications, a link arriving from outside, the expected-site answer.
 * A live region inserted with its message is announced unreliably
 * (VoiceOver said nothing when Sonner's mounted with the first toast), so
 * this one is always there and only its text changes.
 */

/** Long enough to be read, then cleared so a reading cursor never meets it. */
export const ANNOUNCEMENT_MS = 7_000;

let message = "";
let timers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<() => void>();

function show(text: string) {
  message = text;
  listeners.forEach((listener) => listener());
}

/**
 * Say `text` once, politely. The region is emptied first, so the same
 * words again (a second Share) are still a change and are spoken again.
 */
export function announce(text: string) {
  timers.forEach(clearTimeout);
  show("");
  if (!text) return;
  timers = [
    setTimeout(() => {
      show(text);
      timers = [setTimeout(() => show(""), ANNOUNCEMENT_MS)];
    }, 100),
  ];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function Announcer() {
  const text = useSyncExternalStore(
    subscribe,
    () => message,
    () => "",
  );
  return (
    <p role="status" className="sr-only">
      {text}
    </p>
  );
}
