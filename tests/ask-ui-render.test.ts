// The Ask sheet's pieces, rendered to HTML in plain Node: every reply kind and state shows,
// answers are text nodes (never markdown or HTML), links are only the fixed ones, helplines
// are tel: buttons, code's words sit above the AI text, and long words wrap.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { allowAppImports } from "./support/app.ts";
import { allowTsx } from "./support/tsx.ts";

// next/link has no ESM entry Node can load outside Next; a plain anchor is what it renders anyway.
(globalThis as { __h?: typeof createElement }).__h = createElement;
allowAppImports({
  "next/link":
    "export default function Link({ href, prefetch, replace, scroll, children, ...rest }) { return globalThis.__h('a', { href, ...rest }, children); }",
});
allowTsx();
const P = await import("../components/platform/AskParts.tsx");
const { AskButton } = await import("../components/platform/AskButton.tsx");
const { AskAbout } = await import("../components/platform/AskAbout.tsx");
const { stackItemPrefill } = await import("../components/platform/ask-starters.ts");
const C = await import("../components/platform/ask-copy.ts");
type AskTurn = import("../lib/ask/types.ts").AskTurn;
type AskNotice = import("../lib/ask/types.ts").AskNotice;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const noop = () => {};
/** The text as a reader sees it: React escapes quotes and apostrophes in markup. */
const seen = (markup: string) => markup.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const turn = (over: Partial<AskTurn> = {}): AskTurn => ({
  id: "t1",
  clientKey: "11111111-1111-4111-8111-111111111111",
  question: "What should I eat before a run?",
  at: "2026-11-19T10:00:00.000Z",
  kind: "answer",
  answer: "A banana and curd.\nAn hour before.",
  notice: null,
  links: [{ id: "log_meal", href: "/fuel" }],
  lang: "en",
  removed: null,
  stale: false,
  demo: false,
  ...over,
});
const html = (t: AskTurn) => renderToStaticMarkup(createElement("ol", null, createElement(P.TurnView, { turn: t, onGo: noop })));
const doctorNotice: AskNotice = {
  level: "doctor",
  label: "Doctor first",
  parts: ["doctor_marker"],
  lines: ["Vitamin D: flagged on your report. Show a doctor before you take anything for it."],
  markers: [{ name: "Vitamin D", status: "low", flag: "doctor" }],
  calls: [],
};

