import { z } from "zod";
import * as s from "./schemas.ts";

// The apps' contract as OpenAPI 3.1, generated from the zod schemas in lib/api/schemas.ts by
// one table of routes. `node scripts/api-schema.mts` writes docs/api/openapi.json, which the
// mobile repo pulls to generate its Swift client. tests/app-contract.test.ts fails when the
// committed file differs from this, when a route the table lists doesn't exist, when an app
// route isn't in the table, and when a route's real answer doesn't parse against its entry.
//
// The version changes with every change a client can see: a new route or field is a minor
// step; renaming or removing anything is a new route instead (docs/API.md §3.7).

export const CONTRACT_VERSION = "0.2.0";

type Method = "get" | "post" | "delete";
export type AppRoute = {
  method: Method;
  path: string;
  /** The route file under app/, which must export this method. */
  file: string;
  summary: string;
  /** bearer: the app's token; open: no sign-in (sign-in itself). */
  auth: "bearer" | "open";
  request?: z.ZodType;
  /** The request is multipart/form-data, with these fields, rather than JSON. */
  form?: true;
  /** A schema per status; ErrorResponse for every refusal. 304 has no body. */
  responses: Record<number, z.ZodType | null>;
  etag?: true;
  /** An app write that answers 409 consent_needed when the person agreed to older consent wording. */
  consent?: true;
};

const refusal = s.ErrorResponse;

