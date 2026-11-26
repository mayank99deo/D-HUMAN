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
  code: S.describe("Six digits, or the App Review account's 20 or more. Spaces and dashes are ignored."),
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
  healthCheckedAt: IsoTime.nullable().describe("When the health question was answered (G2). Null: ask it before the first stack build, which otherwise answers 409 health_check_needed."),
  hold: z.enum(["urgent", "pregnant"]).nullable().describe("G1. urgent: the newest read report has a result needing advice today; drop every nudge, reminder and chip (logging works as normal). pregnant: the stack only."),
  reportsVersion: S.describe("G11. Changes whenever a report is uploaded, read or deleted on any device: drop cached Home and Stack when it differs from theirs."),
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

// ── Shared pieces ────────────────────────────────────────────────────────────

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export const MEAL_SOURCES = ["photo", "voice", "text"] as const;
export const PLAN_REFUSALS = ["free_reads_used", "pass_reads_used", "free_meals_used", "meals_today_used"] as const;
export const MICRO_KEYS = ["iron_mg", "calcium_mg", "magnesium_mg", "zinc_mg", "b12_ug", "folate_ug", "vitamin_c_mg", "vitamin_d_iu"] as const;

export const MealJson = z
  .strictObject({
    id: S,
    meal: z.enum(MEAL_SLOTS),
    title: S,
    source: S.describe("photo, voice or text; a repeat keeps its first meal's."),
    kcal: N,
    proteinG: N,
    confidence: S.nullable(),
    tip: S.nullable(),
    items: z.array(S).describe("'Name, portion', as the web lists them."),
    demo: z.boolean().describe("Written from a template because AI is off on this server."),
    time: S.describe("When it was eaten, on the person's clock: '8:40 am'."),
    at: IsoTime.describe("When it was eaten: a queued meal's own time, else when it was logged."),
    lang: S.nullable().describe("The language the title and tip are written in, as a BCP 47 tag ('hi', 'hi-Latn', 'en')."),
  })
  .describe("A logged meal: estimates, never measurements.");

export const PlanJson = z
  .strictObject({
    pass: z.strictObject({ until: S.describe("'14 Dec 2026'"), endsAt: IsoTime }).nullable(),
    queued: z.strictObject({ until: S, endsAt: IsoTime }).nullable().describe("A pass bought ahead, starting when the current one ends."),
    reads: z.strictObject({ used: Int, limit: Int, free: z.boolean().describe("true: the reads the person started with; false: a pass's.") }),
    meals: z.strictObject({ today: Int, perDay: Int, used: Int, freeLimit: Int.nullable().describe("Null with a pass.") }),
    readBlock: z.enum(PLAN_REFUSALS).nullable().describe("Why one more read isn't allowed now, or null."),
    mealBlock: z.enum(PLAN_REFUSALS).nullable().describe("Why one more meal log isn't allowed now, or null."),
    canBuy: z.boolean(),
    paymentsOn: z.boolean(),
  })
  .describe("What the person may use. No words and no price: the apps write their own, with the store's price.");

// ── Fuel ─────────────────────────────────────────────────────────────────────

const Macros5 = z.strictObject({ kcal: N, proteinG: N, carbsG: N, fatG: N, fibreG: N });

export const FuelResponse = z.strictObject({
  day: IsoDate,
  totals: Macros5.describe("Today so far, from today's meals."),
  targets: Macros5.extend({ basis: z.array(S).describe("How each target was set, in plain words."), estimated: z.boolean().describe("Height, weight or age was missing.") }),
  micros: z.array(
    z.strictObject({
      key: z.enum(MICRO_KEYS),
      label: S,
      pct: Int.nullable().describe("Share of today's need. Null for vitamin D, which shows in IU only."),
      iu: Int.nullable().describe("Vitamin D only: IU from today's food."),
    }),
  ),
  meals: z.array(MealJson).describe("Today's meals, in the order they were logged."),
  usualDay: z
    .strictObject({ description: S, patterns: z.array(S), short: z.boolean().describe("Too light to count: under 60% of the energy target.") })
    .nullable(),
  gaps: z.array(z.strictObject({ label: S, pct: Int })).max(4).describe("What the person's food runs shortest of, lowest first. Empty without enough data."),
  gapSource: z.enum(["logs", "typical_day", "none"]),
  stackReady: z.boolean().describe("No report and no stack yet, but the meals are enough to build one."),
  plan: PlanJson,
  aiOff: z.boolean(),
});

