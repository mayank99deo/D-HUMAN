import { after } from "next/server";
import { z } from "zod";
import { notForApp } from "@/lib/auth/authenticate";
import { sameOrigin } from "@/lib/auth/origin";
import { apiUser } from "@/lib/auth/session";
import { saveFeedbackAnswer, syncFeedback } from "@/lib/email/feedback";
import { OPEN_SURVEY, checkAnswer, isQuestion, nextQuestion } from "@/lib/email/feedback-survey";
import { recordTap } from "@/lib/email/send";
import { readFeedbackToken } from "@/lib/email/tokens";
import { FEEDBACK_PATHS, type FeedbackPath, type FeedbackQuestion, type FeedbackSource } from "@/lib/email/types";
import { json, unauthorized } from "@/lib/platform/http";

// Saves one feedback answer. Only a POST saves: opening a link from the email (what mail
// scanners do) records nothing, and the /feedback page posts here when the person confirms.
//
// Who: whoever holds the email's feedback link (`t`: one person, one survey, 30 days), or
// the signed-in person from Settings (survey "open"). Form posts (the page without
// JavaScript) must carry a link and get a 303 back to the page; they never act on the
// session alone, so another site can't post answers with a hidden form. JSON posts that
// act on the session must also come from our own pages (lib/auth/origin.ts).
//
// After the response, the person's changed answers are copied to the Google Sheet. If the
// Sheet is down they stay marked as not copied, and the daily job tries again.

const SEND_ID = /^[A-Za-z0-9-]{1,64}$/;

const jsonBody = z.object({
  t: z.string().max(512).optional(),
  question: z.string().max(20),
  // The note is capped at FEEDBACK_TEXT_MAX characters by checkAnswer; this only refuses junk.
  answer: z.string().max(8_000),
  path: z.enum(FEEDBACK_PATHS).optional(),
  source: z.enum(["email_tap", "page"]).optional(),
  contactOk: z.boolean().optional(),
  e: z.string().regex(SEND_ID).optional(),
});

const formBody = z.object({
  t: z.string().min(1).max(512),
  question: z.string().max(20),
  answer: z.string().max(8_000).default(""),
  path: z.enum(FEEDBACK_PATHS).optional(),
  source: z.enum(["email_tap", "page"]).optional(),
  contactOk: z.literal("on").optional(),
  e: z.string().regex(SEND_ID).optional(),
});

type Who = { userId: string; survey: string; source: FeedbackSource } | "bad_link" | null;

async function who(t: string | undefined, source: "email_tap" | "page" | undefined): Promise<Who> {
  if (t) {
    const token = readFeedbackToken(t);
    return token ? { userId: token.u, survey: token.s, source: source ?? "page" } : "bad_link";
  }
  const user = await apiUser();
  return user ? { userId: user.id, survey: OPEN_SURVEY, source: "settings" } : null;
}

type Saved = { status: "saved" | "unchanged" | "conflict"; question: FeedbackQuestion; next: FeedbackQuestion | null };
type Refused = { error: string; status: number };

async function save(
  person: { userId: string; survey: string; source: FeedbackSource },
  input: { question: string; answer: string; path?: FeedbackPath; contactOk?: boolean; e?: string },
): Promise<Saved | Refused> {
  if (!isQuestion(input.question)) return { error: "bad_question", status: 400 };
  const question = input.question;
  const checked = checkAnswer(question, input.answer);
  if (!checked.ok) return { error: checked.error, status: 400 };

  const result = await saveFeedbackAnswer({
    userId: person.userId,
    survey: person.survey,
    path: input.path ?? null,
    question,
    answer: checked.answer,
    source: person.source,
    contactOk: input.contactOk,
  });
  if (result.status === "gone") return { error: "gone", status: 404 };
  if (result.status === "wrong_question") return { error: "bad_question", status: 400 };

  if (result.status !== "unchanged") after(() => syncFeedback({ userId: person.userId }));
  // Answering from the email counts as tapping it (the `e` on its links is the send id).
  if (person.source === "email_tap" && input.e) await recordTap(person.userId, input.e);

  const next = result.path && result.status !== "conflict" ? nextQuestion(result.path, question, checked.answer) : null;
  return { status: result.status, question, next };
}

export async function POST(request: Request) {
  const refused = await notForApp(request); // not open to the apps yet: 403 not_for_app
  if (refused) return refused;
  const type = request.headers.get("content-type") ?? "";
  const isForm = type.startsWith("application/x-www-form-urlencoded") || type.startsWith("multipart/form-data");

  if (isForm) {
    const form = await request.formData().catch(() => null);
    const parsed = formBody.safeParse(form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : null);
    if (!parsed.success) return json({ error: "invalid" }, 400);
    const person = await who(parsed.data.t, parsed.data.source);
    if (!person || person === "bad_link" || person.survey === OPEN_SURVEY) return json({ error: "bad_link" }, 400);

    const back = new URL("/feedback", new URL(request.url).origin);
    back.searchParams.set("t", parsed.data.t);
    const redirect = (at: string) => {
      back.searchParams.set("at", at);
      return new Response(null, { status: 303, headers: { location: back.toString(), "cache-control": "no-store" } });
    };

    // "Finish" with an empty box: nothing to save, so on to the thank-you.
    if (parsed.data.question === "text" && !parsed.data.answer.trim()) return redirect("done");

    const result = await save(person, { ...parsed.data, contactOk: parsed.data.contactOk === "on" });
    if ("error" in result) return json({ error: result.error }, result.status);
    return redirect(result.status === "conflict" ? result.question : (result.next ?? "done"));
  }

  const parsed = jsonBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  // Acting on the session (Settings): only from our own pages. A feedback link speaks for itself.
  if (!parsed.data.t && !sameOrigin(request)) return json({ error: "bad_origin" }, 403);
  const person = await who(parsed.data.t, parsed.data.source);
  if (person === "bad_link") return json({ error: "bad_link" }, 400);
  if (!person) return unauthorized();
  const result = await save(person, parsed.data);
  if ("error" in result) return json({ error: result.error }, result.status);
  return json({ status: result.status, next: result.next });
}
