import { z } from "zod";
import { writeGuard } from "@/lib/auth/author";
import { updateImage } from "@/lib/blog/image-store";
import { fail, readJson, reply } from "../../http";

// A photo's focal point, colour rule and rights. Live posts keep their own copy until updated.
const body = z
  .object({
    focalX: z.number().min(0).max(1),
    focalY: z.number().min(0).max(1),
    keepColour: z.boolean(),
    ownRights: z.boolean(),
    credit: z
      .string()
      .max(200)
      .transform((v) => v.replace(/\s+/g, " ").trim() || null)
      .nullable(),
  })
  .partial()
  .strict();

export async function PATCH(request: Request, ctx: RouteContext<"/api/write/images/[id]">) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return reply({ error: "invalid" }, 400);
  return (await updateImage((await ctx.params).id, parsed.data)) ? reply({ ok: true }) : fail({ error: "not_found" });
}
