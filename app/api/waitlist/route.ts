import { after } from "next/server";
import { saveContact, sendWelcomeEmail } from "@/lib/waitlist/email";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";
import { joinSchema } from "@/lib/waitlist/schema";
import { appendSignup, SheetsConfigError } from "@/lib/waitlist/sheets";
import { signEmail } from "@/lib/waitlist/token";

export async function POST(request: Request) {
  if (!allowRequest(`join:${clientIp(request.headers)}`, 5, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }

  const { company, ...signup } = parsed.data;
  // Answer bots exactly like a fresh signup, but store nothing.
  if (company) return Response.json({ status: "created" });

  try {
    const status = await appendSignup(signup);
    if (status === "exists") return Response.json({ status });

    after(async () => {
      const results = await Promise.allSettled([
        sendWelcomeEmail(signup.email),
        saveContact(signup.email),
      ]);
      for (const r of results) if (r.status === "rejected") console.error("[waitlist]", r.reason);
    });
    return Response.json({ status, token: signEmail(signup.email) });
  } catch (error) {
    if (error instanceof SheetsConfigError) console.error(`[waitlist] ${error.message}`);
    else console.error("[waitlist] Saving signup failed:", error);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
