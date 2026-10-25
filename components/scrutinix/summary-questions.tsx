"use client";

import { Fragment } from "react";

import { cellNames } from "@/components/scrutinix/signal-cell";
import { cellNumber } from "@/components/scrutinix/signal-strip";
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
 * The checks a question cites, by the strip's own cell numbers and names:
 * "From 1 VirusTotal · 3 Safe Browsing". The numbers sit in the strip's
 * hairline tag, so a cited number never reads as a count. Assistive
 * technology hears the plain list ("Sources: VirusTotal, Safe Browsing"),
 * which is also the one text a copy gives: the numbered line is for the eye
 * and can't be selected.
 */
export function QuestionSources({ names }: { names: readonly SignalName[] }) {
  return (
    <p className="sx-sources">
      <span className="sr-only">
        {sourcesLabel(names.length)}:{" "}
        {names.map((name) => cellNames[name]).join(", ")}
      </span>
      <span aria-hidden="true" className="select-none">
        From{" "}
        {names.map((name, index) => (
          <Fragment key={name}>
            {index > 0 ? <span className="sx-sources-sep">·</span> : null}
            <span className="whitespace-nowrap">
              <span className="sx-tag">{cellNumber(name)}</span>
              {cellNames[name]}
            </span>
          </Fragment>
        ))}
      </span>
    </p>
  );
}

/**
 * Summary: five plain questions on a rail. From 64rem each question and
 * the checks it cites hang in a left column, with the answer and why it
 * matters set beside it at reading size; narrower, they stack. A question
 * whose checks are still running holds the room a typical answer takes,
 * so answers fill in place as checks land. No severity colour: the strip
 * and the Full rows carry each check's severity once. Dynamic text wraps
 * anywhere, so a long hostname breaks instead of widening a phone screen.
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
          className="sx-enter sx-question wrap-anywhere"
        >
          <div className="sx-question-rail">
            <h4 id={questionHeadingId(question.id)} tabIndex={-1}>
              {question.question}
            </h4>
            <QuestionSources names={question.sources} />
          </div>
          <div className="sx-answer">
            {question.state === "pending" ? (
              <div className="grid">
                {/*
                 * Holds a typical answer's room, drawn as generated content
                 * so it is never text; "Checking…" sits on its first line.
                 */}
                <div
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1"
                >
                  <p
                    data-stand-in={PLACEHOLDER_SHAPE[question.id].answer}
                    className="before:content-[attr(data-stand-in)]"
                  />
                  <p
                    data-stand-in={PLACEHOLDER_SHAPE[question.id].why}
                    className="before:content-[attr(data-stand-in)]"
                  />
                </div>
                <p className="col-start-1 row-start-1 text-[var(--sx-text-soft)]">
                  {PENDING_ANSWER}
                </p>
              </div>
            ) : (
              <>
                <p className="text-[var(--sx-text)]">{question.answer}</p>
                <p className="text-[var(--sx-text-muted)]">{question.why}</p>
                {question.disagreement ? (
                  <p className="mt-2 text-[var(--sx-text-muted)]">
                    {question.disagreement}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
