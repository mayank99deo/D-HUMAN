import { sql, type SQL } from "drizzle-orm";
import type { Logger } from "drizzle-orm/logger";

// Dates as query parameters, and a guard that makes the local database refuse them the way
// production's driver does.
//
// The bug this exists for (2026-11-24): production talks to Postgres through drizzle's
// postgres-js driver, which tells postgres.js to pass timestamp, date and json parameters
// through untouched (drizzle-orm/postgres-js/driver.js), because drizzle's own columns turn
// a Date into text first. A Date that skips a column, inside a sql`` template or on the
// right of lte(sql`coalesce(…)`, date), reaches postgres.js as a Date, and the query fails
// before it is sent: "The "string" argument must be of type string or an instance of Buffer
// or ArrayBuffer. Received an instance of Date". PGlite (local dev and the tests) takes
// Dates, so the daily email job failed on every live run and passed every test.
//
// The rule: a Date goes to the database only through a column (eq(table.col, date),
// .values(), .set()) or through at(date).

/** A moment as a timestamptz parameter, for raw sql and for comparisons whose left side isn't a column. */
export const at = (date: Date): SQL => sql`${date.toISOString()}::timestamptz`;

const holdsDate = (value: unknown): boolean => value instanceof Date || (Array.isArray(value) && value.some(holdsDate));

function refused(what: string, query: string): TypeError {
  const error = new TypeError(
    `${what} reached the database driver as a raw parameter. Production's driver (drizzle-orm/postgres-js) fails on it ` +
      `("The "string" argument must be of type string…"). Compare it through a column, or use at(date) from lib/db/params.ts. Query: ${query.slice(0, 300)}`,
  );
  (error as TypeError & { code: string }).code = "ERR_INVALID_ARG_TYPE";
  return error;
}

/**
 * For the local PGlite database only: drizzle calls this with every query's final
 * parameters (after the columns' own conversions) just before running it, inside
 * transactions too. postgres.js types a Date parameter as timestamptz wherever it sits,
 * so in production any Date here fails; here it fails the same way, with a clearer message.
 */
export const productionParamCheck: Logger = {
  logQuery(query, params) {
    for (const p of params) if (holdsDate(p)) throw refused("A Date", query);
  },
};

// The types drizzle's postgres-js driver passes through untouched: timestamptz, date, time,
// timestamp, and their arrays, numeric[], json and jsonb. postgres.js then refuses anything
// that isn't already text or bytes. PGlite picks a serializer by the type Postgres works out
// for each parameter, so these make it refuse what production refuses (a number where a
// timestamp goes, an object where jsonb goes) instead of converting it.
const PASSED_THROUGH = [1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231, 114, 3802];

/** PGlite serializers matching production's driver for the types above. */
export function productionSerializers(): Record<number, (value: unknown) => string> {
  const strict = (oid: number) => (value: unknown) => {
    if (typeof value === "string") return value;
    throw refused(`A ${value instanceof Date ? "Date" : typeof value} for a parameter of type ${oid}`, "(a parameter Postgres typed by its place in the query)");
  };
  return Object.fromEntries(PASSED_THROUGH.map((oid) => [oid, strict(oid)]));
}
