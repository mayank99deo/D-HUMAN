// Event privacy (QA H3): a plain search is shared by the region, but events from
// someone's typed "event in mind" are seen only by people who typed the same thing,
// and only a visible event can be picked.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

// Demo mode's canned search results stand in for Claude; the live search is never called.
allowAppImports({
  "@/lib/ai/client": `export const aiMode = () => "mock";`,
  "@/lib/ai/events": `export const searchEvents = () => { throw new Error("live search in a test"); };`,
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { ensureEvents, eventsFor, pickTargetEvent, upcomingEvents } = await import("../lib/platform/events.ts");
type Profile = typeof schema.profiles.$inferSelect;
type Persona = Parameters<typeof ensureEvents>[1];

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const persona = { archetype: "runner", eventSearch: "running races" } as unknown as Persona;

async function person(id: string, eventInMind: string | null): Promise<Profile> {
  const d = await db();
  await d.insert(schema.users).values({ id, email: `${id}@example.com` });
  const [p] = await d.insert(schema.profiles).values({ userId: id, city: "Nagpur", eventInMind }).returning();
  return p;
}

describe("events", () => {
  it("keeps a typed event's results to people who typed it", async () => {
    const planter = await person("planter", "  Free Fest ");
    const neighbour = await person("neighbour", null);
    const twin = await person("twin", "free fest");

    await ensureEvents(planter, persona);
    const d = await db();
    const planted = await d.select().from(schema.events);
    assert.ok(planted.length > 0);
    assert.ok(planted.every((e) => e.query === "free fest"), "named search rows carry their query");
    // What a crafted search could return, stored like any result of that search.
    await d.insert(schema.events).values({ id: crypto.randomUUID(), activity: "runner", region: "nagpur", query: "free fest", name: "Prize run, pay at example.com" });

    assert.deepEqual(await upcomingEvents(neighbour, persona), [], "nothing of theirs reaches a neighbour");
    await ensureEvents(neighbour, persona);
    const shared = await upcomingEvents(neighbour, persona);
    assert.ok(shared.length > 0 && shared.every((e) => e.query === ""));

    const mine = await upcomingEvents(planter, persona, 12);
    assert.ok(mine.some((e) => e.name.startsWith("Prize run")), "the planter sees their own search");
    const names = mine.map((e) => `${e.name}|${e.startsOn}`);
    assert.equal(new Set(names).size, names.length, "an event found by both searches shows once");
    assert.ok((await upcomingEvents(twin, persona, 12)).some((e) => e.name.startsWith("Prize run")), "same typed text, same results");
    const { target, upcoming } = await eventsFor("neighbour", neighbour, persona);
    assert.ok(!upcoming.some((e) => e.query !== "") && target?.query === "", "a neighbour's read aims only at shared events");
  });

  it("only lets someone pick an event they can see", async () => {
    const d = await db();
    const [privateRow] = await d.select().from(schema.events).where(eq(schema.events.query, "free fest")).limit(1);
    const [sharedRow] = await d.select().from(schema.events).where(eq(schema.events.query, "")).limit(1);

    assert.equal(await pickTargetEvent("neighbour", sharedRow.id), true);
    assert.equal(await pickTargetEvent("neighbour", privateRow.id), false);
    assert.equal(await pickTargetEvent("neighbour", crypto.randomUUID()), false, "an unknown event is refused, not a 500");
    const picks = await d.select().from(schema.userEvents).where(eq(schema.userEvents.userId, "neighbour"));
    assert.deepEqual(picks.map((p) => p.eventId), [sharedRow.id], "a refused pick keeps the old one");

    assert.equal(await pickTargetEvent("planter", privateRow.id), true);
    assert.equal(await pickTargetEvent("neighbour", null), true);
    assert.equal((await d.select().from(schema.userEvents).where(eq(schema.userEvents.userId, "neighbour"))).length, 0);
  });
});