export const FactsResponse = z.strictObject({
  facts: z.array(z.strictObject({ kicker: S, text: S, scope: S.describe("Whom the fact is for.") })),
  categories: z.array(S).describe("The person's bands, shown circling the wait screen."),
});

export const PastMealsResponse = z.strictObject({
  day: IsoDate.describe("Today; the list holds the 28 days before it."),
  days: z.array(z.strictObject({ date: IsoDate, label: S.describe("'Yesterday' or 'Sat, 14 Nov'."), meals: z.array(MealJson) })).describe("Only days with meals, newest first."),
  target: z.strictObject({ kcal: N, proteinG: N }),
});

// ── Meal writes ──────────────────────────────────────────────────────────────

const MealKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).describe("A random key made once per try. Send the same try again with the same key: it's logged once.");

export const MealForm = z
  .object({
    text: S.max(3000).optional().describe("The words to read. Up to 1000 characters of the person's own words."),
    original: S.max(1000).optional().describe("The person's own words, only when `text` is a translation of them."),
    spoken: S.optional().describe("The language picked for speaking, for meals logged by voice (en, hinglish, hi, bn, …)."),
    source: z.enum(MEAL_SOURCES),
    meal: z.enum(MEAL_SLOTS).optional().describe("Omit to let the server guess."),
    key: MealKey.optional(),
    photo: S.optional().describe("A JPEG, PNG or WebP, at most 3 MB (convert HEIC first). Its time and place never go in the file."),
    eatenAt: IsoTime.optional().describe("A queued meal: when it was eaten. At most 48 hours old and 5 minutes ahead, else 400 bad_time. It sets the day the meal counts on."),
    photoAt: IsoTime.optional().describe("A gallery photo: when it was taken. Taken on the meal's day, its time sets the slot when none is given."),
    voiceEnd: z.enum(["pause", "tap", "log_now", "edited"]).optional().describe("How a spoken meal was ended. For the server's log only."),
  })
  .describe("multipart/form-data. A Hinglish or English pick whose words arrive in Devanagari is read in Latin letters.");

export const AppMealAnswer = z.strictObject({
  meal: MealJson,
  repeat: z.literal(true).optional().describe("This key's try was already logged: this is that meal, counted once."),
});

export const DeletedResponse = z.strictObject({ status: z.literal("deleted") });

export const AgainRequest = z.object({
  key: MealKey,
  eatenAt: IsoTime.optional().describe("A queued repeat: when it was eaten (48 hours at most)."),
  meal: z.enum(MEAL_SLOTS).optional().describe("Omit to keep the first meal's slot."),
});

export const SlotRequest = z.object({ meal: z.enum(MEAL_SLOTS) });

// ── Plan and upload ──────────────────────────────────────────────────────────

export const UploadResponse = z.strictObject({
  plan: PlanJson,
  target: S.nullable().describe("The event the read will aim at, by name."),
  noun: S.describe("What the persona is called: 'runner', 'lifter'."),
  facts: z.array(z.strictObject({ kicker: S, text: S })).describe("Facts about markers for the wait while a report is read."),
  limits: z.strictObject({
    maxFiles: Int,
    maxTotalBytes: Int.describe("Every file together. Shrink photos first; send a bigger PDF as page images (spec 13)."),
    types: z.array(S).describe("Checked by the files' bytes. One PDF, or up to maxFiles photos; never a PDF with photos."),
  }),
  aiOff: z.boolean(),
});

// ── Reports ──────────────────────────────────────────────────────────────────

