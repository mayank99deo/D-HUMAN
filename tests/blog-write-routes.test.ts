// Every /api/write route checks the writer on the server: signed out gets 401, a
// signed-in non-writer 404 (the routes don't reveal themselves), a write from another
// site 403. Then the happy paths a writer's browser takes, with real sessions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { allowAppImports, tempDatabase } from "./support/app.ts";

type G = { __cookie: string | undefined };
const g = globalThis as unknown as G;

allowAppImports({
  "next/cache": "export const cacheLife = () => {}; export const cacheTag = () => {}; export const revalidateTag = () => {};",
  "next/headers": "export const cookies = async () => ({ get: () => (globalThis.__cookie ? { value: globalThis.__cookie } : undefined) });",
  "next/server": "export const connection = async () => {}; export const after = (fn) => { fn(); };",
});
const removeDatabase = tempDatabase();
process.env.BLOG_OWNER_EMAILS = "mayank@d-human.fit";

const { db, schema } = await import("../lib/db/index.ts");
const { emptyDraft } = await import("../lib/blog/checks.ts");
const posts = await import("../app/api/write/posts/route.ts");
const post = await import("../app/api/write/posts/[id]/route.ts");
const publish = await import("../app/api/write/posts/[id]/publish/route.ts");
const imagesRoute = await import("../app/api/write/images/route.ts");
const imageFile = await import("../app/api/write/images/[id]/[file]/route.ts");
const profile = await import("../app/api/write/profile/route.ts");

const ORIGIN = "http://localhost:3017";
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

function req(path: string, { method = "POST", body, origin = ORIGIN, json = true }: { method?: string; body?: unknown; origin?: string | null; json?: boolean } = {}) {
  const headers = new Headers({ host: "localhost:3017" });
  if (origin) headers.set("origin", origin);
  if (json && body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : json ? JSON.stringify(body) : (body as BodyInit) });
}

async function signIn(email: string, ageDays = 0) {
  const d = await db();
  const id = crypto.randomUUID();
  await d.insert(schema.users).values({ id, email }).onConflictDoNothing();
  const userId = (await d.select({ id: schema.users.id, email: schema.users.email }).from(schema.users)).find((r) => r.email === email)!.id;
  const token = crypto.randomUUID();
  const createdAt = new Date(Date.now() - ageDays * 86_400_000);
  await d.insert(schema.sessions).values({ id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 86_400_000), createdAt });
  return token;
}

let writer: string;
let stranger: string;

before(async () => {
  writer = await signIn("mayank@d-human.fit");
  stranger = await signIn("someone@example.com");
});
after(removeDatabase);

describe("the gate", () => {
  it("answers 401 signed out, 404 to non-writers, 403 to other sites, on every kind of route", async () => {
    const calls: [string, () => Promise<Response>][] = [
      ["create", () => posts.POST(req("/api/write/posts", { body: {} }))],
      ["read", () => post.GET(req("/api/write/posts/x", { method: "GET", origin: null }), ctx({ id: "x" }))],
      ["save", () => post.PUT(req("/api/write/posts/x", { method: "PUT", body: { baseVersion: 1, draft: {} } }), ctx({ id: "x" }))],
      ["publish", () => publish.POST(req("/api/write/posts/x/publish", { body: {} }), ctx({ id: "x" }))],
      ["image", () => imageFile.GET(req("/api/write/images/x/y", { method: "GET", origin: null }), ctx({ id: "x", file: "y" }))],
      ["profile", () => profile.PUT(req("/api/write/profile", { method: "PUT", body: {} }))],
    ];
    for (const [name, call] of calls) {
      g.__cookie = undefined;
      assert.equal((await call()).status, 401, `${name} signed out`);
      g.__cookie = stranger;
      assert.equal((await call()).status, 404, `${name} as a non-writer`);
    }
    g.__cookie = writer;
    assert.equal((await posts.POST(req("/api/write/posts", { body: {}, origin: "https://evil.example" }))).status, 403);
    assert.equal((await posts.POST(req("/api/write/posts", { body: {}, origin: null }))).status, 403);
  });

  it("takes JSON only", async () => {
    g.__cookie = writer;
    const form = await posts.POST(req("/api/write/posts", { body: "draft=x", json: false }));
    assert.equal(form.status, 400);
  });
});

