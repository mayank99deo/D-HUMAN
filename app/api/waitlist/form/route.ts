import { after } from "next/server";
import { saveContact, sendWelcomeEmail } from "@/lib/waitlist/email";
import { formSignupSchema } from "@/lib/waitlist/schema";
import { verifyWebhookSecret } from "@/lib/waitlist/token";

// Called by the Apps Script trigger after it saves a new Google Form signup, so
// form signups get the same welcome email and Resend contact as website ones.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!verifyWebhookSecret(token)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = formSignupSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }

  const { email, firstName } = parsed.data;
  after(async () => {
    const results = await Promise.allSettled([
      sendWelcomeEmail(email),
      saveContact(email, firstName),
    ]);
    for (const r of results) if (r.status === "rejected") console.error("[waitlist]", r.reason);
  });
  return Response.json({ status: "accepted" });
}
