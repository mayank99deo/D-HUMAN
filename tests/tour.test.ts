// The first-run tour: its copy stays honest and points at real controls, the card
// lands beside the tab bar, the desktop rail and the settings button without leaving
// the screen, and marking it done is per person, signed in, and keeps the first time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type TestGlobals = { __testUser?: { id: string; email: string } | null };
const g = globalThis as TestGlobals;

allowAppImports({
  // The route reads the signed-in user from cookies; tests set it directly.
  "@/lib/auth/session": "export const apiUser = async () => globalThis.__testUser ?? null;",
});
const removeDatabase = tempDatabase();
const { eq } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { POST: tourRoute } = await import("../app/api/profile/tour/route.ts");
const { FREE_LINE, GUTTER, TOUR, cardWidth, placeTour, scrimClip } = await import("../components/platform/tour-stops.ts");
const { PLAN } = await import("../lib/domain/plan.ts");

after(async () => {
  const d = await db();
  await (d as unknown as { $client: { close(): Promise<void> } }).$client.close();
  removeDatabase();
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allCopy = [...TOUR.flatMap((s) => [s.title, s.body]), FREE_LINE].join("\n");

describe("tour copy", () => {
  it("has four to six stops and starts with Fuel", () => {
    assert.ok(TOUR.length >= 4 && TOUR.length <= 6);
    assert.equal(TOUR[0].id, "fuel");
    assert.equal(new Set(TOUR.map((s) => s.id)).size, TOUR.length, "one stop per control");
  });

  it("takes the free allowance from the plan, said once", () => {
    assert.ok(FREE_LINE.includes(`${PLAN.freeMeals} meal logs`));
    assert.ok(FREE_LINE.includes(`${PLAN.freeReads} report reads`));
    assert.ok(!TOUR.some((s) => /free/i.test(s.body)), "only the free line mentions it");
  });

  it("never claims a doctor reviews anything, and never diagnoses", () => {
    assert.doesNotMatch(allCopy, /doctor/i);
    assert.doesNotMatch(allCopy, /review(ed)? by|\byou have\b/i);
    assert.match(TOUR.find((s) => s.id === "upload")!.body, /AI reads/);
  });

  it("points only at controls the nav marks for it", () => {
    const nav = readFileSync(path.join(root, "components/platform/Nav.tsx"), "utf8");
    assert.match(nav, /data-tour=\{t\.icon\}/);
    for (const s of TOUR) {
      if (s.id === "settings") assert.match(nav, /data-tour="settings"/);
      else assert.match(nav, new RegExp(`icon: "${s.id}"`), `${s.id} is a tab`);
    }
  });
});

describe("tour placement", () => {
  const phone = { width: 390, height: 844 };
  const small = { width: 320, height: 568 };
  const desktop = { width: 1440, height: 900 };
  // The phone tab bar: five equal cells along the bottom.
  const tab = (view: { width: number; height: number }, n: number) => {
    const w = Math.min(view.width, 512) / 5;
    const x0 = (view.width - Math.min(view.width, 512)) / 2;
    return { top: view.height - 56, left: x0 + n * w, width: w, height: 56 };
  };
  const inside = (p: ReturnType<typeof placeTour>, view: { width: number }) =>
    p.card.left >= GUTTER - 0.5 && p.card.left + p.card.width <= view.width - GUTTER + 0.5;

  it("puts the card above the phone's tab bar, joined by a hairline", () => {
    for (const view of [phone, small]) {
      for (let n = 0; n < 5; n++) {
        const p = placeTour(tab(view, n), 300, view);
        assert.equal(p.side, "above");
        assert.ok(inside(p, view), `card inside the screen at ${view.width} px, tab ${n}`);
        assert.ok(p.hole);
        assert.ok(p.leader);
        assert.equal(p.leader.top, p.card.top + 300, "hairline starts at the card");
        assert.equal(p.leader.top + p.leader.height, p.hole.top, "and ends at the light");
        assert.ok(p.leader.left >= p.card.left && p.leader.left <= p.card.left + p.card.width, "hairline sits under the card");
      }
    }
    assert.equal(cardWidth(320), 288);
  });

  it("puts the card to the right of the desktop rail", () => {
    const p = placeTour({ top: 160, left: 0, width: 96, height: 72 }, 280, desktop);
    assert.equal(p.side, "right");
    assert.equal(p.card.left, 100 + 14);
    assert.ok(p.card.top >= GUTTER && p.card.top + 280 <= desktop.height - GUTTER);
    assert.equal(p.hole?.left, 0, "the light never starts off screen");
  });

  it("puts the card below the settings button at the top right", () => {
    for (const view of [phone, small, desktop]) {
      const p = placeTour({ top: 12, left: view.width - 16 - 38, width: 32, height: 32 }, 300, view);
      assert.equal(p.side, "below");
      assert.ok(inside(p, view));
      assert.ok(p.leader && p.leader.left <= p.card.left + p.card.width);
    }
  });

  it("centres the card when there's nothing to point at", () => {
    const p = placeTour(null, 300, phone);
    assert.equal(p.side, "center");
    assert.equal(p.hole, null);
    assert.equal(p.card.left, (390 - 358) / 2);
    assert.equal(placeTour({ top: 2000, left: 10, width: 50, height: 50 }, 300, phone).side, "center", "off-screen target");
  });

  it("cuts the light out of the dimmed screen with the same ten points every time", () => {
    const lit = scrimClip({ top: 788, left: 74, width: 86, height: 56 }, phone);
    const dark = scrimClip(null, phone);
    const points = (c: string) => c.slice("polygon(".length, -1).split(", ");
    assert.equal(points(lit).length, 10);
    assert.equal(points(dark).length, 10);
    assert.ok(lit.includes("74px 788px"));
  });
});

describe("marking the tour done", () => {
  let n = 0;
  async function person(onboarded = true) {
    const d = await db();
    const id = `tour-${++n}`;
    await d.insert(schema.users).values({ id, email: `${id}@example.com` });
    await d.insert(schema.profiles).values({ userId: id, onboardedAt: onboarded ? new Date() : null });
    return { id, email: `${id}@example.com` };
  }
  const doneAt = async (id: string) => {
    const d = await db();
    const [row] = await d.select({ at: schema.profiles.tourDoneAt }).from(schema.profiles).where(eq(schema.profiles.userId, id));
    return row.at;
  };
  const post = (body: unknown) =>
    tourRoute(new Request("http://localhost/api/profile/tour", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("needs a signed-in person", async () => {
    g.__testUser = null;
    assert.equal((await post({ outcome: "skipped", stop: 1 })).status, 401);
  });

  it("starts unseen for a new person and keeps the first time it was done", async () => {
    const me = await person();
    assert.equal(await doneAt(me.id), null, "new profiles haven't seen it");
    g.__testUser = me;
    const res = await post({ outcome: "skipped", stop: 2 });
    assert.equal(res.status, 200);
    const first = await doneAt(me.id);
    assert.ok(first instanceof Date);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal((await post({ outcome: "finished", stop: TOUR.length })).status, 200);
    assert.equal((await doneAt(me.id))?.getTime(), first.getTime(), "a second call changes nothing");
  });

  it("touches only the signed-in person's profile", async () => {
    const me = await person();
    const other = await person();
    g.__testUser = me;
    await post({ outcome: "finished", stop: TOUR.length });
    assert.ok(await doneAt(me.id));
    assert.equal(await doneAt(other.id), null);
  });

  it("still marks it done when the body is missing or odd", async () => {
    const a = await person();
    g.__testUser = a;
    assert.equal((await post("not json")).status, 200);
    assert.ok(await doneAt(a.id));
    const b = await person();
    g.__testUser = b;
    assert.equal((await post({ outcome: "nope", stop: 99 })).status, 200);
    assert.ok(await doneAt(b.id));
  });
});
