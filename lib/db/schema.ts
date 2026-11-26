import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Report files are kept in the database itself in Phase 1, so health documents
// never sit in a public bucket. Postgres bytea, read back as a Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

// Every table has row-level security on, with no policies: Supabase serves the
// public schema over its Data API, and health data must never be readable there.
// The app connects as the tables' owner, which RLS doesn't restrict.
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: created(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  // The apps only (0015): the UUID an in-app purchase carries as Apple's appAccountToken, made on
  // first use, so our own user id never goes to Apple (the mobile repo's docs/API.md §8, gap G8).
  storeAccountToken: text("store_account_token").unique(),
}).enableRLS();

// One-time sign-in codes. Only a hash of the code is stored.
export const loginCodes = pgTable(
  "login_codes",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)],
).enableRLS();

// The cookie holds a random token; the table holds its SHA-256. The apps' bearer tokens
// (dht_…, lib/auth/bearer.ts) live here too, hashed the same way, with kind 'bearer': a
// token works only the way it was issued. created_at is when the code was entered and
// never changes (the fresh-session rule for /write reads it).
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
    kind: text("kind").notNull().default("cookie"), // cookie (the web) | bearer (the apps)
    // The handle the device list and remote sign-out use, so the hash never leaves the server.
    publicId: text("public_id").notNull().default(sql`gen_random_uuid()::text`),
    deviceLabel: text("device_label"), // the hardware model the app sends ("iPhone18,1"), never the phone's name
    client: text("client"), // the last X-DHuman-Client header seen, for version counts only
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }), // apps only, written at most once an hour
    absoluteExpiresAt: timestamp("absolute_expires_at", { withTimezone: true }), // apps only: the 365-day cap
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    uniqueIndex("sessions_public_id_idx").on(t.publicId),
    // Only the two kinds the code knows; a typo can never make a third that some lookup misses.
    check("sessions_kind_check", sql`${t.kind} in ('cookie', 'bearer')`),
  ],
).enableRLS();

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  birthYear: integer("birth_year"),
  sex: text("sex"), // male | female | intersex — used only to pick reference ranges
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  city: text("city"),
  country: text("country").default("India"),
  timezone: text("timezone").default("Asia/Kolkata"),
  language: text("language").notNull().default("en"), // en | hi | hinglish
  activities: text("activities").array().notNull().default(sql`'{}'::text[]`),
  primaryActivity: text("primary_activity"),
  level: text("level"), // starting | regular | competitive | elite
  sessionsPerWeek: integer("sessions_per_week"),
  goals: text("goals").array().notNull().default(sql`'{}'::text[]`),
  eventInMind: text("event_in_mind"),
  diet: text("diet"), // veg | eggetarian | nonveg | vegan | jain
  conditions: text("conditions").array().notNull().default(sql`'{}'::text[]`),
  medications: text("medications"),
  currentSupplements: text("current_supplements"),
  // Monthly supplement budget, one of BUDGET_IDS in lib/domain/budget.ts; null until they pick one.
  supplementBudget: text("supplement_budget"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  // The apps only (0017): when the person first agreed, kept when an app records agreement to newer
  // consent wording (which moves consent_at). Null means consent_at is still the first agreement.
  consentFirstAt: timestamp("consent_first_at", { withTimezone: true }),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  // When they finished or skipped the first-run tour; null means it's still to show.
  tourDoneAt: timestamp("tour_done_at", { withTimezone: true }),
  // When they agreed to Ask's notice (their question and data go to Claude to answer it); null until then.
  askConsentAt: timestamp("ask_consent_at", { withTimezone: true }),
  // The apps only (0014): when the person answered the health question (conditions, pregnancy
  // among them, and medicines) the apps ask before a first stack; null until then.
  healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // uploaded → reading → interpreting → ready | failed
    status: text("status").notNull().default("uploaded"),
    stage: text("stage"),
    fileName: text("file_name"),
    fileCount: integer("file_count").notNull().default(1),
    totalBytes: integer("total_bytes").notNull().default(0),
    labName: text("lab_name"),
    collectedOn: date("collected_on"),
    nameOnReport: text("name_on_report"),
    model: text("model"),
    // Phase 1 reads are AI only; a doctor review step comes later.
    reviewStatus: text("review_status").notNull().default("ai_only"),
    error: text("error"),
    createdAt: created(),
    // When the current read started; a read older than this by many minutes is stale and may be retried.
    startedAt: timestamp("started_at", { withTimezone: true }),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  },
  (t) => [index("reports_user_idx").on(t.userId, t.createdAt)],
).enableRLS();

