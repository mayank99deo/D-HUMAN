// The app map Ask describes (lib/domain/ask-app.ts) can't drift from the app: every link goes
// to a real page, every app screen and tab is in the map or deliberately left out, and its
// numbers come from the app's own constants (AI spec §3.2, contract §17).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { allowAppImports } from "./support/app.ts";

allowAppImports();
const { APP_MAP, FULL_DAYS_FOR_STACK, NOT_IN_ASK, SCREEN_LINES, UPLOAD_MAX_MB, UPLOAD_MAX_PHOTOS } = await import("../lib/domain/ask-app.ts");
const { ASK_LIMITS, ASK_LINKS } = await import("../lib/ask/types.ts");
const { PLAN, PRICE_TEXT } = await import("../lib/domain/plan.ts");
const { HISTORY_DAYS } = await import("../lib/domain/meals.ts");
const { BUDGETS } = await import("../lib/domain/budget.ts");
const { LANGUAGES } = await import("../lib/domain/options.ts");
const { SPOKEN } = await import("../lib/domain/speech.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/** Every page.tsx under app/, as its URL pattern: route groups dropped, [param] kept. */
function pages(dir = path.join(root, "app")): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name === "page.tsx") {
      const rel = path.relative(path.join(root, "app"), path.dirname(full)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
      out.push(`/${rel.join("/")}`);
    }
  }
  return out;
}
const PAGES = pages();
const pageFor = (href: string) => {
  const p = href.split(/[?#]/)[0].replace(/\/$/, "");
  return PAGES.find((pattern) => new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(p)) ?? null;
};

describe("ask app map", () => {
  it("links only to pages that exist", () => {
    for (const l of ASK_LINKS) {
      const href = l.id === "report" ? "/reports/3f0c2a9e-1b4d-4c8e-9a7f-2d6b5e8c1a03" : l.path;
      assert.ok(pageFor(href), `${l.id} → ${href} has no page`);
    }
  });

  it("covers every app screen, or says why not", () => {
    // pages() names these from app/, so "/fuel/past", "/reports/[id]" and so on.
    const appPages = pages(path.join(root, "app/(platform)/(app)"));
    const linked = ASK_LINKS.map((l) => (l.id === "report" ? "/reports/[id]" : l.path.split(/[?#]/)[0]));
    for (const p of appPages) assert.ok(linked.includes(p) || p in NOT_IN_ASK, `${p} isn't in the app map or NOT_IN_ASK`);
  });

  it("covers every tab in the nav", () => {
    const nav = read("components/platform/Nav.tsx");
    const tabs = [...nav.slice(nav.indexOf("const TABS"), nav.indexOf("] as const")).matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(tabs.length >= 5);
    for (const t of tabs) assert.ok(ASK_LINKS.some((l) => l.path === t), `tab ${t}`);
  });

  it("describes every link id once", () => {
    assert.deepEqual(Object.keys(SCREEN_LINES).sort(), ASK_LINKS.map((l) => l.id).sort());
    for (const l of ASK_LINKS) assert.ok(APP_MAP.includes(`- ${l.id}: `), l.id);
  });

  it("takes its numbers from the app's constants", () => {
    for (const fact of [
      PRICE_TEXT, `${PLAN.days} days`, `${PLAN.freeReads} report reads and ${PLAN.freeMeals} meal logs`, `${PLAN.passReads} report reads`,
      `${PLAN.mealsPerDay} meal logs a day`, `${ASK_LIMITS.perDay} questions a day`, `${HISTORY_DAYS} days before today`,
      `voice in ${SPOKEN.length} languages`, BUDGETS[0].label, ...LANGUAGES.map((l) => l.label),
    ]) assert.ok(APP_MAP.includes(fact), fact);
  });

  it("agrees with the upload limits and the 3 full days written in the source (until they're exported)", () => {
    const route = read("app/api/reports/route.ts");
    assert.match(route, new RegExp(`const MAX_TOTAL = ${UPLOAD_MAX_MB} \\* 1024 \\* 1024;`));
    assert.match(route, new RegExp(`const MAX_FILES = ${UPLOAD_MAX_PHOTOS};`));
    assert.ok(read("lib/platform/food.ts").includes(`fullDays.length >= ${FULL_DAYS_FOR_STACK}`));
  });

  it("stays small and byte-stable: no dates, under 6,000 characters", () => {
    assert.ok(APP_MAP.length < 6000, `${APP_MAP.length}`);
    assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(APP_MAP));
    assert.ok(existsSync(path.join(root, "app/(guides)/sources-and-safety/page.tsx")));
  });
});
