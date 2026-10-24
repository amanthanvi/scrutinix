"use client";

import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";

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
        // The band's shape on the Error surface: squared, under its rule.
        <div
          role="alert"
          className="sx-band px-5 pt-[1.625rem] pb-5 sm:px-11 sm:pt-9 sm:pb-7"
          style={
            {
              backgroundColor: "var(--sx-error-surface)",
              "--sx-pending": "var(--sx-error)",
            } as CSSProperties
          }
        >
          <p className="sm:text-question font-serif text-[1.25rem] leading-[1.3] font-semibold text-[var(--sx-text)]">
            This part of the page stopped working.
          </p>
          <p className="text-body mt-2 text-[var(--sx-error-ink)]">
            Reload the page to try again; your saved history is not affected.
          </p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="sx-btn-press text-body mt-5 inline-flex min-h-12 items-center justify-center rounded-md bg-[var(--sx-button)] px-5 font-semibold text-[var(--sx-button-fg)] hover:bg-[var(--sx-button-hover)]"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
