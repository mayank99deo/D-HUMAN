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

export const CONTRACT_VERSION = "0.5.0";

type Method = "get" | "post" | "delete";
export type AppRoute = {
  method: Method;
  path: string;
  /** The route file under app/, which must export this method. */
  file: string;
  summary: string;
  /** bearer: the app's token; open: no sign-in (sign-in itself). */
  auth: "bearer" | "open";
  /** The web's own route, used by the apps as it is: its answers keep the web's headers (no Cache-Control). */
  web?: true;
  /** Nothing personal in it: public, cacheable for this many seconds (instead of private, no-store). */
  publicFor?: number;
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
    path: "/api/auth/code",
    file: "app/api/auth/code/route.ts",
    summary: "Email a 6-digit sign-in code, then exchange it at POST /api/auth/token. The web's own route, unchanged: no token needed, and its answers carry no Cache-Control.",
    auth: "open",
    web: true,
    request: s.CodeRequest,
    responses: { 200: s.CodeResponse, 400: refusal, 429: refusal, 503: refusal },
  },
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
    responses: { 200: s.MeResponse, 304: null, 401: refusal, 403: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/home",
    file: "app/api/home/route.ts",
    summary: "Home, as the web's /home shows it: bib, verdict, markers that matter, today's fuel, events, the stack line.",
    auth: "bearer",
    responses: { 200: s.HomeResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/fuel",
    file: "app/api/fuel/route.ts",
    summary: "Fuel, as the web's /fuel shows it: today's totals against targets, today's meals, the usual day, food gaps and the plan.",
    auth: "bearer",
    responses: { 200: s.FuelResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/fuel/past",
    file: "app/api/fuel/past/route.ts",
    summary: "Past meals: the 28 days before today that have meals, newest first, labelled as the web labels them.",
    auth: "bearer",
    responses: { 200: s.PastMealsResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/fuel/facts",
    file: "app/api/fuel/facts/route.ts",
    summary: "Facts for the meal wait screen, picked for this person. Rarely change: keep them with their ETag.",
    auth: "bearer",
    responses: { 200: s.FactsResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/plan",
    file: "app/api/plan/route.ts",
    summary: "The plan: reads and meal logs used and allowed, the pass and when it ends, and why one more isn't allowed now. No words or price.",
    auth: "bearer",
    responses: { 200: s.PlanJson, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/upload",
    file: "app/api/upload/route.ts",
    summary: "The Upload screen: the plan, the event the read aims at, facts for the wait, and the upload limits.",
    auth: "bearer",
    responses: { 200: s.UploadResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/reports",
    file: "app/api/reports/route.ts",
    summary: "Every report upload, newest first, as the web lists them. Dead reads are marked failed first.",
    auth: "bearer",
    responses: { 200: s.ReportsResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/reports/{id}/read",
    file: "app/api/reports/[id]/read/route.ts",
    summary: "A report's read, as the web's report page shows it: verdict, pointers, every marker by panel with its flag, the doctor's questions, the retest.",
    auth: "bearer",
    responses: { 200: s.ReadResponse, 304: null, 401: refusal, 403: refusal, 404: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "get",
    path: "/api/stack",
    file: "app/api/stack/route.ts",
    summary:
      "The Stack, as the web's /stack shows it: the stack, why it's out of date or held, the hold's words, flagged results, and a fit for every budget slab. Held or out of date: no plan, no doses.",
    auth: "bearer",
    responses: { 200: s.StackResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "post",
    path: "/api/stack",
    file: "app/api/stack/route.ts",
    summary:
      "Build a stack, or follow the one already building. 409 health_check_needed until the health question is answered (G2); 409 no_data when there's no report and too little food; 429 daily_limit.",
    auth: "bearer",
    responses: { 200: s.StackBuildResponse, 401: refusal, 409: refusal, 429: refusal },
    consent: true,
  },
  {
    method: "get",
    path: "/api/stack/{id}",
    file: "app/api/stack/[id]/route.ts",
    summary: "A stack build's progress. A build that died is ended as failed.",
    auth: "bearer",
    responses: { 200: s.StackStatusResponse, 401: refusal, 404: refusal },
  },
  {
    method: "post",
    path: "/api/profile",
    file: "app/api/profile/route.ts",
    summary:
      "Save profile answers (onboarding, Settings, the budget, the health question). Health answers need consent first (403 consent_required). With consent: true, agrees to the current consent wording. After onboarding, a save that changes city, sport or named event sets off a paid event search: 3 a week, and none while the apps' daily limit is reached. Past either, the save still goes through (200) and only the search is skipped, so a health answer in the same save is never lost. 429 is the hourly save limit.",
    auth: "bearer",
    request: s.ProfileRequest,
    responses: { 200: s.SavedResponse, 400: refusal, 401: refusal, 403: refusal, 429: refusal },
  },
  {
    method: "post",
    path: "/api/food/typical",
    file: "app/api/food/typical/route.ts",
    summary:
      "Save the usual day, estimated three times and averaged. Answers the day with short (too light to count) and runs (G7). The same words again within 3 minutes return that save, uncounted. 5 saves a day, then 429 with Retry-After; 429 paused when the apps' daily limit is reached. Never queue it offline.",
    auth: "bearer",
    request: s.TypicalRequest,
    responses: { 200: s.TypicalAnswer, 400: refusal, 401: refusal, 409: refusal, 422: refusal, 429: refusal, 500: refusal, 503: refusal },
    consent: true,
  },
  {
    method: "get",
    path: "/api/wraps",
    file: "app/api/wraps/route.ts",
    summary: "Wraps, as the web lists them: each period's card, with its story when made. ?period=week: weeks only (G5). ?week=YYYY-MM-DD adds that week. Marker cards carry a flag (G12).",
    auth: "bearer",
    responses: { 200: s.WrapsResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "post",
    path: "/api/wraps",
    file: "app/api/wraps/route.ts",
    summary: "Make a period's wrap from its meals: { id } to fetch with GET /api/wraps, or { empty: true } when there's nothing to wrap.",
    auth: "bearer",
    request: s.WrapMakeRequest,
    responses: { 200: s.WrapMakeResponse, 400: refusal, 401: refusal, 409: refusal, 429: refusal, 500: refusal, 503: refusal },
    consent: true,
  },
  {
    method: "get",
    path: "/api/settings",
    file: "app/api/settings/route.ts",
    summary: "Settings: the plan, the passes bought (dates only), the email settings and how the weekly wrap arrives (G6). The profile is in GET /api/me; devices in GET /api/me/sessions.",
    auth: "bearer",
    responses: { 200: s.SettingsResponse, 304: null, 401: refusal, 403: refusal, 409: refusal },
    etag: true,
  },
  {
    method: "post",
    path: "/api/billing/store-token",
    file: "app/api/billing/store-token/route.ts",
    summary: "The appAccountToken for an in-app purchase (G8): made on first use, the same ever after. Never our user id.",
    auth: "bearer",
    responses: { 200: s.StoreTokenResponse, 401: refusal, 403: refusal, 409: refusal },
  },
  {
    method: "get",
    path: "/api/reports/{id}",
    file: "app/api/reports/[id]/route.ts",
    summary: "A report's progress while it's read: status, step of steps, and how many markers have been found so far (counts only). A read that died is ended as failed.",
    auth: "bearer",
    responses: { 200: s.ReportStatusResponse, 401: refusal, 404: refusal },
  },
  {
    method: "delete",
    path: "/api/reports/{id}",
    file: "app/api/reports/[id]/route.ts",
    summary: "Delete one report with its files, markers, read, stack and any wrap that counted it. The read it used still counts. One that's gone answers the same.",
    auth: "bearer",
    responses: { 200: s.DeletedResponse, 401: refusal },
  },
  {
    method: "post",
    path: "/api/events/target",
    file: "app/api/events/target/route.ts",
    summary: "Pick the event the read and the bib aim at, from the person's list, or clear it. No search, no cost. Naming a new event in mind is POST /api/profile (eventInMind), which counts against the week's searches.",
    auth: "bearer",
    request: s.EventTargetRequest,
    responses: { 200: s.SavedResponse, 400: refusal, 401: refusal, 404: refusal },
  },
  {
    method: "post",
    path: "/api/profile/tour",
    file: "app/api/profile/tour/route.ts",
    summary: "The first-run tour finished or skipped. Only the first time is kept.",
    auth: "bearer",
    request: s.TourRequest,
    responses: { 200: s.TourResponse, 401: refusal, 429: refusal },
  },
  {
    method: "get",
    path: "/api/app/options",
    file: "app/api/app/options/route.ts",
    summary: "Every list onboarding and Settings show, with ids and labels. Not personal: no sign-in, public for an hour.",
    auth: "open",
    responses: { 200: s.OptionsResponse, 304: null },
    etag: true,
    publicFor: 3600,
  },
  {
    method: "get",
    path: "/api/app/config",
    file: "app/api/app/config/route.ts",
    summary: "The apps' remote config: versions, the store link, the API's address, links, and the switches turned off. No sign-in; public for 5 minutes.",
    auth: "open",
    responses: { 200: s.ConfigResponse, 304: null },
    etag: true,
    publicFor: 300,
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
    responses: { 200: s.AppMealAnswer, 400: refusal, 401: refusal, 402: refusal, 403: refusal, 409: refusal, 413: refusal, 415: refusal, 422: refusal, 429: refusal, 500: refusal, 503: refusal },
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
  403: "Refused, but still signed in: keep the token. not_for_app: a web-only route; bearer_required: a web cookie was sent instead of the token; switched_off (with switch): a remote switch has turned this off (voice, snap, again, iap); bad_origin.",
  404: "Not found (another person's id looks the same).",
  409: "not_onboarded, consent_needed (ask again, then resend with the same key), in_progress (resend the same try after Retry-After), or the route's own code.",
  413: "Too large.",
  415: "Not a file type we read.",
  422: "Read, but refused: `message` says what to try.",
  429: "Too many tries. Retry-After says when to come back, when it's sent.",
  500: "Something failed on our side. Try again with the same key.",
  501: "Not available yet.",
  503: "Not available just now: ai_off (AI is switched off on this server), or a sign-in code couldn't be sent. Show `message`.",
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
        ...(r.web ? {} : { "Cache-Control": { schema: { type: "string", const: r.publicFor ? `public, max-age=${r.publicFor}` : "private, no-store" } } }),
        ...(r.etag && (status === "200" || status === "304") ? { ETag: { schema: { type: "string" } } } : {}),
        ...((status === "429" || (status === "409" && r.method !== "get")) && !r.web
          ? { "Retry-After": { schema: { type: "integer" }, description: "Seconds. Sent with 429, and with 409 in_progress." } }
          : {}),
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
        "The routes the native apps use. Every answer is private, no-store, except POST /api/auth/code's (the web's route, unchanged). Only a 401 means signed out: a missing, malformed, expired or revoked token. Every other /api route answers a live token with 403 not_for_app (it isn't open to the apps yet): keep the sign-in. Errors are { error, message? }. Requests with Authorization must not carry Origin or Sec-Fetch-* headers. Every signed-in route answers 426 update_required ({ error, message, minVersion, updateUrl }) when X-DHuman-Client names an iOS version below GET /api/app/config's minSupported; config and sign-out stay open.",
    },
    servers: [{ url: "https://www.d-human.fit" }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "dht_ followed by 43 base64url characters." } } },
    paths,
  };
}