describe("a writer's browser", () => {
  it("creates, autosaves, gets a 409 on a stale save, and can't publish without the checklist", async () => {
    g.__cookie = writer;
    const created = await posts.POST(req("/api/write/posts", { body: { draft: { title: "Imported", blocks: [{ id: "a", type: "paragraph", spans: [{ text: "Hello" }] }] } } }));
    assert.equal(created.status, 201);
    const { id } = await created.json();

    const read = await post.GET(req(`/api/write/posts/${id}`, { method: "GET", origin: null }), ctx({ id }));
    const editor = await read.json();
    assert.equal(editor.draft.title, "Imported");

    const next = { ...emptyDraft("first-post"), title: "First post", topic: "training", seoDescription: "x", blocks: editor.draft.blocks };
    const saved = await post.PUT(req(`/api/write/posts/${id}`, { method: "PUT", body: { baseVersion: editor.draftVersion, draft: next } }), ctx({ id }));
    assert.equal(saved.status, 200);
    const stale = await post.PUT(req(`/api/write/posts/${id}`, { method: "PUT", body: { baseVersion: editor.draftVersion, draft: next } }), ctx({ id }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, "conflict");

    const bad = await post.PUT(
      req(`/api/write/posts/${id}`, { method: "PUT", body: { baseVersion: (await saved.clone().json()).version, draft: { ...next, blocks: [{ id: "x", type: "paragraph", spans: [{ text: "x", href: "javascript:alert(1)" }] }] } } }),
      ctx({ id }),
    );
    assert.equal(bad.status, 422);

    const { version } = await saved.json();
    const noTicks = await publish.POST(req(`/api/write/posts/${id}/publish`, { body: { draftVersion: version, checklist: {}, meaningful: false, featured: false, shareImageId: null } }), ctx({ id }));
    assert.equal(noTicks.status, 422);
    assert.equal((await noTicks.json()).error, "checklist");
  });

  it("asks an old session to sign in again before publishing", async () => {
    g.__cookie = await signIn("mayank@d-human.fit", 10);
    const created = await posts.POST(req("/api/write/posts", { body: {} }));
    const { id } = await created.json();
    const r = await publish.POST(req(`/api/write/posts/${id}/publish`, { body: { draftVersion: 1, checklist: {}, meaningful: false, featured: false, shareImageId: null } }), ctx({ id }));
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, "sign_in_again");
  });

  it("uploads a photo's widths, refuses other files, and serves them to writers only", async () => {
    g.__cookie = writer;
    const webp = (width: number, height: number) => {
      const b = Buffer.alloc(64);
      b.write("RIFF", 0, "ascii");
      b.writeUInt32LE(56, 4);
      b.write("WEBP", 8, "ascii");
      b.write("VP8 ", 12, "ascii");
      b.writeUInt32LE(36, 16);
      b.set([0x9d, 0x01, 0x2a], 23);
      b.writeUInt16LE(width, 26);
      b.writeUInt16LE(height, 28);
      return new Uint8Array(b);
    };
    const upload = (files: Uint8Array[], kind = "photo") => {
      const form = new FormData();
      form.set("kind", kind);
      for (const f of files) form.append("file", new Blob([f.buffer as ArrayBuffer], { type: "image/png" }), "x.png");
      return imagesRoute.POST(req("/api/write/images", { body: form, json: false }));
    };
    const ok = await upload([webp(480, 320), webp(960, 640)]);
    assert.equal(ok.status, 201);
    const { image } = await ok.json();
    assert.equal(image.width, 960);

    const svg = await upload([new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>")]);
    assert.equal(svg.status, 415);

    const file = image.files[0].name;
    const served = await imageFile.GET(req(`/api/write/images/${image.id}/${file}`, { method: "GET", origin: null }), ctx({ id: image.id, file }));
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/webp");
    assert.match(served.headers.get("cache-control") ?? "", /private/);
    g.__cookie = stranger;
    assert.equal((await imageFile.GET(req(`/api/write/images/${image.id}/${file}`, { method: "GET", origin: null }), ctx({ id: image.id, file }))).status, 404);
  });
});
