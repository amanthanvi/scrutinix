"use client";

import { Fragment } from "react";

import { cellNames } from "@/components/scrutinix/signal-cell";
import {
  PENDING_ANSWER,
  sourcesLabel,
  type SummaryQuestion,
  type SummaryQuestionId,
} from "@/lib/domain/summary-questions";
import type { SignalName } from "@/lib/domain/types";

/** Focus target for a strip cell activated in Summary. */
export function questionHeadingId(id: SummaryQuestionId): string {
  return `sx-question-${id}`;
}

/**
 * The checks a question cites, by their strip cell names. One component,
 * so a later layer can cite numbered cells in one place.
 */
export function QuestionSources({ names }: { names: readonly SignalName[] }) {
  return (
    <p className="text-caption text-[var(--sx-text-soft)]">
      {sourcesLabel(names.length)}:{" "}
      {names.map((name, index) => (
        <Fragment key={name}>
          {index > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
            </>
          ) : null}
          {cellNames[name]}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Summary: five plain questions, each a heading with its answer, why it
 * matters, any disagreement, and its sources. A question whose checks are
 * still running holds its space with a quiet placeholder, so answers fill
 * in place as checks land. No severity colour: the strip and the Full rows
 * carry each check's severity once.
 */
export function SummaryQuestionList({
  questions,
}: {
  questions: readonly SummaryQuestion[];
}) {
  return (
    <ul
      aria-label="Questions"
      className="divide-y divide-[var(--sx-border)] border-b border-[var(--sx-border)]"
    >
      {questions.map((question) => (
        <li
          key={question.id}
          data-question={question.id}
          aria-busy={question.state === "pending" || undefined}
          className="sx-enter flex flex-col gap-1 py-4"
        >
          <h4
            id={questionHeadingId(question.id)}
            tabIndex={-1}
            className="scroll-mt-4 text-sm font-medium text-[var(--sx-text)] outline-offset-4"
          >
            {question.question}
          </h4>
          {question.state === "pending" ? (
            <>
              <p className="text-body text-[var(--sx-text-soft)]">
                {PENDING_ANSWER}
              </p>
              {/* Holds the why line's space so nothing moves when it lands. */}
              <p aria-hidden="true" className="invisible text-sm">
                &nbsp;
              </p>
            </>
          ) : (
            <>
              <p className="text-body max-w-[62ch] text-[var(--sx-text)]">
                {question.answer}
              </p>
              <p className="max-w-[62ch] text-sm text-[var(--sx-text-muted)]">
                {question.why}
              </p>
              {question.disagreement ? (
                <p className="max-w-[62ch] text-sm text-[var(--sx-text-muted)]">
                  {question.disagreement}
                </p>
              ) : null}
            </>
          )}
          <div className="mt-1">
            <QuestionSources names={question.sources} />
          </div>
        </li>
      ))}
    </ul>
  );
}