export const REPORT_STATUSES = ["uploaded", "reading", "interpreting", "ready", "failed"] as const;

export const ReportsResponse = z.strictObject({
  reports: z.array(
    z.strictObject({
      id: S,
      status: z.enum(REPORT_STATUSES).describe("ready: open its read. reading or interpreting: poll GET /api/reports/{id}. failed: it can be tried again."),
      title: S.describe("The lab, else 'Blood report'."),
      when: S.describe("'Collected 2 Nov 2026' or 'Uploaded 4 Nov 2026', as the web lists it."),
      collectedOn: IsoDate.nullable(),
      uploadedOn: IsoDate,
      markers: Int,
      printedFor: S.nullable().describe("Printed for someone else: say so."),
    }),
  ).describe("Newest first."),
});

export const ReadResponse = z.strictObject({
  id: S,
  lab: S.nullable(),
  collectedOn: IsoDate.nullable(),
  uploadedOn: IsoDate,
  demo: z.boolean(),
  aiNote: S.describe("Show it under the title: 'AI-analysed report. Not a diagnosis.'"),
  printedFor: S.nullable().describe("Printed for someone else: say so above the verdict."),
  verdict: z.strictObject({ level: VerdictLevel, line: S, detail: S, lang: z.literal("hi").nullable() }),
  headline: S,
  summary: S,
  counts: z.strictObject({ markers: Int, out: Int.describe("Outside their range (low or high).") }),
  wins: z.array(S),
  focus: z.array(z.strictObject({ title: S, why: S, action: S })).describe("Most important first."),
  groups: z.array(z.strictObject({ panel: S, markers: z.array(MarkerView) })).describe("Every marker, by panel, in the catalogue's order."),
  doctorQuestions: z.array(S),
  retest: z.strictObject({
    dueOn: IsoDate,
    days: Int,
    label: S,
    weeks: N,
    from: z.enum(["collected", "uploaded"]).describe("Counted from the day the blood was taken, or the upload day."),
    why: S,
    markers: z.array(S),
  }),
  testTips: z.array(S),
});

// ── Stack ────────────────────────────────────────────────────────────────────

const BUDGET_SLABS = ["under_1000", "1000_2000", "2000_3000", "3000_4000", "4000_5000", "5000_plus", "not_sure"] as const;
export const STACK_BUDGET_IDS = BUDGET_SLABS;

const FitJson = z.strictObject({
  included: z.array(Int).describe("Item indexes that fit, in priority order."),
  later: z.array(Int).describe("Item indexes for 'when your budget allows'."),
  pick: z.array(Int.nullable()).describe("The brand picked for each item (an index into its brands), or null."),
  cost: z.array(N.nullable()).describe("Monthly rupees for each item, or null when unknown."),
  typical: z.array(z.boolean()).describe("The cost is a typical price, not a brand's."),
  total: N,
  cap: N.nullable(),
});

const StackPlanJson = z.strictObject({
  items: z.array(
    z.strictObject({
      nutrient: S, dose: S, why: S.nullable(), markers: z.array(S), dietGap: S.nullable(), form: S.nullable(), timing: S.nullable(), duration: S.nullable(), cautions: S.nullable(), rule: S.nullable(),
      brands: z.array(z.strictObject({ brand: S, product: S.nullable(), url: S.nullable(), note: S.nullable(), priceInr: N.nullable(), pack: S.nullable(), monthlyInr: N.nullable() })),
    }),
  ).describe("In priority order: results outside range, then edge of range, then food gaps."),
  skip: z.array(z.strictObject({ name: S, why: S.nullable() })),
  foodFirst: z.array(S),
  seeDoctor: z.array(S),
  gaps: z.array(z.strictObject({ key: S, label: S, pct: N, iu: N.nullable(), outcome: z.enum(["stack", "food", "test", "doctor"]), note: S, lead: S, more: S.nullable().describe("The rest of a long note, behind More."), rule: S.nullable() })),
  gapsBasis: z.strictObject({ source: z.enum(["logs", "typical_day"]), days: N }).nullable(),
});