export const reportFiles = pgTable(
  "report_files",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
  },
  (t) => [index("report_files_report_idx").on(t.reportId, t.position)],
).enableRLS();

export const markers = pgTable(
  "markers",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key"), // our catalog id, when the printed name matched one
    name: text("name").notNull(), // as printed
    panel: text("panel"),
    value: doublePrecision("value"),
    valueText: text("value_text"),
    unit: text("unit"),
    refLow: doublePrecision("ref_low"),
    refHigh: doublePrecision("ref_high"),
    refText: text("ref_text"),
    rangeSource: text("range_source"), // report | catalog | derived | none
    status: text("status").notNull(), // low | high | in_range | edge_low | edge_high | unknown
    flag: text("flag"), // doctor | urgent | null
    position: integer("position").notNull().default(0),
  },
  (t) => [index("markers_user_key_idx").on(t.userId, t.key), index("markers_report_idx").on(t.reportId)],
).enableRLS();

export const analyses = pgTable(
  "analyses",
  {
    reportId: text("report_id")
      .primaryKey()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    read: jsonb("read").notNull(),
    eventId: text("event_id"),
    createdAt: created(),
  },
  (t) => [index("analyses_user_idx").on(t.userId)],
).enableRLS();

// Upcoming events found on the web for an activity and region. A plain search
// (query '') is shared by everyone there; a search for an event someone typed
// keeps that query, and only people who typed the same thing see its results.
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    activity: text("activity").notNull(),
    region: text("region").notNull(),
    query: text("query").notNull().default(""),
    name: text("name").notNull(),
    kind: text("kind"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    city: text("city"),
    country: text("country"),
    url: text("url"),
    details: text("details"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT: an event with no date yet is still one row, not one per refresh.
    unique("events_unique").on(t.activity, t.region, t.query, t.name, t.startsOn).nullsNotDistinct(),
    index("events_lookup_idx").on(t.activity, t.region, t.startsOn),
  ],
).enableRLS();

// One row per (activity, region) search, so a quiet region isn't searched on every visit.
export const eventSearches = pgTable(
  "event_searches",
  {
    activity: text("activity").notNull(),
    region: text("region").notNull(),
    query: text("query").notNull().default(""),
    status: text("status").notNull(), // ok | failed | running
    searchedAt: timestamp("searched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.activity, t.region, t.query] })],
).enableRLS();

export const userEvents = pgTable(
  "user_events",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    target: boolean("target").notNull().default(true),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] }), index("user_events_event_idx").on(t.eventId)],
).enableRLS();

export const foodLogs = pgTable(
  "food_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    meal: text("meal").notNull(), // breakfast | lunch | dinner | snack
    source: text("source").notNull(), // photo | voice | text
    inputText: text("input_text"),
    title: text("title").notNull(),
    items: jsonb("items").notNull(),
    kcal: real("kcal").notNull(),
    proteinG: real("protein_g").notNull(),
    carbsG: real("carbs_g").notNull(),
    fatG: real("fat_g").notNull(),
    fibreG: real("fibre_g").notNull(),
    micros: jsonb("micros").notNull(),
    confidence: text("confidence"),
    model: text("model"),
    createdAt: created(),
    // The apps only (0013). eaten_at: when a meal queued offline on a phone was eaten (it sets
    // local_date); null for a meal sent at once. input_raw: what a Hinglish or English pick heard
    // in Devanagari, before it was put in Latin letters on arrival. repeat_of: the meal a "Log
    // again" copies (no AI call); kept as a plain id, since that meal may be deleted later.
    eatenAt: timestamp("eaten_at", { withTimezone: true }),
    inputRaw: text("input_raw"),
    repeatOf: text("repeat_of"),
  },
  (t) => [index("food_logs_user_date_idx").on(t.userId, t.localDate)],
).enableRLS();

