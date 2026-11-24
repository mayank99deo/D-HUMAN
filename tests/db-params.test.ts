// The local database's guard (lib/db/params.ts): PGlite refuses what production's driver
// refuses, so dev and the tests fail where production would. The daily email job passed
// every test and failed every live run because PGlite took a Date that production's driver
// (drizzle-orm/postgres-js) can't send (2026-11-24). tests/email-driver.test.ts proves the
// same values against production's driver itself.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

allowAppImports();
const removeDatabase = tempDatabase();

const { gte, lte, eq, sql } = await import("drizzle-orm");
const { db, schema } = await import("../lib/db/index.ts");
const { at } = await import("../lib/db/params.ts");

after(removeDatabase);

const rows = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? result) as Array<Record<string, unknown>>;
const refusedAsInProduction = (error: unknown) => {
  const e = error as { code?: string; message?: string; cause?: { code?: string } };
  return e.code === "ERR_INVALID_ARG_TYPE" || e.cause?.code === "ERR_INVALID_ARG_TYPE";
};
const MOMENT = new Date("2026-11-24T08:35:26.123Z");

describe("the local database refuses what production's driver refuses", () => {
  it("a Date inside a sql template", async () => {
    const d = await db();
    await assert.rejects(d.execute(sql`select ${MOMENT}::timestamptz as t`), refusedAsInProduction);
  });

  it("a Date compared with an expression that isn't a column (the daily job's bug)", async () => {
    const d = await db();
    const s = schema.emailSends;
    await assert.rejects(
      d.select({ id: s.id }).from(s).where(lte(sql`coalesce(${s.sentAt}, ${s.createdAt})`, MOMENT)),
      refusedAsInProduction,
    );
  });

  it("a Date inside a transaction", async () => {
    const d = await db();
    await assert.rejects(
      d.transaction(async (tx) => {
        await tx.execute(sql`select ${MOMENT}::timestamptz as t`);
      }),
      refusedAsInProduction,
    );
  });

  it("an object where jsonb goes (production's driver sends json untouched too)", async () => {
    const d = await db();
    await assert.rejects(d.execute(sql`select ${{ kind: "x" }}::jsonb as j`), refusedAsInProduction);
  });

  it("and keeps working after a refusal", async () => {
    const d = await db();
    await assert.rejects(d.execute(sql`select ${MOMENT}::timestamptz as t`), refusedAsInProduction);
    assert.equal(rows(await d.execute(sql`select 1 as x`))[0].x, 1);
  });
});

describe("what goes through", () => {
  it("at(date), in a template and on the right of a comparison", async () => {
    const d = await db();
    const [r] = rows(await d.execute(sql`select (${at(MOMENT)} = '2026-11-24T08:35:26.123Z'::timestamptz) as same`));
    assert.equal(r.same, true);
    const s = schema.emailSends;
    assert.deepEqual(await d.select({ id: s.id }).from(s).where(lte(sql`coalesce(${s.sentAt}, ${s.createdAt})`, at(MOMENT))), []);
  });

  it("a Date through a column: drizzle converts it first", async () => {
    const d = await db();
    await d.insert(schema.users).values({ id: "params-1", email: "params@example.com", createdAt: MOMENT });
    const found = await d.select({ id: schema.users.id }).from(schema.users).where(gte(schema.users.createdAt, MOMENT));
    assert.deepEqual(found, [{ id: "params-1" }]);
    const [u] = await d.select().from(schema.users).where(eq(schema.users.createdAt, MOMENT));
    assert.equal(u.createdAt.toISOString(), MOMENT.toISOString());
  });

  it("JSON as text where jsonb goes, and json through a jsonb column", async () => {
    const d = await db();
    const [r] = rows(await d.execute(sql`select (${JSON.stringify({ kind: "x" })}::jsonb ->> 'kind') as k`));
    assert.equal(r.k, "x");
    await d.insert(schema.jobRuns).values({ job: "params-json", lastResult: { at: MOMENT.toISOString(), n: 1 } });
    const [job] = await d.select().from(schema.jobRuns).where(eq(schema.jobRuns.job, "params-json"));
    assert.deepEqual(job.lastResult, { at: MOMENT.toISOString(), n: 1 });
  });
});
