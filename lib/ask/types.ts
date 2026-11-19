// Ask, the in-app helper: the shapes, limits and rules every lane builds on (A: data,
// limits and route; B: the AI; C: the UI). Types, constants and a few small pure helpers
// only, so server code, client components and tests can all import it. Lanes import this
// file and never edit it; a change goes through the contract first.
// Contract: docs/team/specs/2026-11-19-ask-build.md. Background: the four 2026-11-19 ask-*
// specs beside it (UX, AI, data, threats).
//
// Mayank's decisions of 2026-11-19 that live here: 5 questions a person per IST day for
// everyone, outside the plan; off-topic answers count; code-written urgent and crisis
// replies don't; failures hand the question back, with at most 10 model calls a person a
// day; the server makes ids; one question in flight; questions kept for today only;
// founders first (BLOG_OWNER_EMAILS) until ASK_OPEN=all.

import { ownerEmails } from "../auth/owners.ts";
import type { MarkerStatus } from "../domain/markers.ts";
import type { Targets } from "../domain/nutrition.ts";
import type { PlanView } from "../domain/plan.ts";
import type { Flag, Level } from "../domain/safety.ts";
import type { DietPicture, MealKind, Totals } from "../platform/food.ts";

// ── Limits ──────────────────────────────────────────────────────────────────

export const ASK_LIMITS = {
  /** Questions a person may use per IST day. */
  perDay: 5,
  /** Model calls a person may start per IST day, failures included, so failures can't be farmed. */
  modelCallsPerDay: 10,
  /** After cleaning, in code points. Refused, never cut. */
  questionMinChars: 2,
  questionMaxChars: 300,
  questionMaxBytes: 2000,
  /** A request body over this is refused before it's parsed. */
  bodyMaxBytes: 4096,
  /** Code's cap on the AI text (the prompt aims lower); cut at the last full sentence that fits. */
  answerMaxWords: 80,
  answerMaxChars: 1200,
  linksMax: 2,
  /** Earlier question-and-answer pairs from today sent with a follow-up. */
  earlierTurns: 2,
  /** A question still pending after this is dead: hidden from GET and handed back by the next claim. Longer than the route's 30 s. */
  pendingStaleSeconds: 45,
  /** All model work for one question, retries included. */
  aiDeadlineMs: 20_000,
  /** How long the browser waits for POST before it checks GET for the answer. */
  clientTimeoutMs: 25_000,
  /** While a question is still pending, the browser asks GET again this often. */
  pollEveryMs: 2_000,
  /** Days of questions kept before today's: 0 means the daily job deletes them the next morning. */
  keepDays: 0,
  /** ASK_DAILY_MAX when unset or not a whole number: model calls a day across everyone. */
  dailyMaxDefault: 2000,
  /** The founders get one email when the day's model calls reach this share of ASK_DAILY_MAX, and one when it's reached. */
  alertAt: 0.8,
  /** In-memory speed bumps per server instance; the database caps are the real limits. */
  burstPerPersonPerMinute: 6,
  burstPerIpPer10Minutes: 30,
  getPerPersonPerMinute: 60,
} as const;

// ── Kinds ───────────────────────────────────────────────────────────────────
// Code decides the kind; the model's label is a hint that may raise it, never lower it.

export const ASK_TURN_KINDS = ["answer", "off_topic", "doctor", "urgent", "crisis"] as const;
export type AskTurnKind = (typeof ASK_TURN_KINDS)[number];