// "What do you usually eat?" — a typical day, estimated once, used until real logs exist.
export const dietBaselines = pgTable("diet_baselines", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  estimate: jsonb("estimate").notNull(),
  model: text("model"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const wraps = pgTable(
  "wraps",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // week | month | year
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    stats: jsonb("stats").notNull(),
    story: jsonb("story").notNull(),
    model: text("model"),
    createdAt: created(),
    // When the person first reached the story's last card ("One thing"); measures the weekly email.
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("wraps_unique_idx").on(t.userId, t.period, t.startsOn)],
).enableRLS();

export const stacks = pgTable(
  "stacks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A stack is built from one report and holds its marker values, so it goes when the report does.
    reportId: text("report_id").references(() => reports.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ready"), // building | ready | failed
    plan: jsonb("plan"),
    model: text("model"),
    error: text("error"),
    createdAt: created(),
  },
  (t) => [index("stacks_user_idx").on(t.userId, t.createdAt), index("stacks_report_idx").on(t.reportId)],
).enableRLS();

// Supplement brands found on the web, shared by everyone who gets the same
// nutrient (and diet variant), refreshed monthly. Keyed like "vitamin_d3:vegan".
export const brandPicks = pgTable("brand_picks", {
  key: text("key").primaryKey(),
  nutrient: text("nutrient").notNull(),
  brands: jsonb("brands").notNull(),
  status: text("status").notNull(), // ok | empty | failed
  model: text("model"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// A ₹49 pass: one Razorpay order, paid at most once, unlocking 30 days of reads
// and meal logs. The row's id is also the order's receipt.
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().unique(),
    paymentId: text("payment_id").unique(),
    amount: integer("amount").notNull(), // paise
    currency: text("currency").notNull(),
    status: text("status").notNull().default("created"), // created | paid
    // Which Razorpay keys made the order: a test-mode pass never counts once live keys are in.
    mode: text("mode").notNull().default("live"), // test | live
    method: text("method"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Last time an unpaid order was checked with Razorpay (the fallback when a webhook is missed).
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [index("payments_user_idx").on(t.userId, t.status, t.endsAt)],
).enableRLS();

// Every AI use that counts against a plan: a report read or a meal log. Kept when
// the report or meal is deleted, so deleting doesn't hand back free uses; removed
// when a read or meal fails, so failures never count.
export const usage = pgTable(
  "usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // read | meal
    refId: text("ref_id").notNull(),
    localDate: date("local_date"), // the person's day, for meal logs
    createdAt: created(),
  },
  (t) => [uniqueIndex("usage_kind_ref_idx").on(t.kind, t.refId), index("usage_user_idx").on(t.userId, t.kind, t.createdAt)],
).enableRLS();

// ── Blog ────────────────────────────────────────────────────────────────────
// Public content, kept apart from health data: nothing here joins to users, so
// deleting an app account never touches the blog. Readers only ever see `live`.
// Shapes of the JSON columns: lib/blog/types.ts.

// Who may write at /write. Owners (who manage this list) come from BLOG_OWNER_EMAILS.
export const blogAuthors = pgTable("blog_authors", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(), // lowercase; server only, never rendered
  slug: text("slug").notNull().unique(), // /team/<slug>
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  bio: text("bio").notNull().default(""),
  photoImageId: text("photo_image_id"),
  links: jsonb("links").notNull().default(sql`'[]'::jsonb`),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// A post keeps a working draft and the published copy apart, so an unpublished edit
// can never go live (not even on a redeploy, which empties the page cache).
export const blogPosts = pgTable(
  "blog_posts",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    status: text("status").notNull().default("draft"), // draft | live | taken_down
    topic: text("topic"), // BLOG_TOPICS in lib/blog/types.ts
    language: text("language").notNull().default("en"),
    // restrict: an author with posts can't be deleted.
    authorId: text("author_id")
      .notNull()
      .references(() => blogAuthors.id, { onDelete: "restrict" }),
    featured: boolean("featured").notNull().default(false),
    draft: jsonb("draft").notNull().default(sql`'{}'::jsonb`),
    draftVersion: integer("draft_version").notNull().default(1),
    draftUpdatedBy: text("draft_updated_by"), // author id
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }).notNull().defaultNow(),
    live: jsonb("live"),
    liveVersion: integer("live_version"), // the draft_version that was published
    publishedAt: timestamp("published_at", { withTimezone: true }), // first publish; the date readers see
    updatedOn: timestamp("updated_on", { withTimezone: true }), // last "meaningful update"
    liveChangedAt: timestamp("live_changed_at", { withTimezone: true }),
    // Soft lock: the editor's heartbeat.
    editingBy: text("editing_by"),
    editingAt: timestamp("editing_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("blog_posts_live_idx").on(t.publishedAt.desc()).where(sql`${t.status} = 'live'`),
    // At most one featured post.
    uniqueIndex("blog_posts_one_featured_idx").on(t.featured).where(sql`${t.featured}`),
  ],
).enableRLS();

// Every slug a post was ever published under. A retired slug redirects to the post's
// current one; once the post is deleted (post_id null) the address stays retired.
export const blogSlugs = pgTable("blog_slugs", {
  slug: text("slug").primaryKey(),
  postId: text("post_id").references(() => blogPosts.id, { onDelete: "set null" }),
  createdAt: created(),
}).enableRLS();

// A photo, resized in the author's browser. Crops (focal point) and black and white
// are CSS, so one set of files serves every crop and both looks.
export const blogImages = pgTable("blog_images", {
  id: text("id").primaryKey(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  focalX: real("focal_x").notNull().default(0.5),
  focalY: real("focal_y").notNull().default(0.5),
  keepColour: boolean("keep_colour").notNull().default(false),
  ownRights: boolean("own_rights").notNull().default(true),
  credit: text("credit"),
  uploadedBy: text("uploaded_by").notNull(), // author id
  createdAt: created(),
}).enableRLS();

// The files of a photo (e.g. "w960-3fa9c1.webp"). The name carries a content hash, so
// the bytes at a URL never change and can be cached for a year.
export const blogImageFiles = pgTable(
  "blog_image_files",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => blogImages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    byteSize: integer("byte_size").notNull(),
    bytes: bytea("bytes").notNull(),
  },
  (t) => [primaryKey({ columns: [t.imageId, t.name] })],
).enableRLS();

// Every publish, update, take-down and restore: who, which draft, the checklist ticks,
// the automatic checks, and a copy of what went live.
export const blogPublishes = pgTable(
  "blog_publishes",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => blogPosts.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // publish | update | take_down | restore
    draftVersion: integer("draft_version").notNull(),
    byAuthor: text("by_author").notNull(),
    checklist: jsonb("checklist"),
    checks: jsonb("checks"),
    meaningful: boolean("meaningful").notNull().default(false),
    snapshot: jsonb("snapshot"),
    createdAt: created(),
  },
  (t) => [index("blog_publishes_post_idx").on(t.postId, t.createdAt)],
).enableRLS();

// "Ready for a read": one author asks the other to look at a draft version.
export const blogReviews = pgTable(
  "blog_reviews",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => blogPosts.id, { onDelete: "cascade" }),
    draftVersion: integer("draft_version").notNull(),
    requestedBy: text("requested_by").notNull(),
    reviewerId: text("reviewer_id").notNull(),
    status: text("status").notNull().default("requested"), // requested | looks_good | needs_changes
    note: text("note"),
    createdAt: created(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("blog_reviews_post_idx").on(t.postId, t.createdAt)],
).enableRLS();

