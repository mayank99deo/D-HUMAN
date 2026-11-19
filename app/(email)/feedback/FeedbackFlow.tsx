"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { OFFLINE, send } from "@/components/platform/net";
import { ANSWER_TEXT, CONTACT_LABEL, FLOW, QUESTION_NOTE, QUESTION_TEXT, TEXT_COUNTER_FROM, TEXT_PLACEHOLDER, nextQuestion, type ChoiceQuestion } from "@/lib/email/feedback-survey";
import { FEEDBACK_TEXT_MAX, type FeedbackPath, type FeedbackQuestion } from "@/lib/email/types";

// The survey, one question at a time. Every answer is a real form button posting to
// /api/feedback, and Back and Skip are real links, so it all works without JavaScript
// (the server answers 303 to the next question). With JavaScript the page stays put and
// the next question slides in.
//
// Arriving from the email, the tapped answer shows as chosen but isn't saved: one tap on
// "Save and continue" (or on any answer) saves it. Opening the link alone saves nothing.

type Step = FeedbackQuestion | "done";
type Source = "email_tap" | "page";
type Saved = Partial<Record<ChoiceQuestion, string>>;
type Reply = { status: "saved" | "unchanged" | "conflict"; next: FeedbackQuestion | null };

export type FeedbackFlowProps = {
  token: string;
  sendId: string | null;
  path: FeedbackPath;
  firstName: string | null;
  saved: Saved;
  hasNote: boolean;
  start: Step;
  pending: string | null;
};

// Progress runs pale to full green, like the orbit's ticks.
const LIGHT = [214, 235, 221];
const DEEP = [47, 158, 91];
const green = (t: number) => {
  const c = LIGHT.map((l, i) => Math.round(l + (DEEP[i] - l) * Math.min(1, Math.max(0, t))));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
};

const SAVE_FAILED = "We couldn't save that. Try again in a moment.";
const CLOSED = "This link has closed: questions stay open for 30 days after the email.";
const AGAIN = "Tap your answer once more to save it.";
const NPS_ROWS = [
  ["0", "1", "2", "3", "4", "5"],
  ["6", "7", "8", "9", "10"],
];

const stepHref = (token: string, at: Step) => `/feedback?t=${encodeURIComponent(token)}&at=${at}`;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const OPTION =
  "flex min-h-13 w-full items-center justify-between gap-3 border border-line-strong px-4 py-3 text-left font-semibold transition-colors hover:border-paper active:bg-white/10 aria-pressed:border-paper aria-pressed:bg-paper aria-pressed:text-ink disabled:cursor-progress";
const SCORE =
  "flex h-13 items-center justify-center border border-line-strong font-semibold tabular-nums transition-colors hover:border-paper active:bg-white/10 aria-pressed:border-paper aria-pressed:bg-paper aria-pressed:text-ink disabled:cursor-progress";

