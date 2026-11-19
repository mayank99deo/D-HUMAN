// The Ask sheet's pieces, with no state of their own (AskSheet.tsx holds it), so each one
// can be rendered in a test. Answers are text nodes only: no markdown, no HTML, no links
// inside the text (threats spec D13). Code's own words sit above the AI text, with their
// glyphs, and phone numbers are tel: buttons, because numbers in text aren't tappable here.
import Link from "next/link";
import type { MouseEvent, Ref } from "react";
import { askLinkOf, askLinkOk, type AskLink, type AskNotice, type AskNoticeLevel, type AskRegion, type AskTurn } from "@/lib/ask/types";
import {
  ASK_COPY,
  ASK_ERROR_WORDS,
  callLabel,
  chipRemove,
  chipText,
  disclosure,
  glyphFor,
  printedForPinned,
  statusText,
  urgentPinned,
} from "./ask-copy";
import type { UiError } from "./ask-state";
import type { AboutChip, Starter } from "./ask-starters";

export type Go = (e: MouseEvent<HTMLAnchorElement>, href: string) => void;

/** The "!" square from the verdict's Doctor first mark. */
function Bang() {
  return (
    <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center bg-paper text-xs font-black text-ink">
      !
    </span>
  );
}

// Blood-derived washes, faint, only beside the "!" glyph (house rules). None for crisis.
const WASH: Record<AskNoticeLevel, string | undefined> = { doctor: "rgb(227 165 162 / 0.10)", urgent: "rgb(227 165 162 / 0.16)", crisis: undefined };

