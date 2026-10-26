"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { announce } from "@/components/ui/announcer";

type NoticeOptions = {
  description?: ReactNode;
  action?: { label: ReactNode; onClick: () => void };
  duration?: number;
  closeButton?: boolean;
};
let fallbackNotice: { title: ReactNode; options?: NoticeOptions } | null = null;
function showFallback(title: ReactNode, options?: NoticeOptions) {
  fallbackNotice = { title, options };
  listeners.forEach((listener) => listener());
}
const fallbackToast = Object.assign(showFallback, {
  success: showFallback,
  error: showFallback,
});
let loaded: ReturnType<typeof loadToaster> | undefined;
function loadToaster() {
  return import("@/components/ui/sonner").catch(() => ({
    default: FallbackToaster,
    toast: fallbackToast,
  }));
}
const load = () => (loaded ??= loadToaster());
const Toaster = lazy(load);
let requested = false;
let mounted = false;
const listeners = new Set<() => void>();
let ready: Promise<void> | undefined;
let markReady: (() => void) | undefined;

/**
 * A notification is spoken by the page's own status region (`announce`):
 * its title and a plain-text description, once. Sonner's region is muted
 * (`components/ui/sonner.tsx`), since VoiceOver ignored it and TalkBack
 * read it twice.
 */
function spoken(show: (title: ReactNode, options?: NoticeOptions) => unknown) {
  return (title: ReactNode, options?: NoticeOptions) => {
    announce(
      [title, options?.description]
        .filter((part) => typeof part === "string")
        .join(" "),
    );
    return show(title, options);
  };
}

// Wait for Sonner's subscription before publishing the first notification.
export async function getToast() {
  ready ??= new Promise<void>((resolve) => {
    markReady = resolve;
  });
  requested = true;
  listeners.forEach((listener) => listener());
  const { toast } = await load();
  if (!mounted) await ready;
  return Object.assign(spoken(toast), {
    success: spoken(toast.success),
    error: spoken(toast.error),
  });
}

export function toasterReady() {
  mounted = true;
  markReady?.();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function LazyToaster() {
  const enabled = useSyncExternalStore(
    subscribe,
    () => requested,
    () => false,
  );
  useEffect(
    () => () => {
      mounted = false;
      ready = undefined;
    },
    [],
  );
  return enabled ? (
    <Suspense fallback={null}>
      <Toaster />
    </Suspense>
  ) : null;
}

// Keep critical copy/share fallbacks usable even when the optional chunk fails.
function FallbackToaster() {
  const notice = useSyncExternalStore(
    subscribe,
    () => fallbackNotice,
    () => null,
  );
  useEffect(toasterReady, []);
  if (!notice) return null;
  // Spoken by the status region, like every notification.
  return (
    <div
      data-notice=""
      className="text-meta fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-md border border-[var(--sx-control)] bg-[var(--sx-surface)] p-4 text-[var(--sx-text)] shadow-[0_6px_20px_-8px_rgb(0_0_0/0.25)]"
    >
      <p className="font-medium">{notice.title}</p>
      <div className="mt-2">{notice.options?.description}</div>
      <div className="mt-2 flex gap-3">
        {notice.options?.action ? (
          <button
            type="button"
            className="min-h-11 underline"
            onClick={notice.options.action.onClick}
          >
            {notice.options.action.label}
          </button>
        ) : null}
        <button
          type="button"
          className="min-h-11 underline"
          onClick={() => {
            fallbackNotice = null;
            listeners.forEach((listener) => listener());
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
