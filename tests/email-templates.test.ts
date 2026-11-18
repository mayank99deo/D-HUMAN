// The lifecycle email templates (lib/email/templates): every kind and variant renders, stays
// under Gmail's clip size and our budget, has a plain-text part, the footer, the stop link
// its kind needs, 44 px tap targets and alt text; and the copy checklist, in code: no
// "doctor-reviewed", no "accurate", "free" only in "Free to start", no marker names, no
// calories or weight, no guilt words, nothing about Monday wraps, no data in subjects.
// Then the dev preview route: 404 in production, every sample as HTML and as text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MARKERS } from "../lib/domain/markers.ts";
import { EMAIL_KINDS, KIND_CATEGORY, type EmailKind } from "../lib/email/types.ts";
import {
  GMAIL_CLIP_BYTES,
  HTML_BUDGET_BYTES,
  TEMPLATES,
  feedbackEmail,
  renderEmail,
  weeklyEmail,
  welcomeEmail,
} from "../lib/email/templates/index.ts";
import { clip, dateSpan, link } from "../lib/email/templates/parts.ts";
import { emailSamples, sampleFrame } from "../lib/email/templates/samples.ts";
import { allowAppImports } from "./support/app.ts";

const SITE = "https://www.d-human.fit";
const samples = emailSamples(SITE);
const rendered = samples.map((s) => ({ ...s, out: renderEmail(s.email, s.frame) }));

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
/** What a reader sees: no head, no tags, no URLs. */
const visible = (html: string) =>
  decode(html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<[^>]+>/g, " "))
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ");
const plainWords = (text: string) => text.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ");
const allCopy = (r: (typeof rendered)[number]) =>
  [r.out.subject, r.out.preheader, visible(r.out.html), plainWords(r.out.text)].join(" \n ");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("email templates: coverage", () => {
  it("every kind has a template and at least one sample", () => {
    assert.deepEqual(Object.keys(TEMPLATES).sort(), [...EMAIL_KINDS].sort());
    for (const kind of EMAIL_KINDS) assert.ok(samples.some((s) => s.email.kind === kind), `no sample for ${kind}`);
  });

  it("covers the weekly versions and both feedback paths", () => {
    const weekly = samples.flatMap((s) => (s.email.kind === "weekly" ? [s.email.data.version] : []));
    assert.deepEqual([...new Set(weekly)].sort(), ["full", "light", "report"]);
    const paths = samples.flatMap((s) => (s.email.kind === "feedback" ? [s.email.data.path] : []));
    assert.deepEqual([...new Set(paths)].sort(), ["barely", "used"]);
  });
});

