// Every email carries the brand (Mayank, 2026-11-24): the D-Human wordmark and the tagline,
// "Hack your health.", in the HTML and the plain-text part.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { renderEmail } = await import("../lib/email/templates/index.ts");
const { emailSamples } = await import("../lib/email/templates/samples.ts");
const { TAGLINE } = await import("../lib/email/templates/parts.ts");
const { signInCodeEmail } = await import("../lib/auth/email.ts");

const SITE = "https://www.d-human.fit";

describe("the brand in every email", () => {
  it("the tagline is the brand's own words", () => assert.equal(TAGLINE, "Hack your health."));

  for (const s of emailSamples(SITE)) {
    it(`${s.title}: the wordmark and "Hack your health."`, () => {
      const e = renderEmail(s.email, s.frame);
      assert.match(e.html, /\/email\/wordmark\.png" [^>]*alt="D-Human"/, "the white wordmark at the top");
      assert.ok(e.html.includes("Hack your health."), "the tagline in the HTML");
      assert.ok(e.text.includes("Hack your health."), "the tagline in the plain text");
    });
  }

  it("the sign-in code email: the ink wordmark, the code, and the tagline", () => {
    const e = signInCodeEmail("123456", SITE);
    assert.equal(e.subject, "123 456 is your D-Human code");
    assert.match(e.html, /src="https:\/\/www\.d-human\.fit\/email\/wordmark-ink\.png"[^>]*alt="D-Human"/);
    assert.ok(e.html.includes("123 456"));
    assert.ok(e.html.includes("Hack your health."));
    assert.ok(e.text.includes("Hack your health."));
    assert.ok(!e.html.includes(">D-HUMAN<"), "the logo image, not typed letters");
  });
});
