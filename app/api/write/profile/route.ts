import { writeGuard } from "@/lib/auth/author";
import { updateAuthorProfile } from "@/lib/blog/store";
import { fail, readJson, reply } from "../http";

// The writer's public byline: name, role, bio, photo, up to two links.
export async function PUT(request: Request) {
  const guard = await writeGuard(request);
  if (!guard.ok) return guard.response;
  const result = await updateAuthorProfile(guard.author, await readJson(request));
  return result.ok ? reply({ ok: true }) : fail(result);
}