describe("reply kinds", () => {
  it("an answer: question as a heading, the AI eyebrow, text with its line breaks, and fixed link labels", () => {
    const out = html(turn());
    assert.match(out, /<h3 dir="auto"[^>]*>What should I eat before a run\?<\/h3>/);
    assert.ok(out.includes(C.ASK_COPY.eyebrow));
    assert.match(out, /<p dir="auto" lang="en" class="[^"]*whitespace-pre-line[^"]*\[overflow-wrap:anywhere\]/);
    assert.ok(out.includes("A banana and curd.\nAn hour before."), "line breaks kept as text");
    assert.match(out, /<a [^>]*href="\/fuel"[^>]*>Log a meal<\/a>/);
  });

  it("renders model text as text: tags and markdown come out literally", () => {
    const out = html(turn({ answer: '<img src=x onerror=alert(1)> **bold** [link](https://evil.example)' }));
    assert.ok(out.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(out.includes("**bold** [link](https://evil.example)"));
    assert.doesNotMatch(out, /<img|<strong|href="https:\/\/evil/);
  });

  it("a 1,200-character word can wrap anywhere, so it can't widen a 320 px screen", () => {
    const out = html(turn({ answer: "x".repeat(1200), question: "y".repeat(300) }));
    assert.equal((out.match(/\[overflow-wrap:anywhere\]/g) ?? []).length >= 2, true);
  });

  it("off-topic: graphite text and no links", () => {
    const out = html(turn({ kind: "off_topic", answer: "That's outside what D-Human covers.", links: [] }));
    assert.match(out, /text-graphite">That&#x27;s outside/);
    assert.doesNotMatch(out, /<a /);
  });

  it("doctor: code's notice above the AI text, the ! square, the marker's glyph first, a faint haem wash", () => {
    const out = html(turn({ kind: "doctor", notice: doctorNotice, answer: "Ask about your level." }));
    assert.ok(out.indexOf("Doctor first") < out.indexOf(C.ASK_COPY.eyebrow), "notice first");
    assert.match(out, />!<\/span>Doctor first/);
    assert.match(out, /glyph glyph-out[^>]*><\/span><span class="sr-only">Below range: <\/span><span>Vitamin D: flagged/);
    assert.match(out, /background:rgb\(227 165 162 \/ 0\.10\)/);
  });

  it("urgent: no AI text, even if some arrives, and a tel: button", () => {
    const notice: AskNotice = {
      level: "urgent",
      label: "Get advice today",
      parts: ["symptom"],
      lines: ["That can be serious. See a doctor today. If it's sudden, severe or getting worse, call 112 now."],
      markers: [],
      calls: ["112"],
    };
    const out = html(turn({ kind: "urgent", notice, answer: "AI text that must not show", links: [] }));
    assert.doesNotMatch(out, /AI text that must not show/);
    assert.ok(!out.includes(C.ASK_COPY.eyebrow));
    assert.match(out, /<a href="tel:112" class="button-ghost h-11">Call 112<\/a>/);
    assert.match(out, /border border-paper/);
  });

  it("crisis: calm, with no label, no ! and no wash, and both helplines as tel: buttons", () => {
    const notice: AskNotice = {
      level: "crisis",
      label: null,
      parts: ["crisis"],
      lines: ["You don't have to face this alone. Tele-MANAS, the government's toll-free mental health line, answers any time, in many Indian languages: 14416. If you might act on these thoughts now, call 112."],
      markers: [],
      calls: ["14416", "112"],
    };
    const out = html(turn({ kind: "crisis", notice, answer: null, links: [] }));
    assert.match(out, /href="tel:14416"[^>]*>Call 14416</);
    assert.match(out, /href="tel:112"[^>]*>Call 112</);
    assert.doesNotMatch(out, />!<\/span>/);
    assert.doesNotMatch(out, /background:/);
    assert.ok(!out.includes(C.ASK_COPY.eyebrow));
  });

  it("a removed answer keeps the question and says why", () => {
    const out = html(turn({ removed: "report_deleted", answer: null, links: [] }));
    assert.ok(seen(out).includes(C.ASK_COPY.removed));
    assert.ok(out.includes("What should I eat before a run?"));
  });

  it("a stale answer says so above it, in graphite", () => {
    const out = html(turn({ stale: true }));
    assert.ok(out.indexOf(C.ASK_COPY.stale) < out.indexOf("A banana"));
    assert.match(out, /text-graphite">A banana/);
  });

  it("a demo answer says it's a demo", () => {
    assert.ok(html(turn({ demo: true })).includes(C.ASK_COPY.demoEyebrow));
  });

  it("links: only those that pass askLinkOk, labelled from the fixed table", () => {
    const out = renderToStaticMarkup(
      createElement(P.LinkButtons, {
        links: [
          { id: "stack", href: "/stack" },
          { id: "home", href: "https://evil.example" },
          { id: "report", href: "/reports/0d2c3c5e-0000-4000-8000-000000000000" },
        ] as never,
        onGo: noop,
      }),
    );
    assert.match(out, />Open your stack</);
    assert.match(out, />Open your report</);
    assert.doesNotMatch(out, /evil/);
  });
});

describe("states", () => {
  it("in flight: the question and Working on it, then the slow line", () => {
    assert.ok(renderToStaticMarkup(createElement(P.PendingTurn, { question: "x", slow: false })).includes(C.ASK_COPY.working));
    const slow = renderToStaticMarkup(createElement(P.PendingTurn, { question: "x", slow: true }));
    assert.ok(slow.includes(C.ASK_COPY.workingSlow));
    assert.match(slow, /motion-reduce:animate-none/);
  });

  it("empty: lead, what it doesn't use, and starters as full-width rows", () => {
    const out = renderToStaticMarkup(
      createElement(P.EmptyState, { withReport: true, reading: true, service: null, starters: [{ key: "matters", text: "What matters most?" }], onStarter: noop }),
    );
    assert.ok(out.includes(C.ASK_COPY.leadReport));
    assert.ok(seen(out).includes(C.ASK_COPY.doesntUse));
    assert.ok(seen(out).includes(C.ASK_COPY.reading));
    assert.ok(out.includes(C.ASK_COPY.tryOne));
    assert.match(out, /<button type="button" dir="auto" class="flex min-h-11 w-full[^"]*">What matters most\?<\/button>/);
    const none = renderToStaticMarkup(createElement(P.EmptyState, { withReport: false, reading: false, service: C.ASK_ERROR_WORDS.ai_off, starters: [], onStarter: noop }));
    assert.ok(none.includes(C.ASK_COPY.leadNoReport));
    assert.ok(none.includes("Ask is switched off for now."));
    assert.ok(!none.includes(C.ASK_COPY.tryOne));
  });

  it("the consent notice in the contract's words, with Got it", () => {
    const out = renderToStaticMarkup(createElement(P.ConsentNotice, { onAccept: noop, busy: false, failed: true }));
    assert.ok(out.includes("Ask sends your question to Claude, an AI model made by Anthropic"));
    assert.ok(out.includes("That processing happens outside India."));
    assert.ok(out.includes(">Got it<"));
    assert.ok(seen(out).includes(C.ASK_COPY.consentFailed));
  });

  it("errors in plain words; Try again only where it resends the same key; sign-in returns here", () => {
    const retry = { clientKey: "k", question: "x", about: null };
    const failed = renderToStaticMarkup(createElement(P.ErrorLine, { error: { code: "failed", retry }, path: "/stack", onRetry: noop }));
    assert.ok(seen(failed).includes("Couldn't answer that just now. It didn't count. Try again."));
    assert.match(failed, />Try again</);
    assert.match(failed, /role="alert"/);
    const busy = renderToStaticMarkup(createElement(P.ErrorLine, { error: { code: "busy", retry: null }, path: "/stack", onRetry: noop }));
    assert.ok(busy.includes("Still answering your last question."));
    assert.doesNotMatch(busy, />Try again</);
    const out = renderToStaticMarkup(createElement(P.ErrorLine, { error: { code: "signed_out", retry: null }, path: "/fuel/past", onRetry: noop }));
    assert.match(out, /href="\/signin\?next=%2Ffuel%2Fpast"/);
  });

  it("every error has words, and none shows server text", () => {
    for (const [code, words] of Object.entries(C.ASK_ERROR_WORDS)) assert.ok(words && !/error\.message|undefined/.test(words), code);
  });

  it("pinned lines: the urgent hold with its !, and someone else's report with Manage reports", () => {
    const out = renderToStaticMarkup(createElement(P.PinnedLines, { urgent: ["Haemoglobin", "eGFR"], printedFor: "Ravi Kumar", onGo: noop }));
    assert.match(out, /class="error-mark[^"]*">Haemoglobin and eGFR need medical advice today\. Until a doctor has seen them, Ask only answers questions about using the app and logging meals\.</);
    assert.ok(seen(out).includes("Your latest report is printed for Ravi Kumar. Answers about markers treat it as yours."));
    assert.match(out, /href="\/reports"[^>]*>Manage reports</);
    assert.equal(renderToStaticMarkup(createElement(P.PinnedLines, { urgent: [], printedFor: null, onGo: noop })), "");
  });

  it("the About chip: the marker's glyph first, and a named 44 px remove", () => {
    const out = renderToStaticMarkup(
      createElement(P.AboutChipView, { about: { request: { type: "marker", id: "m" }, name: "Ferritin", status: "edge_low" }, onRemove: noop }),
    );
    assert.match(out, /glyph glyph-edge[^>]*><\/span><span class="truncate" dir="auto">About: Ferritin</);
    assert.match(out, /aria-label="Remove Ferritin from this question" class="[^"]*h-11 w-11/);
  });

  it("Jump to: fixed labels and real hrefs", () => {
    const out = renderToStaticMarkup(createElement(P.JumpRow, { links: [{ id: "past_meals", href: "/fuel/past" }], onGo: noop }));
    assert.match(out, /Jump to<\/span><a [^>]*href="\/fuel\/past"[^>]*>Past meals</);
  });

  it("the disclosure names 112 only in India", () => {
    assert.ok(renderToStaticMarkup(createElement(P.Disclosure, { region: "in" })).includes("Emergency? Call 112."));
    assert.ok(renderToStaticMarkup(createElement(P.Disclosure, { region: "other" })).includes("call your local emergency number"));
  });
});

describe("entry points", () => {
  it("the top-bar control: a dialog opener with its full name, marked for the tour, no badge", () => {
    const out = renderToStaticMarkup(createElement(AskButton));
    assert.match(out, /aria-haspopup="dialog"/);
    assert.match(out, /aria-expanded="false"/);
    assert.ok(out.includes(`aria-label="${C.ASK_COPY.controlName}"`));
    assert.match(out, /data-tour="ask"/);
    assert.match(out, /class="group\/ctl flex h-11/, "a 44 px target");
  });

  it("Ask about this is a button that opens the sheet, at least 44 px tall", () => {
    const out = renderToStaticMarkup(createElement(AskAbout, { prefill: stackItemPrefill("Magnesium"), label: C.ASK_COPY.aboutThis }));
    assert.match(out, /<button type="button" aria-haspopup="dialog" class="link-quiet inline-flex min-h-11[^"]*">Ask about this<\/button>/);
  });
});

describe("copy", () => {
  it("the counter, the limit line and the pinned words", () => {
    assert.equal(C.counterText(null), null);
    assert.equal(C.counterText(5), "5 questions a day");
    assert.equal(C.counterText(3), "3 left today");
    assert.equal(C.counterText(0), "None left today");
    assert.equal(C.limitLine("in", "2026-11-19T18:30:00.000Z"), "That's your 5 questions for today. 5 more at midnight.");
    assert.equal(C.limitLine("other", "2026-11-19T18:30:00.000Z", "Europe/London"), "That's your 5 questions for today. 5 more at 6:30 pm.");
    assert.equal(C.urgentPinned(["Haemoglobin"]), "Haemoglobin needs medical advice today. Until a doctor has seen it, Ask only answers questions about using the app and logging meals.");
    assert.equal(C.askRegionOf(null), "in");
    assert.equal(C.askRegionOf("Asia/Calcutta"), "in");
    assert.equal(C.askRegionOf("Europe/London"), "other");
  });

  it("reads the notice before the answer to screen readers", () => {
    assert.equal(
      C.announceAnswer({ notice: doctorNotice, answer: "Ask about your level." }, 3),
      "Answer. Vitamin D: flagged on your report. Show a doctor before you take anything for it. Ask about your level. 3 left today",
    );
  });

  it("never says free, accurate or doctor-reviewed, and never 'I'", () => {
    const all = [...Object.values(C.ASK_COPY), ...Object.values(C.ASK_ERROR_WORDS)].join("\n");
    assert.doesNotMatch(all.replace("toll-free", ""), /\bfree\b|accurate|doctor-reviewed|reviewed by|\bI\b/i);
  });
});

describe("static checks on Ask's browser files", () => {
  const files = readdirSync(path.join(root, "components/platform")).filter((f) => /^(Ask|ask-)/.test(f));

  it("has the files, and none renders HTML or markdown or caches", () => {
    assert.ok(files.length >= 10, files.join());
    for (const f of files) {
      const src = readFileSync(path.join(root, "components/platform", f), "utf8");
      assert.doesNotMatch(src, /dangerouslySetInnerHTML|innerHTML|react-markdown|marked|remark|"use cache"|unstable_cache|cacheLife/, f);
    }
  });

  it("talks to the server only through send()", () => {
    for (const f of files) {
      const src = readFileSync(path.join(root, "components/platform", f), "utf8");
      assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|from "@\/lib\/(platform|ai|db)/, f);
    }
  });

  it("every #anchor link has its target on the page", () => {
    const settings = ["components/platform/Settings.tsx", "components/platform/Paywall.tsx", "components/platform/EmailSettings.tsx"].map((f) => readFileSync(path.join(root, f), "utf8")).join("\n");
    assert.match(settings, /id="plan"/);
    assert.match(settings, /id="emails"/);
  });
});