// ── Lifecycle email ─────────────────────────────────────────────────────────
// Shapes and rules: lib/email/types.ts. Sign-in codes are not lifecycle email and
// are never recorded or capped here.

// What a person gets. No row means the defaults (both on, Mayank's call of 2026-11-18).
export const emailPrefs = pgTable("email_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  weekly: boolean("weekly").notNull().default(true),
  questions: boolean("questions").notNull().default(true),
  // Set after several weekly emails in a row went untapped; turning weekly on clears it.
  weeklyPausedAt: timestamp("weekly_paused_at", { withTimezone: true }),
  updatedVia: text("updated_via"), // settings | stop_link | one_click | complaint
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// One row per lifecycle email. The unique (person, kind, dedupe key) is claimed before
// Resend is called, so nothing sends twice however often the job runs.
export const emailSends = pgTable(
  "email_sends",
  {
    id: text("id").primaryKey(), // also the `e` parameter on the email's links
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // EmailKind
    dedupeKey: text("dedupe_key").notNull(),
    variant: text("variant"),
    localDate: date("local_date").notNull(), // the person's calendar day, for the one-a-day cap
    status: text("status").notNull().default("sending"), // SendStatus
    batchId: text("batch_id"),
    providerId: text("provider_id"), // Resend's email id
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    firstTapAt: timestamp("first_tap_at", { withTimezone: true }),
    createdAt: created(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("email_sends_dedupe_idx").on(t.userId, t.kind, t.dedupeKey),
    uniqueIndex("email_sends_provider_idx").on(t.providerId),
    // The day's budget: sends since midnight UTC.
    index("email_sends_sent_idx").on(t.sentAt),
    // The retry sweep.
    index("email_sends_open_idx").on(t.createdAt).where(sql`${t.status} in ('sending', 'failed')`),
  ],
).enableRLS();

// Addresses that hard-bounced or reported spam, as SHA-256 of the lowercase address.
// Kept after an account is deleted, to keep honouring "don't email me"; not reversible.
export const emailSuppressions = pgTable("email_suppressions", {
  emailHash: text("email_hash").primaryKey(),
  reason: text("reason").notNull(), // bounce | complaint | resend
  createdAt: created(),
}).enableRLS();

// Answers to the feedback questions, one row per question. The Google Sheet is a copy;
// this is the record. sheet_synced_at is cleared on every change and set once copied.
export const feedbackAnswers = pgTable(
  "feedback_answers",
  {
    id: text("id").primaryKey(), // also the Sheet's Answer ID
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    survey: text("survey").notNull(), // fb-1, fb-2, … or "open" (from Settings)
    question: text("question").notNull(), // FeedbackQuestion
    answer: text("answer"), // null while two different taps arrived too close together
    path: text("path"), // used | barely
    source: text("source").notNull(), // email_tap | page | settings
    contactOk: boolean("contact_ok").notNull().default(false),
    conflictUntil: timestamp("conflict_until", { withTimezone: true }),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    sheetSyncedAt: timestamp("sheet_synced_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("feedback_answers_question_idx").on(t.userId, t.survey, t.question),
    index("feedback_answers_unsynced_idx").on(t.updatedAt).where(sql`${t.sheetSyncedAt} is null`),
  ],
).enableRLS();

// A lease per scheduled job, so a cron that fires twice runs once; also its last result
// (counts only, never addresses). Also holds once-a-week markers such as "alert:weekly-cap".
// The apps' cost guards (0016): how often an app token set off something paid in a window, per
// person ("events:<user id>" a week, "usual:<user id>" a day) and for everyone ("app-ai" a day).
// `window` is the window's first day in IST. Counts only; the web's requests never touch it.
export const appRateCounts = pgTable(
  "app_rate_counts",
  {
    subject: text("subject").notNull(),
    window: date("window").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.subject, t.window] })],
).enableRLS();