export function FeedbackFlow(props: FeedbackFlowProps) {
  const { token, sendId, path, firstName } = props;
  const flow = FLOW[path];
  const [at, setAt] = useState<Step>(props.start);
  const [saved, setSaved] = useState<Saved>(props.saved);
  const [hasNote, setHasNote] = useState(props.hasNote);
  const [pending, setPending] = useState(props.pending);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [contact, setContact] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);
  const moved = useRef(false);
  const focusText = useRef(false);

  // Keep only the link in the address bar: the tapped answer and the send id (e) were
  // for this visit, and shouldn't be copied or shared along with it.
  useEffect(() => {
    try {
      window.history.replaceState(null, "", `/feedback?t=${encodeURIComponent(token)}`);
    } catch {
      // Some in-app browsers refuse; the page works the same.
    }
  }, [token]);

  // After a move, put focus on the new question (or in the box, after "Something else").
  useEffect(() => {
    if (!moved.current) return;
    if (at === "text" && focusText.current) {
      focusText.current = false;
      textBox.current?.focus();
    } else {
      heading.current?.focus();
    }
  }, [at]);

  function go(step: Step) {
    moved.current = true;
    setMessage(null);
    setChosen(null);
    setPending(null);
    setAt(step);
  }

  const answered = (q: FeedbackQuestion) => (q === "text" ? hasNote : saved[q] !== undefined);
  const arriving = at === flow[0] && pending !== null;
  const source: Source = arriving ? "email_tap" : "page";

  async function choose(question: ChoiceQuestion, answer: string) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setChosen(answer);
    const r = await send<Reply>("/api/feedback", {
      body: { t: token, question, answer, path, source, ...(source === "email_tap" && sendId ? { e: sendId } : {}) },
    });
    setBusy(false);
    if (!r.ok) {
      setChosen(null);
      setMessage(r.offline ? OFFLINE : r.data.error === "bad_link" ? CLOSED : SAVE_FAILED);
      return;
    }
    if (r.data.status === "conflict") {
      setChosen(null);
      setPending(null);
      setSaved((s) => ({ ...s, [question]: undefined }));
      setMessage(AGAIN);
      return;
    }
    setSaved((s) => ({ ...s, [question]: answer }));
    // A short beat with the tick showing, then the next question.
    if (!reducedMotion()) await pause(350);
    if (question === "build" && answer === "other") focusText.current = true;
    go(r.data.next ?? nextQuestion(path, question, answer) ?? "done");
  }

  async function sendNote() {
    if (busy) return;
    if (!text.trim()) {
      go("done");
      return;
    }
    setBusy(true);
    setMessage(null);
    const r = await send<Reply>("/api/feedback", { body: { t: token, question: "text", answer: text, path, source: "page", contactOk: contact } });
    setBusy(false);
    if (!r.ok) {
      setMessage(r.offline ? OFFLINE : r.data.error === "bad_link" ? CLOSED : r.data.error === "too_long" ? `Please keep it under ${FEEDBACK_TEXT_MAX.toLocaleString("en-IN")} characters.` : SAVE_FAILED);
      return;
    }
    setHasNote(true);
    setText("");
    go("done");
  }

  const index = at === "done" ? flow.length : flow.indexOf(at);

  return (
    <div className="flex flex-1 flex-col">
      <p className="text-sm text-graphite">{at === "done" ? "All done" : `${index + 1} of ${flow.length}`}</p>
      <div className="mt-3 flex gap-1.5" aria-hidden>
        {flow.map((q, i) => (
          <span key={q} className="h-1 flex-1 transition-colors duration-300" style={{ background: answered(q) ? green(flow.length > 1 ? i / (flow.length - 1) : 1) : "var(--color-line-strong)" }} />
        ))}
      </div>

      <div key={at} className="fact-in pt-10 sm:pt-14">
        {at === "done" ? (
          <>
            <h1 ref={heading} tabIndex={-1} className="headline text-[clamp(2rem,7vw,2.75rem)] outline-none">
              Thank you{firstName ? `, ${firstName}` : ""}. That&apos;s everything.
            </h1>
            <p className="mt-4 text-graphite">We read every answer, and when we build something you asked for, we&apos;ll tell you in a wrap email.</p>
            <Link href="/home" className="button-primary mt-8 h-13 w-full">
              Back to D-Human
            </Link>
            <a
              href={stepHref(token, flow[0])}
              onClick={(e) => {
                e.preventDefault();
                go(flow[0]);
              }}
              className="link-quiet mt-4 inline-flex min-h-11 items-center text-sm"
            >
              Change an answer
            </a>
          </>
        ) : (
          <>
            <h1 id="fb-question" ref={heading} tabIndex={-1} className="headline text-[clamp(1.75rem,6vw,2.5rem)] outline-none">
              {QUESTION_TEXT[at]}
            </h1>
            {QUESTION_NOTE[at] && (
              <p id="fb-note" className="mt-3 text-graphite">
                {QUESTION_NOTE[at]}
              </p>
            )}
            {arriving && <p className="mt-3 text-graphite">You picked this in the email. Save it to go on, or tap another answer.</p>}

            {at === "text" ? (
              <form
                method="post"
                action="/api/feedback"
                className="mt-8"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendNote();
                }}
              >
                <Hidden token={token} question="text" path={path} source="page" />
                <textarea
                  ref={textBox}
                  name="answer"
                  rows={6}
                  maxLength={FEEDBACK_TEXT_MAX}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={TEXT_PLACEHOLDER}
                  aria-labelledby="fb-question"
                  aria-describedby="fb-note"
                  className="textarea"
                />
                {text.length >= TEXT_COUNTER_FROM && (
                  <p className="mt-2 text-right text-sm text-graphite" aria-live="polite">
                    {text.length.toLocaleString("en-IN")} of {FEEDBACK_TEXT_MAX.toLocaleString("en-IN")}
                  </p>
                )}
                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="checkbox" name="contactOk" value="on" checked={contact} onChange={(e) => setContact(e.target.checked)} className="size-5 shrink-0 accent-white" />
                  <span>{CONTACT_LABEL}</span>
                </label>
                {hasNote && <p className="mt-2 text-sm text-graphite">Your note is saved. Sending another replaces it.</p>}
                <button type="submit" disabled={busy} className="button-primary mt-6 h-13 w-full">
                  {busy ? "Sending…" : text.trim() ? "Send" : "Finish"}
                </button>
              </form>
            ) : (
              <form method="post" action="/api/feedback" className="mt-8">
                <Hidden token={token} question={at} path={path} source={source} sendId={source === "email_tap" ? sendId : null} />
                {at === "nps" ? (
                  <div role="group" aria-labelledby="fb-question">
                    {NPS_ROWS.map((row, r) => (
                      <div key={r} className={r === 0 ? "" : "mt-3"}>
                        <div className="grid grid-cols-6 gap-2">
                          {row.map((n) => (
                            <AnswerButton key={n} className={SCORE} value={n} label={`${n} out of 10`} pressed={(chosen ?? saved.nps) === n} busy={busy} onChoose={() => choose("nps", n)}>
                              {n}
                            </AnswerButton>
                          ))}
                        </div>
                        <p className="mt-1.5 grid grid-cols-6 text-sm text-graphite" aria-hidden>
                          {r === 0 ? <span className="col-span-3">Not likely</span> : <span className="col-span-5 text-right">Very likely</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div role="group" aria-labelledby="fb-question" className="grid gap-2.5">
                    {Object.entries(ANSWER_TEXT[at]).map(([value, label]) => {
                      const shown = chosen ?? (arriving ? pending : null) ?? saved[at] ?? null;
                      const isSaved = saved[at] === value && (chosen === null || chosen === value);
                      return (
                        <AnswerButton key={value} className={OPTION} value={value} pressed={shown === value} busy={busy} onChoose={() => choose(at, value)}>
                          <span>{label}</span>
                          {isSaved && (
                            <span className="shrink-0 text-sm font-semibold">
                              <span aria-hidden>✓ </span>Saved
                            </span>
                          )}
                        </AnswerButton>
                      );
                    })}
                  </div>
                )}
                {arriving && pending && (
                  <button
                    type="submit"
                    name="answer"
                    value={pending}
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault();
                      void choose(at, pending);
                    }}
                    className="button-primary mt-6 h-13 w-full"
                  >
                    {busy ? "Saving…" : saved[at] === pending ? "Continue" : "Save and continue"}
                  </button>
                )}
              </form>
            )}

            {message && (
              <p role="alert" className="error-mark mt-4 text-sm">
                {message}
              </p>
            )}

            <div className="mt-6 flex items-center justify-between gap-4 text-sm">
              {index > 0 ? (
                <StepLink token={token} to={flow[index - 1]} onGo={go}>
                  Back
                </StepLink>
              ) : (
                <span />
              )}
              {!arriving && at !== "text" && (
                <StepLink token={token} to={nextQuestion(path, at) ?? "done"} onGo={go}>
                  Skip
                </StepLink>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Hidden({ token, question, path, source, sendId }: { token: string; question: FeedbackQuestion; path: FeedbackPath; source: Source; sendId?: string | null }) {
  return (
    <>
      <input type="hidden" name="t" value={token} />
      <input type="hidden" name="question" value={question} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="source" value={source} />
      {sendId && <input type="hidden" name="e" value={sendId} />}
    </>
  );
}

/** A submit button for one answer: without JavaScript it posts the form, with it the page saves in place. */
function AnswerButton({
  value,
  label,
  pressed,
  busy,
  onChoose,
  className,
  children,
}: {
  value: string;
  label?: string;
  pressed: boolean;
  busy: boolean;
  onChoose: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      name="answer"
      value={value}
      aria-pressed={pressed}
      aria-label={label}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        onChoose();
      }}
      className={className}
    >
      {children}
    </button>
  );
}

function StepLink({ token, to, onGo, children }: { token: string; to: Step; onGo: (step: Step) => void; children: React.ReactNode }) {
  return (
    <a
      href={stepHref(token, to)}
      onClick={(e) => {
        e.preventDefault();
        onGo(to);
      }}
      className="link-quiet inline-flex min-h-11 items-center"
    >
      {children}
    </a>
  );
}