export const StackResponse = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("start_with_food"), fullDays: Int, usualDayShort: z.boolean() }),
  z.strictObject({
    state: z.literal("stack"),
    stack: z
      .strictObject({
        id: S,
        status: z.enum(["building", "ready", "failed"]),
        error: S.nullable(),
        plan: StackPlanJson.nullable().describe("Null while building or failed, and when the stack is held or out of date: then no doses, anywhere."),
        demo: z.boolean(),
        made: IsoTime,
      })
      .nullable()
      .describe("Null before the first build."),
    staleReason: z.enum(["report", "profile"]).nullable(),
    basis: z.enum(["report", "meals"]),
    hasReport: z.boolean(),
    body: S.describe("A meals stack's basis: '24, 175 cm, 70 kg, regular lifter'."),
    markerNames: z.record(S, S),
    budget: z.enum(BUDGET_SLABS).nullable(),
    fits: z.record(z.enum(BUDGET_SLABS), FitJson).nullable().describe("The plan fitted to every budget slab, so a change of budget re-fits on the phone. Null when there's no plan to show."),
    flagged: z.array(z.strictObject({ name: S, urgent: z.boolean() })).describe("Results kept out of the stack, from the newest report."),
    hold: z.enum(["urgent", "pregnant"]).nullable(),
    holdLine: S.nullable().describe("The hold's words, verbatim (G13). Show it at the top whenever hold is set."),
    dosesOff: z.boolean().describe("The doses switch is off on the server: no plan or fits are sent. Show nutrients without amounts, or nothing."),
    healthCheckNeeded: z.boolean().describe("A stack exists but the health question hasn't been answered (it was built on the web): no plan is sent. Ask it, then rebuild."),
    aiOff: z.boolean(),
  }),
]);

// ── Profile and stack writes ─────────────────────────────────────────────────

export const ProfileRequest = z
  .looseObject({
    consent: z.literal(true).optional().describe("Agreed to the consent wording. For someone who agreed to older wording, this records agreement to the current one."),
    complete: z.literal(true).optional().describe("Onboarding finished."),
    healthChecked: z.literal(true).optional().describe("The health question answered (G2): send it with conditions (an empty list for none, pregnancy among them) and medications (null for none) in the same save."),
    conditions: z.array(S).optional(),
    medications: S.nullable().optional(),
    supplementBudget: z.enum(BUDGET_SLABS).nullable().optional(),
  })
  .describe("Any profile fields, as onboarding and Settings save them: name, birthYear, sex, heightCm, weightKg, city, country, timezone, language, activities, primaryActivity, level, sessionsPerWeek, goals, eventInMind, diet, conditions, medications, currentSupplements, supplementBudget. Ids from GET /api/app/options.");

export const SavedResponse = z.strictObject({ status: z.literal("saved") });

export const StackBuildResponse = z.strictObject({ id: S.describe("Poll GET /api/stack/{id} every 3 s; when it's ready, fetch GET /api/stack.") });

export const StackStatusResponse = z.strictObject({ status: z.enum(["building", "ready", "failed"]), error: S.nullable() });

export const TypicalRequest = z.object({ description: S.min(10).max(2000).describe("A whole usual day, meal by meal, with amounts where possible.") });

export const TypicalAnswer = z.strictObject({
  day: z.looseObject({ meals: z.array(z.looseObject({})), micros: z.record(S, N), patterns: z.array(S) }).describe("The saved estimate: its meals, the day's micronutrients and the patterns noticed."),
  short: z.boolean().describe("Too light to count: under 60% of the energy target, so it won't start a stack. Ask for the rest of the day."),
  runs: Int.describe("How many estimates were averaged."),
});

// ── Wraps, Settings, options, config ─────────────────────────────────────────

const WrapCard = z.strictObject({
  kind: z.enum(["stat", "streak", "food", "gap", "marker", "win", "next"]),
  big: S,
  label: S,
  line: S,
  flag: z.enum(["doctor", "urgent"]).nullable().describe("Marker cards only (G12): the card names a result flagged for a doctor. Leave such a card out."),
});

