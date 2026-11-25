import { privateJson } from "@/lib/api/respond";
import { authenticate } from "@/lib/auth/authenticate";
import { endAppSession, endOtherSessions } from "@/lib/auth/bearer";
import { endSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  // The apps sign out with their token; the web, exactly as before, with its cookie.
  if (request.headers.has("authorization")) return signOutApp(request);
  await endSession();
  return Response.json({ status: "signed_out" });
}

// This phone, or with { "others": true } every other session this person has, the web's
// cookies included ("Sign out other devices", A9). A POST, never a GET (A5). No cookie is
// set or cleared on a bearer answer (A8).
async function signOutApp(request: Request) {
  const actor = await authenticate(request);
  if (actor?.via !== "bearer") return privateJson({ error: "signed_out" }, 401);
  const body = (await request.json().catch(() => null)) as { others?: unknown } | null;
  if (body?.others === true) {
    const ended = await endOtherSessions(actor.user.id, actor.session.id);
    return privateJson({ status: "signed_out_others", ended });
  }
  await endAppSession(actor.session.id);
  return privateJson({ status: "signed_out" });
}
