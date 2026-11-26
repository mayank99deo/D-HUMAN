import { z } from "zod";

// The apps' contract: what each route the apps use accepts and answers (the mobile repo's
// docs/API.md §3.5). openapi.json is generated from these (lib/api/openapi.ts), and
// tests/app-contract.test.ts fails when a route's real answer and its schema disagree.
//
// Answers are strict: a key that isn't here is drift, so nothing leaks by being added to a
// row. Only zod and plain values here, so any script or test can load this file. The enums
// are written out; the tests check them against the lists they mirror.

const S = z.string();
const N = z.number();
const Int = z.number().int();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("A calendar day, YYYY-MM-DD, in the person's own time zone.");
const IsoTime = z.iso.datetime().describe("A moment, ISO 8601 in UTC.");

export const VERDICT_LEVELS = ["go", "go_with_tweaks", "build", "doctor_first"] as const;
export const MARKER_STATUSES = ["low", "edge_low", "in_range", "edge_high", "high", "unknown"] as const;
export const HOME_STACK_STATES = ["building", "rebuild_report", "rebuild_newer", "rebuild_profile", "ready", "build_report", "build_meals", "start"] as const;
export type HomeStackState = (typeof HOME_STACK_STATES)[number];

// ── Errors ───────────────────────────────────────────────────────────────────

export const ErrorResponse = z
  .looseObject({ error: S.describe("A stable code to switch on."), message: S.optional().describe("Words to show, when the server has them.") })
  .describe("Every refusal. Only a 401 means signed out.");

// ── Sign-in ──────────────────────────────────────────────────────────────────

// Requests are lenient, as the routes are: a key that isn't here is ignored, never an error.
export const CodeRequest = z.object({ email: z.email().describe("Where the 6-digit code goes. Lower-cased and trimmed by the server.") });
export const CodeResponse = z.union([
  z.strictObject({ status: z.literal("sent") }),
  z
    .strictObject({ status: z.literal("sent"), notice: z.literal("suppressed"), message: S })
    .describe("Sent, but this address bounced or reported spam before, so it may not arrive: show the message."),
]);

export const TokenRequest = z.object({
  email: z.email(),
  code: S.describe("Six digits, or the App Review account's 12 or more. Spaces and dashes are ignored."),
  key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional().describe("A new random key for each try, at least 128 bits (a UUIDv4 is fine); never a device id, a counter or anything reused. Send it again with a resend: the same email, code and key within 10 minutes get the same token, even after the code is used, so the key must be as secret as the code."),
  device: z.object({ label: S.max(40).optional().describe("The hardware model, e.g. iPhone18,1. Never the phone's name."), os: S.max(16).optional() }).optional(),
});

export const TokenResponse = z.strictObject({
  token: z.string().regex(/^dht_[A-Za-z0-9_-]{43}$/).describe("Shown once. Keep it in the Keychain; send it as Authorization: Bearer <token>."),
  tokenType: z.literal("Bearer"),
  expiresAt: IsoTime.describe("90 days after last use, at most 365 days after sign-in. Use slides it."),
  user: z.strictObject({ id: S, email: S }),
  onboarded: z.boolean(),
  isNew: z.boolean(),
});

export const SignOutRequest = z.object({ others: z.boolean().optional().describe("true: end every other session, the web's included, and keep this one.") });
export const SignOutResponse = z.union([z.strictObject({ status: z.literal("signed_out") }), z.strictObject({ status: z.literal("signed_out_others"), ended: Int })]);

export const DeleteAccountRequest = z.object({ confirm: z.literal("DELETE") });
export const DeleteAccountResponse = z.strictObject({ status: z.literal("deleted") });

export const DeviceView = z.strictObject({
  publicId: S,
  kind: z.enum(["web", "app"]),
  deviceLabel: S.nullable(),
  signedInAt: IsoTime,
  lastUsedAt: IsoTime.nullable().describe("Apps only; the web doesn't record it."),
  current: z.boolean(),
});
export const SessionsResponse = z.strictObject({ sessions: z.array(DeviceView) });
export const EndSessionResponse = z.strictObject({ status: z.literal("signed_out") });

// ── Me ───────────────────────────────────────────────────────────────────────

