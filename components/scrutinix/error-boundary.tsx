"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ScrutinixErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Scrutinix] Unhandled error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-xl border px-5 py-5 sm:px-7"
          style={{
            backgroundColor: "var(--sx-error-surface)",
            borderColor: "var(--sx-error-edge)",
          }}
        >
          <p className="text-lead font-semibold text-[var(--sx-text)]">
            This part of the page stopped working.
          </p>
          <p className="text-body mt-1.5 text-[var(--sx-text-muted)]">
            {this.state.error?.message
              ? `${this.state.error.message.replace(/\.?$/, ".")} `
              : ""}
            Reload the page to try again; your saved history is not affected.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="sx-btn-press text-meta mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-[var(--sx-accent-solid)] px-4 font-medium text-[var(--sx-accent-fg)] hover:bg-[var(--sx-accent-solid-hover)]"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
