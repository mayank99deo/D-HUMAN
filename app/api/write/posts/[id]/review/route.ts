import { after } from "next/server";
import { z } from "zod";
import { writeGuard } from "@/lib/auth/author";
import { requestReview, sendReviewEmail } from "@/lib/blog/store";
import { allowRequest } from "@/lib/waitlist/rate-limit";
import { fail, readJson, reply } from "../../../http";

// "Ask {name} for a read": records the request for this version and emails the reviewer
// a link to the preview, after the answer is sent (production only, counted in the day's
// email budget: lib/email/send.ts).
const body = z.object({ reviewerId: z.string().min(1).max(40) }).strict();

export async function POST(request: Request, ctx: RouteContext<"/api/write/posts/[id]/review">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  if (!allowRequest(`write:review:${guard.author.id}`, 20, 60 * 60_000)) return fail({ error: "rate_limited" });
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return reply({ error: "invalid" }, 400);
  const postId = (await ctx.params).id;
  const result = await requestReview(guard.author, postId, parsed.data.reviewerId);
  if (!result.ok) return fail(result);
  const { reviewerEmail, title, review } = result;
  after(() => sendReviewEmail({ reviewId: review.id, to: reviewerEmail, reviewerName: review.reviewer.name, requesterName: guard.author.name, title, postId }));
  return reply({ review });
}