/** What POST answers with: a turn's kind, or "limit" when the day's questions are used (no turn). */
export const ASK_KINDS = [...ASK_TURN_KINDS, "limit"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

/** The floor's order. answer and off_topic share the bottom rung: one never turns into the other by raising. */
export const KIND_RANK: Record<AskTurnKind, number> = { answer: 0, off_topic: 0, doctor: 1, urgent: 2, crisis: 3 };

/** Kinds that use one of the day's questions. Urgent and crisis replies are code's own words, so they're free. */
export const ASK_COUNTED_KINDS: readonly AskTurnKind[] = ["answer", "off_topic", "doctor"];
export const countsAgainstDay = (kind: AskTurnKind) => ASK_COUNTED_KINDS.includes(kind);

// ── Links ───────────────────────────────────────────────────────────────────
// The model returns ids only. The server turns them into hrefs (the report link needs the
// newest ready report's id); the browser takes labels from here and drops any link that
// fails askLinkOk. English labels, like every other button in the app for now.

export const ASK_LINKS = [
  { id: "log_meal", label: "Log a meal", path: "/fuel" },
  { id: "past_meals", label: "Past meals", path: "/fuel/past" },
  { id: "usual_day", label: "Describe a usual day", path: "/fuel?usual=1" },
  { id: "upload", label: "Upload a report", path: "/upload" },
  { id: "report", label: "Open your report", path: "/reports/" }, // + the newest ready report's id
  { id: "reports", label: "Your reports", path: "/reports" },
  { id: "home", label: "Home", path: "/home" },
  { id: "stack", label: "Open your stack", path: "/stack" },
  { id: "wraps", label: "Your wraps", path: "/wraps" },
  { id: "settings", label: "Your profile", path: "/settings" },
  { id: "plan", label: "Your plan", path: "/settings#plan" },
  { id: "emails", label: "Email settings", path: "/settings#emails" },
  { id: "sources", label: "Sources and safety", path: "/sources-and-safety" },
] as const;
export type AskLinkId = (typeof ASK_LINKS)[number]["id"];
export const ASK_LINK_IDS = ASK_LINKS.map((l) => l.id) as [AskLinkId, ...AskLinkId[]];

export const isAskLinkId = (id: unknown): id is AskLinkId => typeof id === "string" && (ASK_LINK_IDS as readonly string[]).includes(id);
export const askLinkOf = (id: AskLinkId) => ASK_LINKS.find((l) => l.id === id)!;

/** Report ids are UUIDs (lib/auth/crypto.ts newId). */
const REPORT_HREF = /^\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The server's href for a link id, or null when it can't go anywhere (the report link with no ready report). */
export function askLinkHref(id: AskLinkId, newestReportId: string | null): string | null {
  if (id !== "report") return askLinkOf(id).path;
  const href = newestReportId ? `/reports/${newestReportId}` : null;
  return href && REPORT_HREF.test(href) ? href : null;
}

/** The browser's check before it shows a link: a known id whose href is exactly that id's path (or the report pattern). */
export function askLinkOk(link: { id: unknown; href: unknown }): link is AskLink {
  if (!isAskLinkId(link.id) || typeof link.href !== "string") return false;
  return link.id === "report" ? REPORT_HREF.test(link.href) : link.href === askLinkOf(link.id).path;
}

export type AskLink = { id: AskLinkId; href: string };

// ── Notices: code's fixed words, shown above any AI text ───────────────────

export type AskNoticeLevel = "doctor" | "urgent" | "crisis";

/** Which fixed lines a notice carries. The words are in lib/domain/ask-notices.ts (Lane B); the contract §7 fixes them. */
export const ASK_NOTICE_PARTS = [
  "doctor_marker", // a doctor-flagged marker the question touches
  "urgent_marker", // an urgent-flagged marker the question touches
  "urgent_hold", // an urgent result stands and the question isn't about the app or logging meals
  "symptom", // a symptom that may need care today
  "crisis", // self-harm, suicide, purging
  "medicine", // starting, stopping or changing a medicine
  "pregnancy", // pregnant or breastfeeding, about supplements
  "dose", // a dose that isn't in their stack
  "low_calorie", // a plan to eat far too little
  "doctor_general", // the model or a filter says doctor, with no more specific line
] as const;
export type AskNoticePart = (typeof ASK_NOTICE_PARTS)[number];

/** tel: buttons, written by code (the root layout turns off phone-number detection in text). India only. */
export type AskCall = "112" | "14416";

export type AskNoticeMarker = { name: string; status: MarkerStatus; flag: Flag };

export type AskNotice = {
  /** The highest of its parts. */
  level: AskNoticeLevel;
  /** "Doctor first", "Get advice today", or null for crisis (calm on purpose). */
  label: string | null;
  parts: AskNoticePart[];
  /** Fixed sentences in order. English for now (Mayank, 2026-11-19). */
  lines: string[];
  /** Flagged markers it names, catalogue names, for their status glyphs. */
  markers: AskNoticeMarker[];
  calls: AskCall[];
};

// ── Requests ────────────────────────────────────────────────────────────────

/** "Ask about this": what the person tapped. The server looks each one up in their own data and ignores what it can't find. */
export type AskAboutRequest =
  | { type: "marker"; id: string } // markers.id
  | { type: "meal"; id: string } // food_logs.id
  | { type: "stack_item"; nutrient: string } // as the Stack card shows it; matched against their current stack
  | { type: "gaps" };

/** POST /api/ask. Strict: unknown keys are refused. */
export type AskRequest = {
  /** A UUID the browser makes for this question and sends again on "Try again", so a question is counted once. Never the turn's id. */
  clientKey: string;
  question: string;
  about?: AskAboutRequest;
};

// ── Responses ───────────────────────────────────────────────────────────────

/** One question and its reply, as GET and POST return it. */
export type AskTurn = {
  /** Made by the server. */
  id: string;
  clientKey: string;
  question: string;
  /** When it was asked, ISO. */
  at: string;
  kind: AskTurnKind;
  /** AI text, plain, line breaks kept. Null for urgent and crisis, when a filter took it out (doctor only), and once removed. */
  answer: string | null;
  notice: AskNotice | null;
  /** At most 2. Empty once removed. */
  links: AskLink[];
  /** BCP 47 for the answer text: "en", "hi", "hi-Latn", "ta", … */
  lang: string;
  /** A report delete blanked this answer (it used report data). The question stays. */
  removed: "report_deleted" | null;
  /** Asked before the newest report was read or the current stack was built; it may not fit them now. */
  stale: boolean;
  /** Answered by the local mock, not Claude. */
  demo: boolean;
};

type AskDayFields = {
  /** Questions left today, 0 to 5. 0 also once 10 model calls are used. */
  left: number;
  /** The IST day, YYYY-MM-DD. */
  day: string;
  /** The next midnight IST, ISO. */
  resetsAt: string;
};

/** POST 200. "limit" carries no turn and saved nothing; every other kind carries the saved turn. A repeat of an answered clientKey returns that turn again, counting nothing. */
export type AskPostOk = AskDayFields & ({ kind: "limit"; turn: null } | { kind: AskTurnKind; turn: AskTurn });

/** HTTP status for each error. The browser keys on `error`, never on the status. */
export const ASK_ERROR_STATUS = {
  invalid: 400, // body isn't the shape
  empty: 400, // under 2 characters after cleaning
  too_long: 400, // over 300 characters or 2,000 bytes, or a character piled with marks
  signed_out: 401,
  bad_origin: 403,
  not_allowed: 403, // Ask isn't open to this account (founders only for now, or under 18)
  not_onboarded: 409,
  consent_needed: 409, // the one-time notice isn't accepted yet
  busy: 409, // another question is in flight
  report_deleted: 409, // the report was deleted while answering; handed back
  too_large: 413,
  bad_type: 415, // not application/json
  refused: 422, // the model declined; handed back
  rate_limited: 429, // burst speed bump
  too_many_tries: 429, // 10 model calls today
  error: 500, // our own failure; handed back
  failed: 502, // Anthropic error, bad output or out of tokens; handed back
  ai_off: 503, // no AI key, or ASK_DAILY_MAX=0
  paused: 503, // the day's breaker tripped; their own count isn't touched
  timeout: 504, // the 20 s AI deadline passed; handed back
} as const;
export type AskErrorCode = keyof typeof ASK_ERROR_STATUS;

/** Every error body. The day fields come once the person is known; keep the last ones seen when they're missing. */
export type AskError = { error: AskErrorCode } & Partial<AskDayFields>;

export type AskRegion = "in" | "other";
export type AskReadLanguage = "en" | "hi" | "hinglish";

/** What the browser needs to pick starters (components/platform/ask-starters.ts, Lane C). Names are catalogue names. */
export type AskStarterFacts = {
  /** Persona archetype (lib/domain/persona.ts), for the persona starter. */
  archetype: string;
  /** The first urgent, else the first doctor-flagged, marker on the newest ready report. */
  flagged: { name: string } | null;
  /** The first of the persona's priority markers that's low or at the edge and not flagged. */
  foodMarker: { name: string } | null;
  /** Protein still to eat today, rounded to the nearest 5 g; null under 10 g or with no target. */
  proteinLeftG: number | null;
  mealsToday: number;
  mealsEver: boolean;
  hasGaps: boolean;
  /** The first item's nutrient in a current stack; null when there's none, or it's held or out of date. */
  stackItem: string | null;
};

/** GET 200. */
export type AskThread = AskDayFields & {
  /** Today's answered turns, oldest first. */
  turns: AskTurn[];
  /** A question still being answered (under 45 s old), so a reopened sheet or a timed-out browser can wait for it. */
  pending: { clientKey: string; question: string; at: string } | null;
  /** "paused": the breaker tripped today. "off": no AI key, or ASK_DAILY_MAX=0. Crisis and emergency replies still work in both. */
  state: "ready" | "paused" | "off";
  /** Consented before Ask existed: show the one-time notice, and POST answers consent_needed until it's accepted. */
  consentNeeded: boolean;
  pinned: {
    /** Catalogue names of the urgent-flagged markers on the newest ready report. */
    urgent: string[];
    /** The name printed on the newest ready report when it looks like someone else's (printedFor), else null. */
    printedFor: string | null;
  };
  /** "reading": a newer report is still being read; answers use the last ready one. */
  report: "none" | "reading" | "ready";
  region: AskRegion;
  readLanguage: AskReadLanguage;
  starters: AskStarterFacts;
};

/** DELETE 200 ("Clear now"). Questions already used still count. */
export type AskClearOk = { cleared: number; left: number };

/** POST /api/ask/consent 200. */
export type AskConsentOk = { consentAt: string };

// ── Who gets Ask ────────────────────────────────────────────────────────────

export type AskGate = "ok" | "closed" | "not_onboarded" | "under_18";

/**
 * Whether this account may use Ask. Founders first: only BLOG_OWNER_EMAILS until
 * ASK_OPEN=all (Mayank, 2026-11-19). Then: onboarded, and 18 or over by birth year (an
 * unknown birth year doesn't count as 18). The layout (whether the control shows) and
 * the route (403/409) both call this, so they can't disagree.
 */
export function askGate(
  person: { email: string; onboardedAt: Date | string | null; birthYear: number | null },
  env: { askOpen?: string; owners?: string } = { askOpen: process.env.ASK_OPEN, owners: process.env.BLOG_OWNER_EMAILS },
  thisYear = new Date().getFullYear(),
): AskGate {
  const open = env.askOpen?.trim().toLowerCase() === "all";
  if (!open && !ownerEmails(env.owners).has(person.email.trim().toLowerCase())) return "closed";
  if (!person.onboardedAt) return "not_onboarded";
  if (person.birthYear == null || person.birthYear > thisYear - 18) return "under_18";
  return "ok";
}

// ── The seam between Lane A (data, route) and Lane B (AI) ───────────────────
// Lane A loads AskData, already cut to the allowlist (threats spec D4): no name, email,
// city, lab, ids beyond the report's, brands in the pack, prices, URLs, web-search text or
// the read's own words. Lane B turns it into the prompt. Fields marked "untrusted" were
// typed by the person, printed on an uploaded file or written by a model: Lane B sends
// them as capped JSON strings and never as instructions.

export type AskPerson = {
  age: number | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  archetype: string;
  level: string | null;
  sessionsPerWeek: number | null;
  goals: string[];
  /** profiles.event_in_mind as typed (untrusted). Never the web-search events. */
  eventTyped: string | null;
  diet: string | null;
  /** CONDITION_IDS ("pregnant", "kidney", …). */
  conditions: string[];
  /** Untrusted free text. */
  medications: string | null;
  /** Untrusted free text. */
  currentSupplements: string | null;
  readLanguage: AskReadLanguage;
};

export type AskMeal = {
  meal: MealKind;
  /** AI-written from what they typed (untrusted). */
  title: string;
  at: Date;
  kcal: number;
  proteinG: number;
};

export type AskMarker = {
  key: string | null;
  /** As printed on the report (untrusted). Lane B uses the catalogue name for known keys and cleans the rest. */
  printedName: string;
  value: number | null;
  /** Untrusted. */
  valueText: string | null;
  /** Untrusted. */
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  status: MarkerStatus;
  flag: Flag | null;
};

export type AskReport = {
  id: string;
  /** YYYY-MM-DD, or null when the report didn't say. */
  collectedOn: string | null;
  /** The read's verdict level after the floor; null if it couldn't be read. */
  verdictLevel: Level | null;
  /** printedFor() found another name. Never the name itself. */
  mayNotBeTheirs: boolean;
  /** In the report's own order. */
  markers: AskMarker[];
};

export type AskStackItem = {
  /** As saved: English, or the stack's translation for Hindi and Hinglish readers (untrusted). */
  nutrient: string;
  form: string;
  dose: string;
  timing: string;
  duration: string;
  cautions: string | null;
};

/**
 * The stack as the Stack screen would show it. Held and out of date carry no items and no
 * doses, exactly as the screen shows none. "none" also covers a stack still building or failed.
 */
export type AskStack =
  | { state: "none" }
  | { state: "held"; reason: "urgent" | "pregnant"; builtOn: string; leftForDoctor: string[] }
  | { state: "stale"; reason: "report" | "profile"; builtOn: string }
  | { state: "current"; builtOn: string; basis: "report" | "meals"; items: AskStackItem[]; skip: string[]; leftForDoctor: string[] };

export type AskData = {
  now: Date;
  /** The person's IANA time zone, for "Now:" in the pack. The day key is always IST. */
  timezone: string;
  region: AskRegion;
  person: AskPerson;
  plan: PlanView;
  /** Questions left today once this one counts. */
  asksLeft: number;
  targets: Targets;
  today: { meals: AskMeal[]; totals: Totals };
  diet: DietPicture;
  /** The saved usual-day description (untrusted), or null. */
  usualDay: string | null;
  /** The newest ready report by collection date (lib/platform/reports.ts newestReadyReport). */
  report: AskReport | null;
  stack: AskStack;
  /** Brand names in their own stack: for the brand filter only, never the prompt. */
  stackBrands: string[];
};

/** "Ask about this", after Lane A found it in the person's own data. */
export type AskAboutResolved =
  | { type: "marker"; key: string | null; name: string }
  | { type: "meal"; title: string }
  | { type: "stack_item"; nutrient: string }
  | { type: "gaps" };

/** An earlier answered pair from today, as stored after the filters; never raw model output. */
export type AskEarlier = { question: string; answer: string };

export type AskInput = {
  /** Cleaned (Lane A's cleanQuestion). */
  question: string;
  about: AskAboutResolved | null;
  /** At most ASK_LIMITS.earlierTurns, oldest first; only turns with an answer that wasn't removed. */
  earlier: AskEarlier[];
  data: AskData;
};

type ReplyCommon = {
  lang: string;
  /** For the [ask] log line: the floor raised the model's kind. */
  floorRaised: boolean;
  /** For the [ask] log line: the first output filter that tripped, by name. */
  filter: string | null;
};

/**
 * Lane B's reply, before Lane A saves it. The union keeps the rules: urgent and crisis
 * carry no AI text; off-topic carries no links; only doctor may lose its text to a filter.
 * Links are ids; Lane A turns them into hrefs when it reads a turn back.
 */
export type AskReply = ReplyCommon &
  (
    | { kind: "answer"; answer: string; notice: AskNotice | null; links: AskLinkId[] }
    | { kind: "off_topic"; answer: string; notice: AskNotice | null; links: [] }
    | { kind: "doctor"; answer: string | null; notice: AskNotice; links: AskLinkId[] }
    | { kind: "urgent"; answer: null; notice: AskNotice; links: [] | ["report"] }
    | { kind: "crisis"; answer: null; notice: AskNotice; links: [] }
  );

/** One model call's usage, for ask_turns and ask_totals. The mock reports model "mock" and zeros. */
export type AskUsage = { model: string; inputTokens: number; outputTokens: number; costMicros: number; ms: number };

/** answerAsk never throws for these; anything it does throw is Lane A's 500 "error". */
export type AskAnswer = { ok: true; reply: AskReply; usage: AskUsage } | { ok: false; error: "refused" | "failed" | "timeout" | "ai_off" };
