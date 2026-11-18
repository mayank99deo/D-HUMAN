import { z } from "zod";
import { apiUser } from "@/lib/auth/session";
import { getPrefs, setPrefs, type EmailPrefs, type PrefChanges } from "@/lib/email/prefs";
import { readStopToken } from "@/lib/email/tokens";
import type { PrefsUpdatedVia } from "@/lib/email/types";
import { json, unauthorized } from "@/lib/platform/http";

// Read or change someone's lifecycle email settings: weekly wrap and questions from the team.
//
// Who: the signed-in person (Settings → Emails), or whoever holds a stop link from one of
// their emails (`t`, the stop page). A stop link can change only its own person's settings.
// When a link is given it wins over the session, so a stop page opened on a shared
// computer changes the right person's settings.
//
// Form posts (the stop page's no-JavaScript "Confirm" button) must carry a stop link and
// get a 303 back to the page. They never act on the session alone, so another site can't
// change settings with a hidden form.

const view = (p: EmailPrefs) => ({ weekly: p.weekly, questions: p.questions, weeklyPaused: Boolean(p.weeklyPausedAt) });

const jsonBody = z
  .object({ t: z.string().max(512).optional(), weekly: z.boolean().optional(), questions: z.boolean().optional() })
  .refine((b) => b.weekly !== undefined || b.questions !== undefined, "nothing to change");

const onOff = z.enum(["on", "off"]).optional();
const formBody = z
  .object({ t: z.string().min(1).max(512), weekly: onOff, questions: onOff })
  .refine((b) => b.weekly !== undefined || b.questions !== undefined, "nothing to change");

type Who = { userId: string; via: PrefsUpdatedVia } | "bad_link" | null;

async function who(t: string | null | undefined): Promise<Who> {
  if (t) {
    const token = readStopToken(t);
    return token ? { userId: token.u, via: "stop_link" } : "bad_link";
  }
  const user = await apiUser();
  return user ? { userId: user.id, via: "settings" } : null;
}

export async function GET(request: Request) {
  const person = await who(new URL(request.url).searchParams.get("t"));
  if (person === "bad_link") return json({ error: "bad_link" }, 400);
  if (!person) return unauthorized();
  return json(view(await getPrefs(person.userId)));
}

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  const isForm = type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");

  if (isForm) {
    const form = await request.formData().catch(() => null);
    const parsed = formBody.safeParse(form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : null);
    if (!parsed.success) return json({ error: "invalid" }, 400);
    const person = await who(parsed.data.t);
    if (!person || person === "bad_link") return json({ error: "bad_link" }, 400);
    const changes: PrefChanges = {};
    if (parsed.data.weekly) changes.weekly = parsed.data.weekly === "on";
    if (parsed.data.questions) changes.questions = parsed.data.questions === "on";
    await setPrefs(person.userId, changes, person.via);
    const back = new URL("/email/stop", new URL(request.url).origin);
    back.searchParams.set("t", parsed.data.t);
    return new Response(null, { status: 303, headers: { location: back.toString(), "cache-control": "no-store" } });
  }

  const parsed = jsonBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const person = await who(parsed.data.t);
  if (person === "bad_link") return json({ error: "bad_link" }, 400);
  if (!person) return unauthorized();
  const updated = await setPrefs(person.userId, { weekly: parsed.data.weekly, questions: parsed.data.questions }, person.via);
  if (!updated) return json({ error: "gone" }, 404);
  return json(view(updated));
}
