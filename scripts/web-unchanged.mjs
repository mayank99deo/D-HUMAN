// The web-didn't-change proof for work that only adds to the app's path (the mobile repo's
// plan, wave 1 lane 1A): two production builds, the base commit's and this tree's, run side by
// side on two copies of the same database, and every person's app screens are fetched from
// both at the same moment and compared byte for byte.
//
//   1. Export and build the base commit somewhere else (never symlink node_modules):
//        git archive <base> | tar -x -C /tmp/base && cp -R node_modules /tmp/base/ && (cd /tmp/base && npx next build)
//   2. Build this tree: npx next build (it may stop once on Next's advisory notice; run it again).
//   3. node scripts/web-unchanged.mjs --base /tmp/base --db <a COPY of a PGlite folder, e.g. .data/pglite>
//        [--paths /home,/fuel,…] [--passes production,ask-open] [--out <folder>]
//
// Two passes by default, each on fresh copies with both servers started anew:
//   - production: Ask founders-only, as live today. One demo person (an onboarded one with a
//     read report) is a founder and writer in BLOG_OWNER_EMAILS on both servers, so the
//     founder branches (Ask open, the support line, /write and its fresh-session rule) are
//     compared as well as everyone else's closed ones.
//   - ask-open: ASK_OPEN=all, the same writer, so every person's Ask control, tour stop and
//     "Ask about this" links on markers are compared.
// It fails if a pass shows no Ask link, or the writer's /write isn't a page on both servers:
// a proof that never rendered those branches proves nothing about them.
//
// What it does to the copy (never to the folder given): adds the Home states a local database
// often lacks (a pregnancy with a read in progress, a stack from meals only, a failed read, a
// stack mid-build, a read for flagged markers that have none), then one web cookie session per
// person, written as startSession writes them. Each server gets its own copy of the result; this
// tree's server migrates its copy on start, as production will.
//
// Only two things are set aside before comparing: each build's BUILD_ID, and the one random id
// Next writes per request into the page head. A differing pair is fetched again up to 6 times,
// because streaming can flush a Suspense boundary before or after the shell by timing alone;
// changed content never matches, so a matching pair is the same page. Exits 1 on any difference
// and keeps both copies of each differing page in --out.
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { PGlite } from "@electric-sql/pglite";

const { values: args } = parseArgs({ options: { base: { type: "string" }, db: { type: "string" }, paths: { type: "string" }, passes: { type: "string" }, out: { type: "string" } } });
if (!args.base || !args.db) {
  console.error("usage: node scripts/web-unchanged.mjs --base <base build dir> --db <PGlite folder> [--paths /home,…] [--out <new or empty folder>]");
  process.exit(2);
}
const baseDir = path.resolve(args.base);
const sourceDb = path.resolve(args.db);
const paths = (args.paths ?? "/home,/fuel,/fuel/past,/stack,/settings,/upload,/wraps,/onboarding,/reports,/write,/write/profile,/write/status,/write/import").split(",");
const PASSES = {
  production: (writer) => ({ ASK_OPEN: "", BLOG_OWNER_EMAILS: writer }),
  "ask-open": (writer) => ({ ASK_OPEN: "all", BLOG_OWNER_EMAILS: writer }),
};
const passes = (args.passes ?? "production,ask-open").split(",");
for (const p of passes) if (!(p in PASSES)) throw new Error(`unknown pass ${p}: one of ${Object.keys(PASSES).join(", ")}`);
// Never deletes anything: the out folder must be new or empty, and it keeps the database copies too.
const outDir = path.resolve(args.out ?? mkdtempSync(path.join(tmpdir(), "web-unchanged-")));
if (existsSync(outDir) && readdirSync(outDir).length) {
  console.error(`${outDir} isn't empty: give a new folder with --out.`);
  process.exit(2);
}
const hereDir = process.cwd();
mkdirSync(path.join(outDir, "pages"), { recursive: true });

// ── The database: missing states, then a cookie per person ──────────────────