describe("email templates: every sample", () => {
  for (const r of rendered) {
    describe(r.id, () => {
      const { subject, preheader, html, text } = r.out;
      const kind = r.email.kind as EmailKind;

      it("renders a whole page with one h1, the subject as title and the preheader", () => {
        assert.ok(subject.length > 0 && subject.length <= 60, subject);
        assert.ok(preheader.length > 0 && preheader.length <= 110, preheader);
        assert.match(html, /^<!doctype html>\n<html lang="en">/);
        assert.equal(html.match(/<h1\b/g)?.length, 1);
        assert.ok(html.includes(`<title>${subject.replace(/'/g, "&#39;")}</title>`));
        assert.ok(html.includes(preheader.replace(/'/g, "&#39;")));
        assert.match(html, /<meta name="color-scheme" content="light dark">/);
      });

      it("stays under our 40 KB budget, well inside Gmail's 102 KB clip", () => {
        const bytes = Buffer.byteLength(html);
        assert.ok(bytes < HTML_BUDGET_BYTES, `${bytes} bytes`);
        assert.ok(bytes < GMAIL_CLIP_BYTES);
      });

      it("has a plain-text part with the actions, settings and disclaimer", () => {
        assert.ok(text.length > 200);
        assert.doesNotMatch(text, /<[a-z][^>]*>/i);
        assert.ok(text.includes("D-Human offers wellness guidance and screening. It does not diagnose or treat any condition."));
        assert.ok(text.includes(`Email settings: ${SITE}/settings?e=snd_sample#emails`));
        for (const href of [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => decode(m[1]))) {
          assert.ok(text.includes(href), `text part is missing ${href}`);
        }
      });

      it("has the footer: Email settings, the disclaimer, and the stop link only where its kind has one", () => {
        assert.ok(html.includes(`href="${SITE}/settings?e=snd_sample#emails"`));
        assert.ok(visible(html).includes("It does not diagnose or treat any condition."));
        const stoppable = KIND_CATEGORY[kind] !== null;
        assert.equal(stoppable, r.frame.stopUrl !== null);
        if (stoppable) {
          const stop = link(r.frame, r.frame.stopUrl!);
          assert.ok(html.includes(`href="${stop.replace(/&/g, "&#38;")}"`), "stop link missing from html");
          assert.ok(text.includes(stop), "stop link missing from text");
          assert.match(visible(html), /Stop (weekly wraps|questions like this)/);
        } else {
          assert.doesNotMatch(visible(html), /\bStop\b/);
        }
      });

      it("carries e=<sendId> on every link to the site, once", () => {
        for (const href of [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => decode(m[1]))) {
          if (!href.startsWith(SITE)) continue;
          assert.equal(href.match(/[?&]e=snd_sample/g)?.length, 1, href);
        }
      });

      it("makes every link a tap target of at least 44 px", () => {
        const anchors = [...html.matchAll(/<a\b[^>]*style="([^"]*)"/g)].map((m) => m[1]);
        assert.equal(anchors.length, html.match(/<a\b/g)?.length, "every link has inline styles");
        for (const style of anchors) {
          assert.match(style, /display:(inline-)?block/, style);
          const pad = style.match(/padding:([\d\spx]+?)(;|$)/)?.[1].trim().split(/\s+/).map((v) => parseFloat(v));
          assert.ok(pad, style);
          const [top, bottom] = pad.length === 1 ? [pad[0], pad[0]] : pad.length === 2 ? [pad[0], pad[0]] : [pad[0], pad[2]];
          const line = Number(style.match(/line-height:(\d+)px/)?.[1] ?? style.match(/\/(\d+)px/)?.[1]);
          assert.ok(top + bottom + line >= 44, `${top + bottom + line} px: ${style}`);
        }
      });

      it("gives every image alt text, and the pictogram a real one", () => {
        for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
          assert.match(img, /\salt="[^"]*"/, img);
          if (img.includes("/pictograms/")) assert.match(img, /\salt="[^"]+"/, img);
          if (img.includes("wordmark")) assert.match(img, /\salt="D-Human"/, img);
        }
      });

      it("paints every surface with a real background colour (inverters key on it)", () => {
        for (const style of [...html.matchAll(/style="([^"]*background-image[^"]*)"/g)].map((m) => m[1])) {
          assert.match(style, /background-color:#[0-9a-f]{6}/, style);
        }
      });

      it("passes the copy checklist", () => {
        const copy = allCopy(r);
        assert.doesNotMatch(copy, /doctor[\s-]*reviewed/i);
        assert.doesNotMatch(copy, /accura/i);
        assert.doesNotMatch(copy.replace(/Free to start/g, ""), /\bfree\b/i, "'free' outside 'Free to start'");
        assert.doesNotMatch(copy, /\b(verdict|doctor first|diagnosed with|you have)\b/i);
        assert.doesNotMatch(copy, /\b(missed|failed|broke|streak|behind|hurry|last chance|don't lose|we miss you|cheat|guilt-free|junk)\b/i);
        assert.doesNotMatch(copy, /\bkcal\b|\d[\d,.]*\s*(cal|calories)\b/i, "calorie numbers");
        assert.doesNotMatch(copy, /\d[\d.]*\s*kg\b|\bweigh(t|s)? \d/i, "weight");
        assert.doesNotMatch(copy, /\bMonday\b/, "weekly wraps go on Sunday evening");
        assert.doesNotMatch(copy, /is wrapped/i, "the week is 'so far', not wrapped");
      });

      it("names no blood marker", () => {
        const copy = allCopy(r);
        for (const m of MARKERS) {
          assert.doesNotMatch(copy, new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(m.name)}($|[^\\p{L}\\p{N}])`, "iu"), m.name);
          // Short names are matched as written; "Protein" (total protein) is the food word here.
          if (m.short.length >= 2 && m.short !== "Protein")
            assert.doesNotMatch(copy, new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(m.short)}($|[^\\p{L}\\p{N}])`, "u"), m.short);
        }
      });

      it("keeps food and health data out of the subject and preheader (names and dates only)", () => {
        assert.doesNotMatch(`${subject} ${preheader}`, /\d/);
        assert.doesNotMatch(`${subject} ${preheader}`, /\b(report read|meals logged|poha|g of protein)\b/i);
      });
    });
  }
});

describe("email templates: rules in code", () => {
  const weekly = samples.find((s) => s.id === "weekly")!;
  const welcome = samples.find((s) => s.id === "welcome")!;
  if (weekly.email.kind !== "weekly" || welcome.email.kind !== "welcome") throw new Error("samples changed");
  const weeklyData = weekly.email.data;
  const welcomeData = welcome.email.data;

  it("refuses to render a stoppable email without its stop link", () => {
    assert.throws(() => weeklyEmail(weeklyData, { ...weekly.frame, stopUrl: null }), /stopUrl/);
    const fb = samples.find((s) => s.id === "feedback")!;
    const fbEmail = fb.email;
    if (fbEmail.kind !== "feedback") throw new Error("samples changed");
    const fbData = fbEmail.data;
    assert.throws(() => feedbackEmail(fbData, { ...fb.frame, stopUrl: null }), /stopUrl/);
  });

  it("escapes names and labels in HTML", () => {
    const frame = sampleFrame("welcome", SITE, { firstName: `<img src=x onerror=alert(1)>` });
    const out = welcomeEmail({ ...welcomeData, label: `Runner "fast" & <b>bold</b>` }, frame);
    assert.doesNotMatch(out.html, /<img src=x/);
    assert.doesNotMatch(out.html, /<b>bold<\/b>/);
    assert.match(out.html, /&#60;b&#62;bold&#60;\/b&#62;/);
  });

  it("drops the persona's fallback name 'You' instead of greeting 'You're in, You.'", () => {
    const out = welcomeEmail(welcomeData, sampleFrame("welcome", SITE, { firstName: "You" }));
    assert.equal(out.subject, "You're in. Here's your number.");
    assert.doesNotMatch(out.html, /in, You\./);
  });

  it("shows the protein number only when the weight is known, and never a g-per-kg figure", () => {
    const withNumber = welcomeEmail(welcomeData, welcome.frame);
    assert.match(visible(withNumber.html), /96 g of protein a day/);
    const without = welcomeEmail({ ...welcomeData, proteinTargetG: null }, welcome.frame);
    assert.doesNotMatch(visible(without.html), /Your number|g of protein a day/);
    assert.equal(without.subject, "Welcome to D-Human, Priya");
    assert.doesNotMatch(allCopy({ ...welcome, out: withNumber }), /g\s*(per|\/)\s*kg/i);
  });

  it("steps long names down a size, so a 390 px phone never scrolls sideways", () => {
    const long = rendered.find((x) => x.id === "welcome-long")!.out.html;
    assert.match(long, /<h1 class="h1 h1-long" style="margin:0;font:800 40px\/44px/);
    assert.match(long, /<tr><td colspan="2"><p style="margin:6px 0 0;font:700 20px\/24px[^"]*overflow-wrap:break-word/);
    const short = rendered.find((x) => x.id === "welcome")!.out.html;
    assert.match(short, /<h1 class="h1" style="margin:0;font:800 48px\/50px/);
    assert.doesNotMatch(short, /colspan="2"><p/);
  });

  it("falls back to the starting pictogram for an unknown archetype", () => {
    const out = welcomeEmail({ ...welcomeData, archetype: "parkour" }, welcome.frame);
    assert.match(out.html, /\/email\/pictograms\/starting\.png" width="80" height="80" alt="Fresh start"/);
  });

  it("colours a square only where the protein aim was reached, always with a check", () => {
    const html = weeklyEmail(weeklyData, weekly.frame).html;
    const serum = html.match(/<td[^>]*bgcolor="#b5d2c0"[^>]*>[^<]*<\/td>/g) ?? [];
    // Four days in the squares, plus the legend's swatch.
    assert.equal(serum.length, weeklyData.days.filter((d) => d.proteinReached).length + 1);
    for (const cell of serum) assert.match(cell, /&#10003;/);
    assert.doesNotMatch(html, /#e3a5a2|#e2d3a2/i, "no marker status colours in email");
  });

  it("says 'up from' only when this week is higher, and never mentions a drop", () => {
    const same = weeklyEmail({ ...weeklyData, upFromDays: weeklyData.daysLogged }, weekly.frame);
    const higher = weeklyEmail({ ...weeklyData, upFromDays: 7 }, weekly.frame);
    assert.doesNotMatch(visible(same.html), /Up from/);
    assert.doesNotMatch(visible(higher.html), /Up from|down/i);
    assert.match(visible(weeklyEmail(weeklyData, weekly.frame).html), /Up from 3 logged days the week before\./);
  });

  it("leaves the squares out of the report version and says nothing about what a report said", () => {
    const r = rendered.find((x) => x.id === "weekly-report")!;
    assert.doesNotMatch(r.out.html, /#b5d2c0/);
    assert.match(visible(r.out.html), /1 report read this week/);
  });

  it("shows the top food only when it was logged at least twice, clipped and tagged with its language", () => {
    const once = weeklyEmail({ ...weeklyData, topFood: { title: "Poha", times: 1 } }, weekly.frame);
    assert.doesNotMatch(visible(once.html), /Poha/);
    const script = rendered.find((x) => x.id === "weekly-script")!;
    assert.match(script.out.html, /<span lang="hi" dir="auto"/);
  });

  it("adds the postal address only when one is set", () => {
    const before = process.env.EMAIL_POSTAL_ADDRESS;
    try {
      delete process.env.EMAIL_POSTAL_ADDRESS;
      assert.doesNotMatch(welcomeEmail(welcomeData, welcome.frame).text, /Bengaluru/);
      const given = welcomeEmail(welcomeData, { ...welcome.frame, postalAddress: "12 MG Road, Bengaluru 560001" });
      assert.match(given.text, /D-Human, 12 MG Road, Bengaluru 560001/);
      assert.match(given.html, /12 MG Road, Bengaluru 560001/);
      process.env.EMAIL_POSTAL_ADDRESS = "4 Park Street, Kolkata 700016";
      assert.match(welcomeEmail(welcomeData, welcome.frame).text, /D-Human, 4 Park Street, Kolkata 700016/);
      assert.doesNotMatch(welcomeEmail(welcomeData, { ...welcome.frame, postalAddress: null }).text, /Park Street/);
    } finally {
      if (before === undefined) delete process.env.EMAIL_POSTAL_ADDRESS;
      else process.env.EMAIL_POSTAL_ADDRESS = before;
    }
  });

  it("loads images from assetUrl when given (the preview), else from the site", () => {
    assert.match(welcomeEmail(welcomeData, welcome.frame).html, /src="https:\/\/www\.d-human\.fit\/email\/wordmark\.png"/);
    const local = welcomeEmail(welcomeData, { ...welcome.frame, assetUrl: "http://localhost:3017/" });
    assert.match(local.html, /src="http:\/\/localhost:3017\/email\/pictograms\/running\.png"/);
  });
});

describe("email template helpers", () => {
  it("writes week spans in words", () => {
    assert.equal(dateSpan("2026-11-16", "2026-11-22"), "16 to 22 November");
    assert.equal(dateSpan("2026-11-30", "2026-12-06"), "30 November to 6 December");
  });

  it("clips long titles at a word", () => {
    assert.equal(clip("Poha"), "Poha");
    assert.equal(clip("Chicken curry with two cups of rice and salad"), "Chicken curry with two cups…");
    assert.ok([...clip("दाल चावल और आलू की सब्ज़ी और रायता और पापड़")].length <= 29);
  });

  it("adds e= once, before the fragment, and only on our own site", () => {
    const frame = sampleFrame("weekly", SITE);
    assert.equal(link(frame, "/settings#emails"), `${SITE}/settings?e=snd_sample#emails`);
    assert.equal(link(frame, "/wraps?week=2026-11-16"), `${SITE}/wraps?week=2026-11-16&e=snd_sample`);
    assert.equal(link(frame, `${SITE}/fuel?e=x`), `${SITE}/fuel?e=x`);
    assert.equal(link(frame, "https://example.com/a"), "https://example.com/a");
    assert.equal(link(frame, "//evil.example/a"), "//evil.example/a");
  });
});

describe("dev preview route (/api/email-preview)", async () => {
  allowAppImports();
  const { GET } = await import("../app/api/email-preview/route.ts");
  const env = process.env as Record<string, string | undefined>;
  const call = async (query: string, nodeEnv = "development") => {
    const before = env.NODE_ENV;
    env.NODE_ENV = nodeEnv;
    try {
      return await GET(new Request(`http://localhost:3017/api/email-preview${query}`));
    } finally {
      env.NODE_ENV = before;
    }
  };

  it("is 404 in production", async () => {
    assert.equal((await call("?kind=weekly", "production")).status, 404);
    assert.equal((await call("", "production")).status, 404);
  });

  it("lists every sample, and renders each as HTML and as text, with images from this server", async () => {
    const index = await (await call("")).text();
    for (const s of samples) assert.ok(index.includes(`?kind=${s.id}"`), s.id);
    const page = await call("?kind=weekly-light");
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await page.text(), /src="http:\/\/localhost:3017\/email\/wordmark\.png"/);
    const text = await (await call("?kind=feedback&format=text")).text();
    assert.match(text, /^Subject: Two taps to shape D-Human\nPreheader: /);
    assert.equal((await call("?kind=nope")).status, 404);
    assert.match(await (await call("?kind=waitlist")).text(), /You're on/);
  });
});