export const jobRuns = pgTable("job_runs", {
  job: text("job").primaryKey(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastResult: jsonb("last_result"),
}).enableRLS();

// Emails sent outside the lifecycle ledger and sign-in codes (the waitlist welcome, the
// founders' alert, /write's review requests), counted per UTC day, so the daily budget sees everything that uses
// Resend's free 100 a day. Counts only, never addresses. Rows are tiny: one per stream a day.
export const emailDailyCounts = pgTable(
  "email_daily_counts",
  {
    day: date("day").notNull(), // UTC
    stream: text("stream").notNull(), // waitlist_welcome | founder_alert | review_request
    sent: integer("sent").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.stream] })],
).enableRLS();

// ── Ask ─────────────────────────────────────────────────────────────────────
// The in-app assistant (docs/team/specs/2026-11-19-ask-data.md). Days are IST days for
// everyone, from the server clock, so a profile's time zone can't open a new day.
// Question and answer text is health data: never logged or emailed, read only by its
// owner through /api/ask, and deleted by the daily job (ASK_KEEP_DAYS).

// One row per question being answered or answered. A failed call deletes its row and
// hands the question back. `client_key` is the browser's id for the question, so a retry
// is never asked twice; the server makes `id`.
export const askTurns = pgTable(
  "ask_turns",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientKey: text("client_key").notNull(),
    day: date("day").notNull(), // the IST day it counted on
    status: text("status").notNull().default("pending"), // pending | answered
    kind: text("kind"), // answer | off_topic | doctor | urgent | crisis; null while pending
    counted: boolean("counted").notNull().default(true), // used one of the day's questions
    question: text("question").notNull(),
    answer: text("answer"), // the AI text; null for urgent and crisis, and once removed
    notice: jsonb("notice"), // code's fixed safety words, with marker names
    links: jsonb("links"), // link ids from the fixed table, at most 2
    lang: text("lang"), // BCP 47 of the answer
    // The report whose markers were in the pack. No foreign key: deleting any report
    // blanks every answer that used one (lib/platform/reports.ts) and keeps the question.
    reportId: text("report_id"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    ms: integer("ms"),
    createdAt: created(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [
    // Today's thread, the one-in-flight check, and report and clear deletes.
    index("ask_turns_user_day_idx").on(t.userId, t.day, t.createdAt),
    // A retry of the same question finds it; scoped by person.
    uniqueIndex("ask_turns_client_key_idx").on(t.userId, t.clientKey),
    // The daily purge.
    index("ask_turns_day_idx").on(t.day),
  ],
).enableRLS();

// Each person's count for an IST day. No text, so clearing questions or deleting a report
// never resets it. `used` counts toward the daily 5 and goes down when a call fails or its
// kind doesn't count; `attempts` counts every model call started and never goes down.
export const askDays = pgTable(
  "ask_days",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    used: integer("used").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
).enableRLS();

// Everyone's Ask for an IST day: the spend circuit breaker (ASK_DAILY_MAX counts
// `attempts`) and cost tracking. Counts only, no personal data, kept for good.
export const askTotals = pgTable("ask_totals", {
  day: date("day").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  answered: integer("answered").notNull().default(0),
  offTopic: integer("off_topic").notNull().default(0),
  doctor: integer("doctor").notNull().default(0),
  urgent: integer("urgent").notNull().default(0),
  crisis: integer("crisis").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0), // US$ millionths, from costOf()
}).enableRLS();

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Marker = typeof markers.$inferSelect;
export type FoodLog = typeof foodLogs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type BlogAuthorRow = typeof blogAuthors.$inferSelect;
export type BlogPostRow = typeof blogPosts.$inferSelect;
export type BlogImageRow = typeof blogImages.$inferSelect;
export type EmailPrefsRow = typeof emailPrefs.$inferSelect;
export type EmailSendRow = typeof emailSends.$inferSelect;
export type FeedbackAnswerRow = typeof feedbackAnswers.$inferSelect;