/** Code's fixed words for a turn: doctor, urgent or crisis. Crisis is calm on purpose: no wash, no "!". */
export function NoticeBlock({ notice, focusRef }: { notice: AskNotice; focusRef?: Ref<HTMLDivElement> }) {
  const crisis = notice.level === "crisis";
  return (
    <div
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
      data-notice={notice.level}
      className={`mt-3 p-4 outline-none ${notice.level === "doctor" ? "border border-line-strong" : "border border-paper"}`}
      style={WASH[notice.level] ? { background: WASH[notice.level] } : undefined}
    >
      {notice.label && !crisis && (
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Bang />
          {notice.label}
        </p>
      )}
      {notice.lines.map((line, i) => {
        // A line about a flagged marker starts with its name: its status glyph goes first.
        const m = notice.markers.find((x) => line.startsWith(x.name));
        return (
          <p key={i} className={`flex gap-2 text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere] ${i || (notice.label && !crisis) ? "mt-2" : ""}`}>
            {m && (
              <>
                <span aria-hidden className={`glyph ${glyphFor(m.status)} mt-[0.55rem]`} />
                <span className="sr-only">{statusText(m.status)}: </span>
              </>
            )}
            <span>{line}</span>
          </p>
        );
      })}
      {notice.calls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {notice.calls.map((c) => (
            <a key={c} href={`tel:${c}`} className="button-ghost h-11">
              {callLabel(c)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** A real link into the app, labelled from the fixed table. Anything that fails askLinkOk isn't shown. */
export function LinkButtons({ links, onGo }: { links: AskLink[]; onGo: Go }) {
  const ok = links.filter((l) => askLinkOk(l));
  if (!ok.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {ok.map((l) => (
        <Link key={l.id} href={l.href} onClick={(e) => onGo(e, l.href)} className="button-ghost h-11">
          {askLinkOf(l.id).label}
        </Link>
      ))}
    </div>
  );
}

const quietKinds = new Set(["off_topic"]);

/** One question and its reply. No bubbles, avatars or times: it reads as a page of notes. */
export function TurnView({ turn, onGo, noticeRef }: { turn: AskTurn; onGo: Go; noticeRef?: Ref<HTMLDivElement> }) {
  const removed = turn.removed === "report_deleted";
  const showAnswer = !removed && turn.answer != null && turn.answer !== "" && turn.kind !== "urgent" && turn.kind !== "crisis";
  return (
    <li data-turn={turn.id} className="scroll-mt-2 border-t border-line py-5 first:border-t-0">
      <h3 dir="auto" className="font-semibold [overflow-wrap:anywhere]">
        {turn.question}
      </h3>
      {turn.stale && !removed && <p className="mt-2 text-sm text-graphite">{ASK_COPY.stale}</p>}
      {removed ? (
        <p className="mt-2 text-graphite">{ASK_COPY.removed}</p>
      ) : (
        <>
          {turn.notice && <NoticeBlock notice={turn.notice} focusRef={noticeRef} />}
          {showAnswer && (
            <>
              <p className="mt-3 text-xs text-graphite">{turn.demo ? ASK_COPY.demoEyebrow : ASK_COPY.eyebrow}</p>
              <p
                dir="auto"
                lang={turn.lang}
                className={`mt-1 whitespace-pre-line text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere] ${quietKinds.has(turn.kind) || turn.stale ? "text-graphite" : ""}`}
              >
                {turn.answer}
              </p>
            </>
          )}
          <LinkButtons links={turn.links} onGo={onGo} />
        </>
      )}
    </li>
  );
}

/** A question on its way: its words and a still hairline when motion is reduced. */
export function PendingTurn({ question, slow }: { question: string; slow: boolean }) {
  return (
    <li aria-busy="true" className="border-t border-line py-5 first:border-t-0">
      <h3 dir="auto" className="font-semibold [overflow-wrap:anywhere]">
        {question}
      </h3>
      <p className="mt-3 text-sm text-graphite">{slow ? ASK_COPY.workingSlow : ASK_COPY.working}</p>
      <div aria-hidden className="mt-3 h-px overflow-hidden bg-line">
        <div className="h-px w-1/3 animate-pulse bg-paper motion-reduce:animate-none" />
      </div>
    </li>
  );
}

/** Lines that stay at the top while they apply: an urgent result, or someone else's report. */
export function PinnedLines({ urgent, printedFor, onGo }: { urgent: string[]; printedFor: string | null; onGo: Go }) {
  if (!urgent.length && !printedFor) return null;
  return (
    <div className="space-y-3 border-b border-line py-3">
      {urgent.length > 0 && <p className="error-mark border border-paper px-3 py-2 text-sm">{urgentPinned(urgent)}</p>}
      {printedFor && (
        <div className="text-sm">
          <p>{printedForPinned(printedFor)}</p>
          <Link href="/reports" onClick={(e) => onGo(e, "/reports")} className="link-quiet -mb-2 inline-flex min-h-11 items-center">
            {ASK_COPY.manageReports}
          </Link>
        </div>
      )}
    </div>
  );
}

/** The empty sheet: what Ask is, what it doesn't use, and three starters that fill the box. */
export function EmptyState({
  withReport,
  reading,
  service,
  starters,
  onStarter,
}: {
  withReport: boolean;
  reading: boolean;
  /** "Ask is switched off for now." or resting until midnight. */
  service: string | null;
  /** None at the limit: the box only finds screens then. */
  starters: Starter[];
  onStarter: (s: Starter) => void;
}) {
  return (
    <div className="py-5">
      <p className="group-data-[compact]/ask:hidden">{withReport ? ASK_COPY.leadReport : ASK_COPY.leadNoReport}</p>
      <p className="mt-2 text-sm text-graphite group-data-[compact]/ask:hidden">{ASK_COPY.doesntUse}</p>
      {reading && <p className="mt-3 text-sm">{ASK_COPY.reading}</p>}
      {service && <p className="error-mark mt-3 text-sm">{service}</p>}
      {starters.length > 0 && (
        <>
          <p className="mt-6 text-sm text-graphite">{ASK_COPY.tryOne}</p>
          <ul className="mt-2 border-b border-line">
            {starters.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => onStarter(s)}
                  dir="auto"
                  className="flex min-h-11 w-full items-center border-t border-line py-2.5 text-left text-[0.9375rem] active:bg-lift"
                >
                  {s.text}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Shown in place of the box until the person has read how Ask uses their data. */
export function ConsentNotice({ onAccept, busy, failed }: { onAccept: () => void; busy: boolean; failed: boolean }) {
  return (
    <div className="border border-line-strong p-4">
      <p className="text-[0.9375rem] leading-relaxed">{ASK_COPY.consent}</p>
      {failed && (
        <p role="alert" className="error-mark mt-2 text-sm">
          {ASK_COPY.consentFailed}
        </p>
      )}
      <button type="button" onClick={onAccept} disabled={busy} className="button-primary mt-3 h-11 px-5">
        {ASK_COPY.consentButton}
      </button>
    </div>
  );
}

/** Errors sit just above the box, in plain words, never the server's own text. */
export function ErrorLine({ error, path, onRetry }: { error: UiError; path: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-2 text-sm">
      <p className="error-mark">{ASK_ERROR_WORDS[error.code]}</p>
      {error.retry && (
        <button type="button" onClick={onRetry} className="link-quiet inline-flex min-h-11 items-center">
          {ASK_COPY.retry}
        </button>
      )}
      {error.code === "signed_out" && (
        <Link href={`/signin?next=${encodeURIComponent(path)}`} className="button-ghost mt-2 h-11">
          {ASK_COPY.signIn}
        </Link>
      )}
      {error.code === "not_onboarded" && (
        <Link href="/onboarding" className="button-ghost mt-2 h-11">
          {ASK_COPY.finishSetup}
        </Link>
      )}
    </div>
  );
}

/** "About: Magnesium", with a marker's status glyph first: the only colour outside notices. */
export function AboutChipView({ about, onRemove }: { about: AboutChip; onRemove: () => void }) {
  return (
    <div className="mb-2 flex max-w-full items-center">
      <span className="flex h-9 min-w-0 items-center gap-2 border border-line pl-3 pr-1 text-sm">
        {about.status && <span aria-hidden className={`glyph ${glyphFor(about.status)}`} />}
        <span className="truncate" dir="auto">
          {chipText(about.name)}
        </span>
        <button type="button" onClick={onRemove} aria-label={chipRemove(about.name)} className="-my-1 grid h-11 w-11 shrink-0 place-items-center text-graphite">
          <span aria-hidden>×</span>
        </button>
      </span>
    </div>
  );
}

/** "Jump to" and up to two screens: free, and it never counts. */
export function JumpRow({ links, onGo }: { links: AskLink[]; onGo: Go }) {
  if (!links.length) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="text-sm text-graphite">{ASK_COPY.jumpTo}</span>
      {links.map((l) => (
        <Link key={l.id} href={l.href} onClick={(e) => onGo(e, l.href)} className="button-ghost h-11">
          {askLinkOf(l.id).label}
        </Link>
      ))}
    </div>
  );
}

export function Disclosure({ region }: { region: AskRegion }) {
  return <p className="mt-2 text-xs text-graphite group-data-[compact]/ask:hidden">{disclosure(region)}</p>;
}