export const WrapsResponse = z.strictObject({
  day: IsoDate,
  cards: z.array(
    z.strictObject({
      key: S,
      period: z.enum(["week", "month", "year"]),
      offset: Int,
      name: S.describe("This week, Last week, Earlier week, This month…"),
      label: S,
      start: IsoDate,
      end: IsoDate,
      ongoing: z.boolean(),
      hasData: z.boolean().describe("Meals (or a report) in the period: a wrap can be made with POST /api/wraps."),
      wrap: z.strictObject({ id: S, title: S, cards: z.array(WrapCard), oneThing: S, demo: z.boolean(), made: IsoTime }).nullable(),
    }),
  ),
  aiOff: z.boolean(),
});

export const WrapMakeRequest = z.object({ period: z.enum(["week", "month", "year"]), offset: Int.min(-60).max(0) });
export const WrapMakeResponse = z.union([z.strictObject({ id: S }), z.strictObject({ empty: z.literal(true) })]);

export const SettingsResponse = z.strictObject({
  email: S,
  plan: PlanJson,
  passes: z.array(z.strictObject({ paidOn: S, from: S, until: S })).describe("Dates only: never an amount."),
  emails: z.strictObject({ weekly: z.boolean(), questions: z.boolean(), weeklyPaused: z.boolean() }),
  weekly: z.strictObject({ channel: z.enum(["email", "push"]).describe("G6: how the weekly wrap reaches this person.") }),
});

const Choice = z.strictObject({ id: S, label: S, hint: S.nullable() });
export const OptionsResponse = z.strictObject({
  activities: z.array(Choice),
  levels: z.array(Choice),
  goals: z.array(Choice),
  diets: z.array(Choice),
  conditions: z.array(Choice).describe("Pregnancy among them."),
  sexes: z.array(Choice),
  languages: z.array(Choice).describe("Each hint is the language's sample sentence, as the web's language step shows it."),
  budgets: z.array(z.strictObject({ id: z.enum(BUDGET_SLABS), label: S, cap: N.nullable() })),
  birthYears: z.strictObject({ min: Int, max: Int }).describe("18 to 100 this year."),
  limits: z.strictObject({ goals: Int, activities: Int, conditions: Int }),
});

export const APP_SWITCH_NAMES = ["voice", "snap", "again", "reminders", "appleSignIn", "iap", "doses"] as const;
export const ConfigResponse = z.strictObject({
  minSupported: S.describe("Below this version, every app request answers 426 update_required."),
  latest: S.nullable(),
  updateUrl: S.nullable(),
  apiBase: S,
  off: z.array(z.enum(APP_SWITCH_NAMES)).describe("Switches turned off. They only ever turn a thing off; anything not listed is on. doses stays off for the build once seen."),
  links: z.strictObject({ privacy: S.nullable(), terms: S.nullable(), support: S.nullable() }),
  notice: S.nullable(),
});

export const StoreTokenResponse = z.strictObject({
  appAccountToken: z.uuid().describe("Pass it as the purchase's appAccountToken (G8). The same for this person every time."),
});

// ── Report progress, deletes, the event target, the tour ─────────────────────

export const ReportStatusResponse = z.strictObject({
  status: z.enum(REPORT_STATUSES),
  stage: S.nullable(),
  error: S.nullable(),
  step: Int.nullable().describe("Which of the read's steps it's on (1 uploaded, 2 reading, 3 interpreting, 4 ready); null when it failed."),
  steps: Int,
  markersFound: Int.describe("How many markers have been found so far: a count only, for 'Reading your report, 12 markers'."),
});
export const EventTargetRequest = z.object({ eventId: z.uuid().nullable().describe("One of the events GET /api/home lists, or null to clear the pick.") });
export const TourRequest = z.object({ outcome: z.enum(["finished", "skipped"]).optional(), stop: Int.min(1).optional() });
export const TourResponse = z.strictObject({ status: z.literal("done") });
