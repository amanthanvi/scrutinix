"use client";

import { cellNames } from "@/components/scrutinix/signal-cell";
import {
  PENDING_ANSWER,
  PLACEHOLDER_SHAPE,
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
 * so a later layer can cite numbered cells in one place. The comma is the
 * one textual separator (read aloud, and what a copy gives); the dot is
 * drawn by `.sx-source` and is neither selectable nor spoken.
 */
export function QuestionSources({ names }: { names: readonly SignalName[] }) {
  return (
    <p className="text-caption text-[var(--sx-text-soft)]">
      {sourcesLabel(names.length)}:{" "}
      {names.map((name, index) => (
        <span key={name} className="sx-source">
          {index > 0 ? (
            <>
              <span className="sr-only">,</span>{" "}
            </>
          ) : null}
          {cellNames[name]}
        </span>
      ))}
    </p>
  );
}

/**
 * Summary: five plain questions, each a heading with its answer, why it
 * matters, any disagreement, and its sources. A question whose checks are
 * still running holds the room a typical answer takes, so answers fill in
 * place as checks land. No severity colour: the strip and the Full rows
 * carry each check's severity once. Dynamic text wraps anywhere, so a long
 * hostname breaks instead of widening a phone screen.
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
          className="sx-enter flex flex-col gap-1 py-4 wrap-anywhere"
        >
          <h4
            id={questionHeadingId(question.id)}
            tabIndex={-1}
            className="scroll-mt-4 text-sm font-medium text-[var(--sx-text)] outline-offset-4"
          >
            {question.question}
          </h4>
          {question.state === "pending" ? (
            <div className="grid">
              {/*
               * Holds a typical answer's room, drawn as generated content so
               * it is never text; "Checking…" sits on its first line.
               */}
              <div
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 flex flex-col gap-1"
              >
                <p
                  data-stand-in={PLACEHOLDER_SHAPE[question.id].answer}
                  className="text-body max-w-[62ch] before:content-[attr(data-stand-in)]"
                />
                <p
                  data-stand-in={PLACEHOLDER_SHAPE[question.id].why}
                  className="max-w-[62ch] text-sm before:content-[attr(data-stand-in)]"
                />
              </div>
              <p className="text-body col-start-1 row-start-1 text-[var(--sx-text-soft)]">
                {PENDING_ANSWER}
              </p>
            </div>
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