export const MeResponse = z.strictObject({
  id: S,
  email: S,
  onboarded: z.boolean(),
  consent: z.strictObject({
    at: IsoTime.nullable(),
    version: IsoDate.describe("The consent wording's version."),
    current: z.boolean().describe("false: they agreed to older wording (or none). Ask again before anything leaves the phone."),
  }),
  tourDone: z.boolean(),
  persona: z
    .strictObject({ firstName: S, initial: S, bib: S, label: S, archetype: S, noun: S, level: S, age: Int.nullable() })
    .nullable()
    .describe("Null until a profile exists."),
  founder: z.boolean(),
  aiOff: z.boolean().describe("AI is switched off on this server: reads and meals can't run."),
  profile: z
    .strictObject({
      name: S.nullable(),
      birthYear: Int.nullable(),
      sex: S.nullable(),
      heightCm: N.nullable(),
      weightKg: N.nullable(),
      city: S.nullable(),
      country: S.nullable(),
      timezone: S.nullable(),
      language: S,
      activities: z.array(S),
      primaryActivity: S.nullable(),
      level: S.nullable(),
      sessionsPerWeek: Int.nullable(),
      goals: z.array(S),
      eventInMind: S.nullable(),
      diet: S.nullable(),
      conditions: z.array(S).describe("Health conditions, pregnancy among them. Only this answer carries them."),
      medications: S.nullable(),
      currentSupplements: S.nullable(),
      supplementBudget: S.nullable(),
    })
    .describe("The whole profile, for Settings and onboarding. The only answer with medicines, conditions and pregnancy."),
});

// ── Home ─────────────────────────────────────────────────────────────────────

const VerdictLevel = z.enum(VERDICT_LEVELS);

export const MarkerView = z.strictObject({
  id: S,
  key: S.nullable(),
  name: S,
  short: S,
  panel: S.nullable(),
  value: N.nullable(),
  valueText: S.nullable(),
  shown: S.describe("The value as the web shows it."),
  unit: S.nullable(),
  refLow: N.nullable(),
  refHigh: N.nullable(),
  range: S.describe("The range in words, e.g. '30–100 (typical range)'."),
  status: z.enum(MARKER_STATUSES),
  statusText: S,
  flag: z.enum(["doctor", "urgent"]).nullable(),
  flagText: S.nullable().describe("Show it beside the marker whenever it's set."),
  note: S.nullable(),
  before: N.nullable().describe("The previous report's value, for a trend arrow."),
  derived: z.boolean().describe("Calculated from other results, not printed."),
});

export const ContourPoint = z.strictObject({
  id: S,
  short: S,
  name: S,
  value: N.nullable(),
  valueText: S.nullable(),
  unit: S.nullable(),
  low: N.nullable(),
  high: N.nullable(),
  status: S,
  range: S,
});

export const EventView = z.strictObject({ id: S, name: S, startsOn: IsoDate.nullable(), city: S.nullable(), url: S.nullable(), details: S.nullable() });

const Macros = z.strictObject({ kcal: N, proteinG: N, fibreG: N });

export const HomeResponse = z.strictObject({
  day: IsoDate,
  greeting: S,
  noun: S.describe("What the persona is called: 'runner', 'lifter'."),
  bib: z.strictObject({
    number: S,
    name: S,
    label: S,
    archetype: S,
    next: S,
    nextDetail: S,
    retest: S.nullable(),
    tone: VerdictLevel.nullable(),
  }),
  reading: z.strictObject({ reportId: S }).nullable().describe("A report being read right now."),
  report: z
    .strictObject({
      id: S,
      verdict: z.strictObject({ level: VerdictLevel, line: S, detail: S, lang: z.literal("hi").nullable() }),
      demo: z.boolean().describe("Written from a template because AI is off on this server."),
      source: S.describe("'collected 2 Nov' or 'uploaded 2 Nov'."),
      printedFor: S.nullable().describe("Set when the report is printed for someone else: say so above the verdict."),
      matter: z.array(MarkerView).max(6),
      focus: z.array(z.strictObject({ title: S, why: S, action: S })),
      contour: z.array(ContourPoint).describe("Empty when fewer than 4 markers have values: then there's no contour."),
      retest: z.strictObject({ dueOn: IsoDate, days: Int, label: S, why: S }).nullable(),
    })
    .nullable(),
  lastFailed: S.nullable().describe("Before any read: why the newest upload failed."),
  fuel: z.strictObject({ totals: Macros, targets: Macros, meals: Int, yesterday: z.strictObject({ kcal: N, proteinG: N, meals: Int }) }),
  events: z.strictObject({
    upcoming: z.array(EventView),
    pickedId: S.nullable(),
    targetId: S.nullable(),
    target: z.strictObject({ id: S, name: S, startsOn: IsoDate.nullable(), city: S.nullable(), daysOut: Int.nullable() }).nullable(),
  }),
  stack: z.strictObject({ state: z.enum(HOME_STACK_STATES), line: S, button: S, id: S.nullable() }),
});
