import { after } from "next/server";
import { updateContactName } from "@/lib/waitlist/email";
import { PLAN_LABELS, TRAINING_LABELS } from "@/lib/waitlist/options";
import { allowRequest, clientIp } from "@/lib/waitlist/rate-limit";
import { detailsSchema } from "@/lib/waitlist/schema";
import { updateSignup } from "@/lib/waitlist/sheets";
import { verifyEmailToken } from "@/lib/waitlist/token";

export async function POST(request: Request) {
  if (!allowRequest(`details:${clientIp(request.headers)}`, 10, 60_000)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = detailsSchema.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return Response.json({ error: "invalid", field: typeof field === "string" ? field : undefined }, { status: 400 });
  }

  const { email, token, firstName, city, plan, training, whatsapp } = parsed.data;
  if (!verifyEmailToken(email, token)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    await updateSignup({
      email,
      firstName,
      city,
      plan: plan && PLAN_LABELS[plan],
      training: training.map((t) => TRAINING_LABELS[t]).join(", ") || undefined,
      whatsapp,
    });
    if (firstName) after(() => updateContactName(email, firstName));
    return Response.json({ status: "updated" });
  } catch (error) {
    console.error("[waitlist] Saving details failed:", error);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
