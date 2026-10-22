"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ScrutinixErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Scrutinix] Unhandled error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="py-4">
          <p className="text-sm font-medium text-[var(--sx-text)]">
            Something went wrong.
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-6 text-[var(--sx-text-muted)]">
            An unexpected error occurred. Reload the page and retry the scan.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="sx-btn-press mt-3 inline-flex h-8 items-center justify-center rounded-md bg-[var(--sx-accent)] px-3 text-[0.8125rem] font-medium text-[var(--sx-accent-fg)] hover:opacity-90"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