async function prepare(dir) {
  const pg = new PGlite(dir);
  const one = async (q, p = []) => (await pg.query(q, p)).rows[0];
  const noReport = (await pg.query(`select p.user_id from profiles p where p.onboarded_at is not null
    and not exists (select 1 from reports r where r.user_id = p.user_id) and not exists (select 1 from stacks s where s.user_id = p.user_id) order by p.user_id`)).rows.map((r) => r.user_id);
  const added = [];
  if (noReport[0]) {
    await pg.query(`update profiles set conditions = array['pregnant'] where user_id = $1`, [noReport[0]]);
    await pg.query(`insert into reports (id, user_id, status, stage, file_name) values ($1, $2, 'reading', 'reading', 'report.pdf')`, [randomUUID(), noReport[0]]);
    added.push("pregnancy with a read in progress");
  }
  const mealPlan = await one(`select plan, model from stacks where report_id is null and status = 'ready' and plan is not null limit 1`);
  if (noReport[1] && mealPlan) {
    await pg.query(`insert into stacks (id, user_id, report_id, status, plan, model) values ($1, $2, null, 'ready', $3, $4)`, [randomUUID(), noReport[1], JSON.stringify(mealPlan.plan), mealPlan.model]);
    added.push("a stack from meals only");
  }
  if (noReport[2]) {
    await pg.query(`insert into reports (id, user_id, status, error, file_name) values ($1, $2, 'failed', 'We couldn''t read this file. Try a clearer photo or the lab''s PDF.', 'blurry.jpg')`, [randomUUID(), noReport[2]]);
    added.push("a failed read");
  }
  const withStack = await one(`select s.user_id from stacks s join profiles p on p.user_id = s.user_id where p.onboarded_at is not null and s.report_id is not null order by s.user_id limit 1`);
  if (withStack) {
    // Dated ahead, so it never turns stale between the two servers' requests.
    await pg.query(`update stacks set status = 'building', created_at = now() + interval '2 days' where user_id = $1`, [withStack.user_id]);
    added.push("a stack mid-build");
  }
  const donor = await one(`select read from analyses limit 1`);
  const unread = (await pg.query(`select distinct on (r.user_id) r.id, r.user_id from reports r join markers m on m.report_id = r.id
    where r.status = 'ready' and m.flag is not null and not exists (select 1 from analyses a where a.report_id = r.id) order by r.user_id, r.created_at desc`)).rows;
  for (const r of donor ? unread : []) {
    const read = { ...donor.read, verdict: { level: "doctor_first", line: "See a doctor first.", detail: "One result needs a doctor's look before anything else." } };
    await pg.query(`insert into analyses (report_id, user_id, read) values ($1, $2, $3)`, [r.id, r.user_id, JSON.stringify(read)]);
  }
  if (unread.length) added.push(`a read for ${unread.length} flagged report(s)`);

  // The writer: an onboarded adult with a read report, so their founder Ask links show on markers.
  const writer = (await one(`select u.email from users u join profiles p on p.user_id = u.id join reports r on r.user_id = u.id and r.status = 'ready'
    join analyses a on a.report_id = r.id where p.onboarded_at is not null and p.birth_year <= extract(year from now()) - 18
    group by u.email order by count(*) desc, u.email limit 1`))?.email;
  if (!writer) throw new Error("the database has no onboarded adult with a read report to be the writer");
  // The writer's byline row, made here once, as /write makes it on a first visit: otherwise each
  // server makes its own with a random id, and /write/profile differs by that id alone.
  if (!(await one(`select 1 from blog_authors where email = $1`, [writer]))) {
    const { name } = (await one(`select coalesce(nullif(trim(p.name), ''), 'Writer') as name from users u join profiles p on p.user_id = u.id where u.email = $1`, [writer])) ?? { name: "Writer" };
    await pg.query(`insert into blog_authors (id, email, slug, name) values ($1, $2, $3, $4)`, [randomUUID(), writer, name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "writer", name.slice(0, 60)]);
    added.push("the writer's byline");
  }
  const tokens = {};
  for (const { id, email } of (await pg.query(`select id, email from users order by email`)).rows) {
    const token = randomBytes(32).toString("base64url");
    await pg.query(`insert into sessions (id, user_id, expires_at) values ($1, $2, now() + interval '30 days')`, [createHash("sha256").update(token).digest("hex"), id]);
    tokens[email] = token;
  }
  await pg.close();
  console.log(`database: ${Object.keys(tokens).length} people; added ${added.join(", ") || "nothing"}; writer ${writer}`);
  return { tokens, writer };
}

// ── The two servers ──────────────────────────────────────────────────────────

function start(name, dir, port, db, extraEnv) {
  const log = [];
  const child = spawn(path.join(dir, "node_modules/.bin/next"), ["start", "-p", String(port)], {
    cwd: dir,
    env: { ...process.env, PGLITE_DIR: db, D_HUMAN_AI_MOCK: "1", ANTHROPIC_API_KEY: "", RESEND_API_KEY: "", DATABASE_URL: "", POSTGRES_URL: "", VERCEL: "", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => log.push(b.toString()));
  child.stderr.on("data", (b) => log.push(b.toString()));
  return { name, port, child, log, buildId: readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8").trim() };
}

async function ready(server) {
  for (let i = 0; i < 120; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${server.port}/signin`)).arrayBuffer();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${server.name} never started:\n${server.log.join("")}`);
}

/** The per-request id in the head: "<21 chars>v" and "<21 chars>m", rewritten only when both appear. */
function requestIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\\"([A-Za-z0-9_-]{21})v\\"/g)) if (text.includes(`\\"${m[1]}m\\"`)) ids.add(m[1]);
  return ids;
}