export const APP_ROUTES: AppRoute[] = [
  {
    method: "post",
    path: "/api/auth/token",
    file: "app/api/auth/token/route.ts",
    summary: "Sign in with the emailed code (sent by POST /api/auth/code) and get a token. Never for a browser.",
    auth: "open",
    request: s.TokenRequest,
    responses: { 200: s.TokenResponse, 400: refusal, 429: refusal },
  },
  {
    method: "post",
    path: "/api/auth/apple",
    file: "app/api/auth/apple/route.ts",
    summary: "Sign in with Apple. Not on yet: 501 until Apple enrolment.",
    auth: "open",
    request: s.AppleSignInRequest,
    responses: { 400: refusal, 501: refusal },
  },
  {
    method: "post",
    path: "/api/auth/signout",
    file: "app/api/auth/signout/route.ts",
    summary: "Sign this phone out, or with others: true every other session (the web's included).",
    auth: "bearer",
    request: s.SignOutRequest,
    responses: { 200: s.SignOutResponse, 401: refusal },
  },
  {
    method: "post",
    path: "/api/account/delete",
    file: "app/api/account/delete/route.ts",
    summary: "Delete the account and everything in it. Every session ends, on every device.",
    auth: "bearer",
    request: s.DeleteAccountRequest,
    responses: { 200: s.DeleteAccountResponse, 400: refusal, 401: refusal },
  },
  {
    method: "get",
    path: "/api/me/sessions",
    file: "app/api/me/sessions/route.ts",
    summary: "Where this person is signed in, most recently used first.",
    auth: "bearer",
    responses: { 200: s.SessionsResponse, 304: null, 401: refusal, 403: refusal },
    etag: true,
  },
  {
    method: "delete",
    path: "/api/me/sessions/{publicId}",
    file: "app/api/me/sessions/[publicId]/route.ts",
    summary: "End one session from the device list.",
    auth: "bearer",
    responses: { 200: s.EndSessionResponse, 401: refusal, 403: refusal, 404: refusal },
  },
  {
    method: "get",
    path: "/api/me",
    file: "app/api/me/route.ts",
    summary: "Who is signed in: onboarding, consent, persona and the whole profile. Works before onboarding.",
    auth: "bearer",
    responses: { 200: s.MeResponse, 304: null, 401: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/home",
    file: "app/api/home/route.ts",
    summary: "Home, as the web's /home shows it: bib, verdict, markers that matter, today's fuel, events, the stack line.",
    auth: "bearer",
    responses: { 200: s.HomeResponse, 304: null, 401: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/fuel",
    file: "app/api/fuel/route.ts",
    summary: "Fuel, as the web's /fuel shows it: today's totals against targets, today's meals, the usual day, food gaps and the plan.",
    auth: "bearer",
    responses: { 200: s.FuelResponse, 304: null, 401: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/fuel/past",
    file: "app/api/fuel/past/route.ts",
    summary: "Past meals: the 28 days before today that have meals, newest first, labelled as the web labels them.",
    auth: "bearer",
    responses: { 200: s.PastMealsResponse, 304: null, 401: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/fuel/facts",
    file: "app/api/fuel/facts/route.ts",
    summary: "Facts for the meal wait screen, picked for this person. Rarely change: keep them with their ETag.",
    auth: "bearer",
    responses: { 200: s.FactsResponse, 304: null, 401: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "post",
    path: "/api/food",
    file: "app/api/food/route.ts",
    summary:
      "Log a meal from words, a photo or speech. Idempotent on `key`. 402 carries `refusal`; 409 is not_onboarded, consent_needed or in_progress (with Retry-After: send the same try again).",
    auth: "bearer",
    request: s.MealForm,
    form: true,
    responses: { 200: s.AppMealAnswer, 400: refusal, 401: refusal, 402: refusal, 409: refusal, 413: refusal, 415: refusal, 422: refusal, 429: refusal, 500: refusal, 503: refusal },
    consent: true,
  },
  {
    method: "delete",
    path: "/api/food/{id}",
    file: "app/api/food/[id]/route.ts",
    summary: "Delete one of the person's meals. One that's already gone answers the same, so it's safe to send again.",
    auth: "bearer",
    responses: { 200: s.DeletedResponse, 401: refusal },
  },
  {
    method: "post",
    path: "/api/food/{id}/again",
    file: "app/api/food/[id]/again/route.ts",
    summary:
      "Log again: one of the person's meals from the last 28 days, copied as a new meal with no AI call. Counts as a meal log. Idempotent on `key`. 404 when it's gone or older than 28 days.",
    auth: "bearer",
    request: s.AgainRequest,
    responses: { 200: s.AppMealAnswer, 400: refusal, 401: refusal, 402: refusal, 403: refusal, 404: refusal, 409: refusal, 429: refusal },
    consent: true,
  },
  {
    method: "post",
    path: "/api/food/{id}/slot",
    file: "app/api/food/[id]/slot/route.ts",
    summary: "Move a logged meal to another slot. Nothing else changes: not its day, numbers or count. Safe to send again.",
    auth: "bearer",
    request: s.SlotRequest,
    responses: { 200: s.AppMealAnswer, 400: refusal, 401: refusal, 403: refusal, 404: refusal, 409: refusal },
    consent: true,
  },
];

const STATUS_WORDS: Record<number, string> = {
  200: "OK",
  304: "Not modified: the app's copy (sent as If-None-Match) is current. No body.",
  400: "Refused: the error code says why.",
  401: "Signed out: the token is missing, malformed, expired or revoked. Wipe the phone's copy and sign in again.",
  402: "The plan doesn't allow one more: `refusal` says which limit. Show the app's own words for it, never `message`.",
  403: "Not for this kind of sign-in: not_for_app (a web-only route), bearer_required, bad_origin. Never sign out on a 403.",
  404: "Not found (another person's id looks the same).",
  409: "not_onboarded, consent_needed (ask again, then resend with the same key), in_progress (resend the same try after Retry-After), or the route's own code.",
  413: "Too large.",
  415: "Not a file type we read.",
  422: "Read, but refused: `message` says what to try.",
  429: "Too many tries. Retry-After says when to come back.",
  500: "Something failed on our side. Try again with the same key.",
  501: "Not available yet.",
  503: "AI is switched off on this server (ai_off): show `message`.",
};

const CONSENT_NOTE =
  " An app write: answers 409 consent_needed (with `version`) when the person agreed to older consent wording; ask again, then send the same request once more.";

function json(schema: z.ZodType, io: "input" | "output") {
  const out: Record<string, unknown> = { ...z.toJSONSchema(schema, { io, unrepresentable: "any" }) };
  delete out.$schema; // OpenAPI 3.1 sets the dialect once, for the whole document
  return out;
}

export function openapi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of APP_ROUTES) {
    const parameters: unknown[] = [
      { name: "X-DHuman-Client", in: "header", required: false, schema: { type: "string" }, description: "ios/1.0.0 (42). Used only for update prompts." },
    ];
    if (r.etag) parameters.push({ name: "If-None-Match", in: "header", required: false, schema: { type: "string" }, description: "The ETag of the app's copy." });
    for (const [, name] of r.path.matchAll(/\{(\w+)\}/g)) parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    const responses: Record<string, unknown> = {};
    for (const [status, schema] of Object.entries(r.responses)) {
      const headers = {
        "Cache-Control": { schema: { type: "string", const: "private, no-store" } },
        ...(r.etag && (status === "200" || status === "304") ? { ETag: { schema: { type: "string" } } } : {}),
        ...(status === "429" || (status === "409" && r.method !== "get") ? { "Retry-After": { schema: { type: "integer" }, description: "Seconds. Sent with 429, and with 409 in_progress." } } : {}),
      };
      responses[status] = { description: STATUS_WORDS[Number(status)] ?? "", headers, ...(schema ? { content: { "application/json": { schema: json(schema, "output") } } } : {}) };
    }
    (paths[r.path] ??= {})[r.method] = {
      summary: r.summary,
      ...(r.consent ? { description: `${r.summary}${CONSENT_NOTE}` } : {}),
      operationId: `${r.method}${r.path.replace(/\{|\}/g, "").replace(/(^|[/_-])(\w)/g, (_m, _p, c: string) => c.toUpperCase())}`,
      security: r.auth === "bearer" ? [{ bearer: [] }] : [],
      parameters,
      ...(r.request
        ? {
            requestBody: {
              required: r.method === "post" && r.path !== "/api/auth/signout",
              content: { [r.form ? "multipart/form-data" : "application/json"]: { schema: json(r.request, "input") } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "D-Human app API",
      version: CONTRACT_VERSION,
      description:
        "The routes the native apps use. Every answer is private, no-store. Only a 401 means signed out. Errors are { error, message? }. Requests with Authorization must not carry Origin or Sec-Fetch-* headers.",
    },
    servers: [{ url: "https://www.d-human.fit" }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "dht_ followed by 43 base64url characters." } } },
    paths,
  };
}
