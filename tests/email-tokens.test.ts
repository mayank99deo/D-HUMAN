// Signed email links (lib/email/tokens.ts): stop links never expire and can't pass as
// feedback links; feedback links last 30 days; anything altered, cut short or signed with
// another secret is refused; production without EMAIL_LINK_SECRET signs nothing.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
process.env.EMAIL_LINK_SECRET = "test-email-link-secret";
const tokens = await import("../lib/email/tokens.ts");
const { FEEDBACK_TOKEN_DAYS } = await import("../lib/email/types.ts");

const USER = "0b6f7c1e-4d2a-4c3e-9a7b-1f2e3d4c5b6a";
const DAY = 24 * 60 * 60 * 1000;

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
  try {
    run();
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// Re-signs a changed payload with a guessed key, the way an attacker without the secret would.
function forge(payload: object, secret = "guess") {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createHmac("sha256", secret).update("d-human/email-link/v1/stop").digest();
  return `v1.${body}.${createHmac("sha256", key).update(`v1.${body}`).digest("base64url")}`;
}

describe("stop links", () => {
  it("round-trip: the person and the kind come back", () => {
    const t = tokens.stopToken(USER, "weekly");
    assert.match(t, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(tokens.readStopToken(t), { p: "stop", u: USER, k: "weekly" });
    assert.ok(t.length < 200, "short enough for a header and a link");
  });

  it("never expire: a link from years ago still works", () => {
    const t = tokens.stopToken(USER, "questions");
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 365 * DAY;
    try {
      assert.equal(tokens.readStopToken(t)?.k, "questions");
    } finally {
      Date.now = realNow;
    }
  });

  it("carry no email address, only the person's id", () => {
    const body = Buffer.from(tokens.stopToken(USER, "weekly").split(".")[1], "base64url").toString();
    assert.doesNotMatch(body, /@/);
  });

  it("refuse anything altered: payload, signature, version, or a swapped kind", () => {
    const t = tokens.stopToken(USER, "weekly");
    const [v, body, sig] = t.split(".");
    const otherBody = Buffer.from(JSON.stringify({ p: "stop", u: "someone-else", k: "weekly" })).toString("base64url");
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    for (const bad of [
      `${v}.${otherBody}.${sig}`, // another person, old signature
      `${v}.${body}.${flipped}`,
      `v2.${body}.${sig}`,
      `${v}.${body}`,
      `${t}.extra`,
      t.slice(0, -3), // cut short when copied
      forge({ p: "stop", u: USER, k: "questions" }),
      "",
      "not a token",
      `${v}.${body}.${sig}`.replace(/./, " "),
      "x".repeat(600),
    ]) {
      assert.equal(tokens.readStopToken(bad), null, bad.slice(0, 40));
    }
    assert.equal(tokens.readStopToken(undefined), null);
    assert.equal(tokens.readStopToken(42), null);
  });

  it("refuse a kind that isn't a switch, even when correctly signed", () => {
    // Signed with the real key but a made-up kind: the schema check still refuses it.
    const body = Buffer.from(JSON.stringify({ p: "stop", u: USER, k: "everything" })).toString("base64url");
    const key = createHmac("sha256", "test-email-link-secret").update("d-human/email-link/v1/stop").digest();
    const sig = createHmac("sha256", key).update(`v1.${body}`).digest("base64url");
    assert.equal(tokens.readStopToken(`v1.${body}.${sig}`), null);
  });

  it("stop working when the secret changes (so keep EMAIL_LINK_SECRET stable)", () => {
    const t = tokens.stopToken(USER, "weekly");
    withEnv({ EMAIL_LINK_SECRET: "rotated" }, () => assert.equal(tokens.readStopToken(t), null));
    assert.ok(tokens.readStopToken(t));
  });

  it("build the stop page and one-click URLs on the given origin", () => {
    const page = new URL(tokens.stopPageUrl(USER, "weekly", "https://www.d-human.fit"));
    assert.equal(page.origin + page.pathname, "https://www.d-human.fit/email/stop");
    assert.equal(tokens.readStopToken(page.searchParams.get("t"))?.u, USER);
    const oneClick = new URL(tokens.oneClickUrl(USER, "questions", "https://www.d-human.fit/"));
    assert.equal(oneClick.pathname, "/api/email/unsubscribe");
    assert.equal(tokens.readStopToken(oneClick.searchParams.get("t"))?.k, "questions");
  });
});

describe("feedback links", () => {
  it("round-trip within 30 days, refused after", () => {
    const now = Date.UTC(2026, 10, 18);
    const t = tokens.feedbackToken(USER, "fb-1", now);
    assert.equal(tokens.readFeedbackToken(t, now)?.s, "fb-1");
    assert.equal(tokens.readFeedbackToken(t, now + (FEEDBACK_TOKEN_DAYS - 1) * DAY)?.u, USER);
    assert.equal(tokens.readFeedbackToken(t, now + (FEEDBACK_TOKEN_DAYS + 1) * DAY), null);
  });
});

describe("purposes stay apart", () => {
  it("a stop link is not a feedback link, and a feedback link is not a stop link", () => {
    const stop = tokens.stopToken(USER, "weekly");
    const fb = tokens.feedbackToken(USER, "fb-1");
    assert.equal(tokens.readFeedbackToken(stop), null);
    assert.equal(tokens.readStopToken(fb), null);
  });
});

describe("configuration", () => {
  it("production without EMAIL_LINK_SECRET signs nothing and accepts nothing", () => {
    const t = tokens.stopToken(USER, "weekly");
    withEnv({ EMAIL_LINK_SECRET: undefined, NODE_ENV: "production", VERCEL: "1" }, () => {
      assert.equal(tokens.emailLinksReady(), false);
      assert.throws(() => tokens.stopToken(USER, "weekly"), /EMAIL_LINK_SECRET/);
      assert.equal(tokens.readStopToken(t), null);
    });
  });

  it("local dev without the secret still works, with a fixed development key", () => {
    withEnv({ EMAIL_LINK_SECRET: undefined, NODE_ENV: "development", VERCEL: undefined }, () => {
      assert.equal(tokens.emailLinksReady(), true);
      const t = tokens.stopToken(USER, "weekly");
      assert.equal(tokens.readStopToken(t)?.u, USER);
    });
  });
});
