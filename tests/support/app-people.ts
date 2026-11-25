// People, meals and reports for the apps' route tests, in the test file's own database
// (tempDatabase). Call allowAppImports() and tempDatabase() before using any of these: the
// app's modules are imported lazily, once those hooks are in place.
import { randomUUID } from "node:crypto";

type Db = typeof import("../../lib/db/index.ts");
const lib = async () => {
  const [{ db, schema }, { sha256 }, { startAppSession }, profile] = await Promise.all([
    import("../../lib/db/index.ts") as Promise<Db>,
    import("../../lib/auth/crypto.ts"),
    import("../../lib/auth/bearer.ts"),
    import("../../lib/platform/profile.ts"),
  ]);
  return { d: await db(), schema, sha256, startAppSession, ...profile };
};

export type Person = { id: string; email: string; token: string; cookie: string };
type ProfileRow = Partial<Db["schema"]["profiles"]["$inferInsert"]>;

/** An onboarded person (unless told otherwise), signed in on a phone and on the web. */
export async function person(email: string, profile: ProfileRow = {}, onboarded = true): Promise<Person> {
  const { d, schema, sha256, startAppSession } = await lib();
  const id = randomUUID();
  await d.insert(schema.users).values({ id, email });
  await d.insert(schema.profiles).values({
    userId: id,
    name: "Asha",
    birthYear: 1994,
    sex: "female",
    heightCm: 160,
    weightKg: 55,
    city: "Indore",
    activities: ["running"],
    primaryActivity: "running",
    level: "regular",
    sessionsPerWeek: 4,
    goals: ["energy"],
    diet: "veg",
    timezone: "Asia/Kolkata",
    consentAt: new Date(),
    onboardedAt: onboarded ? new Date() : null,
    tourDoneAt: new Date(),
    ...profile,
  });
  const { token } = await startAppSession(id, { label: "iPhone18,1", client: null });
  const cookie = randomUUID();
  await d.insert(schema.sessions).values({ id: sha256(cookie), userId: id, expiresAt: new Date(Date.now() + 86_400_000) });
  return { id, email, token, cookie };
}

/** A logged meal on the person's day `daysAgo` before today (IST), made `minutesAgo` minutes before now. */
export async function meal(
  p: Pick<Person, "id">,
  o: { title?: string; daysAgo?: number; kcal?: number; proteinG?: number; slot?: string; micros?: Record<string, unknown>; minutesAgo?: number; model?: string } = {},
): Promise<string> {
  const { d, schema, localDate } = await lib();
  const id = randomUUID();
  const title = o.title ?? "Dal, two rotis";
  await d.insert(schema.foodLogs).values({
    id,
    userId: p.id,
    localDate: localDate("Asia/Kolkata", new Date(Date.now() - (o.daysAgo ?? 0) * 86_400_000)),
    meal: o.slot ?? "lunch",
    source: "text",
    inputText: title,
    title,
    items: [{ name: title, portion: "1 plate", kcal: o.kcal ?? 420, protein_g: o.proteinG ?? 18, carbs_g: 60, fat_g: 10, fibre_g: 8 }],
    kcal: o.kcal ?? 420,
    proteinG: o.proteinG ?? 18,
    carbsG: 60,
    fatG: 10,
    fibreG: 8,
    micros: o.micros ?? { iron_mg: 3, calcium_mg: 120, tip: "Add a bowl of curd.", lang: "en" },
    confidence: "medium",
    model: o.model ?? "mock",
    createdAt: new Date(Date.now() - (o.daysAgo ?? 0) * 86_400_000 - (o.minutesAgo ?? 0) * 60_000),
  });
  return id;
}

/** Every key anywhere in a JSON value. */
export const keysOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [];

export type Handler = (request: Request, ctx?: unknown) => Promise<Response>;
type G = { __headers?: Headers; __cookie?: string; __after: (() => unknown)[] };

/** Calls a route handler as the phone (token) or the web (cookie, with our Origin when `origin` is set). */
export async function call(
  handler: Handler,
  o: { token?: string; cookie?: string; origin?: string; etag?: string; method?: string; body?: unknown; form?: FormData; url?: string; params?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  const g = globalThis as unknown as G;
  const headers = new Headers(o.headers);
  if (o.token) headers.set("authorization", `Bearer ${o.token}`);
  if (o.origin) headers.set("origin", o.origin);
  if (o.etag) headers.set("if-none-match", o.etag);
  if (o.body !== undefined) headers.set("content-type", "application/json");
  g.__headers = headers;
  g.__cookie = o.cookie;
  const body = o.form ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
  const res = await handler(
    new Request(o.url ?? "https://www.d-human.fit/api/x", { method: o.method ?? (body ? "POST" : "GET"), headers, body }),
    o.params ? { params: Promise.resolve(o.params) } : undefined,
  );
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {}
  return { res, status: res.status, text, body: json };
}
