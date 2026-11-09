import { sql } from "drizzle-orm";
import {
  boolean,
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

// The cookie holds a random token; the table holds its SHA-256.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
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
  consentAt: timestamp("consent_at", { withTimezone: true }),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
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
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  },
  (t) => [index("reports_user_idx").on(t.userId, t.createdAt)],
).enableRLS();

export const reportFiles = pgTable("report_files", {
  id: text("id").primaryKey(),
  reportId: text("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  mime: text("mime").notNull(),
  bytes: bytea("bytes").notNull(),
}).enableRLS();

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
    rangeSource: text("range_source"), // report | catalog | none
    status: text("status").notNull(), // low | high | in_range | edge_low | edge_high | unknown
    flag: text("flag"), // doctor | urgent | null
    position: integer("position").notNull().default(0),
  },
  (t) => [index("markers_user_key_idx").on(t.userId, t.key), index("markers_report_idx").on(t.reportId)],
).enableRLS();

export const analyses = pgTable("analyses", {
  reportId: text("report_id")
    .primaryKey()
    .references(() => reports.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  read: jsonb("read").notNull(),
  eventId: text("event_id"),
  createdAt: created(),
}).enableRLS();

// Upcoming events found on the web, shared by everyone with the same activity and region.
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    activity: text("activity").notNull(),
    region: text("region").notNull(),
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
    uniqueIndex("events_unique_idx").on(t.activity, t.region, t.name, t.startsOn),
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
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
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
    reportId: text("report_id").references(() => reports.id, { onDelete: "set null" }),
    status: text("status").notNull().default("ready"), // building | ready | failed
    plan: jsonb("plan"),
    model: text("model"),
    error: text("error"),
    createdAt: created(),
  },
  (t) => [index("stacks_user_idx").on(t.userId, t.createdAt)],
).enableRLS();

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Marker = typeof markers.$inferSelect;
export type FoodLog = typeof foodLogs.$inferSelect;
export type EventRow = typeof events.$inferSelect;