async function get(server, p, token) {
  const r = await fetch(`http://127.0.0.1:${server.port}${p}`, { redirect: "manual", headers: { cookie: `dh_session=${token}` } });
  let body = Buffer.from(await r.arrayBuffer()).toString("utf8").split(server.buildId).join("BUILD_ID");
  for (const id of requestIds(body)) body = body.split(id).join("REQUEST_ID");
  const head = ["content-type", "cache-control", "location", "x-frame-options", "strict-transport-security", "permissions-policy"].map((h) => `${h}: ${r.headers.get(h)}`).join("\n");
  return { status: r.status, head, body };
}

// ── Compare ──────────────────────────────────────────────────────────────────

const work = path.join(outDir, "databases");
const prepared = path.join(work, "prepared");
cpSync(sourceDb, prepared, { recursive: true });
const { tokens, writer } = await prepare(prepared);
let compared = 0;
const differing = [];
const retried = [];
const thin = [];
for (const [n, pass] of passes.entries()) {
  const env = PASSES[pass](writer);
  console.log(`\n── pass ${pass}: ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const side of ["base", "here"]) cpSync(prepared, path.join(work, `${pass}-${side}`), { recursive: true });
  const base = start("base", baseDir, 3101 + 2 * n, path.join(work, `${pass}-base`), env);
  const here = start("here", hereDir, 3102 + 2 * n, path.join(work, `${pass}-here`), env);
  // What this pass rendered, so a pass that never reached a branch fails instead of passing.
  const reached = { askLinks: 0, writerPages: 0 };
  try {
    await Promise.all([ready(base), ready(here)]);
    for (const [email, token] of Object.entries(tokens)) {
      // The screens, then the person's first report page, found on their /reports list (a path
      // both servers are sent alike: the list settles stale reads).
      const queue = [...paths];
      for (let p = queue.shift(); p; p = queue.shift()) {
        let a;
        let b;
        let same = false;
        let tries = 0;
        while (!same && tries < 6) {
          tries++;
          [a, b] = await Promise.all([get(base, p, token), get(here, p, token)]);
          same = a.status === b.status && a.head === b.head && a.body === b.body;
        }
        compared++;
        const tag = `${pass}_${email}${p.replace(/\//g, "_")}`;
        writeFileSync(path.join(outDir, "pages", `${tag}.html`), b.body);
        if (!same) {
          differing.push(`${pass} ${email} ${p}`);
          writeFileSync(path.join(outDir, `${tag}.base.html`), `${a.status}\n${a.head}\n\n${a.body}`);
          writeFileSync(path.join(outDir, `${tag}.here.html`), `${b.status}\n${b.head}\n\n${b.body}`);
        } else if (tries > 1) retried.push(`${pass} ${email} ${p} (${tries} tries)`);
        if (same && a.body.includes("Ask about this")) reached.askLinks++;
        if (same && email === writer && p.startsWith("/write") && a.status === 200) reached.writerPages++;
        console.log(`${same ? "same" : "DIFF"} ${a.status} ${String(a.body.length).padStart(7)} B  ${email} ${p}`);
        const first = p === "/reports" ? /href="(\/reports\/[0-9a-f-]{36})"/.exec(a.body)?.[1] : null;
        if (first) queue.push(first);
      }
    }
  } finally {
    base.child.kill();
    here.child.kill();
    writeFileSync(path.join(outDir, `${pass}-base.log`), base.log.join(""));
    writeFileSync(path.join(outDir, `${pass}-here.log`), here.log.join(""));
  }
  console.log(`pass ${pass}: ${reached.askLinks} identical pages with "Ask about this", ${reached.writerPages} identical /write pages for the writer`);
  if (!reached.askLinks) thin.push(`${pass}: no page showed an Ask link`);
  if (!reached.writerPages) thin.push(`${pass}: the writer's /write never rendered`);
}
if (retried.length) console.log(`\nidentical after a retry (streaming order): ${retried.join("; ")}`);
console.log(`\n${compared - differing.length} of ${compared} pages byte-identical. Pages kept in ${outDir}`);
if (differing.length) console.log(`differing: ${differing.join("; ")}`);
if (thin.length) console.log(`not covered: ${thin.join("; ")}`);
process.exit(differing.length || thin.length ? 1 : 0);
