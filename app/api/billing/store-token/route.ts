import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { appOnly } from "@/lib/api/actor";
import { switchedOff } from "@/lib/api/errors";
import { privateJson } from "@/lib/api/respond";
import { switchOff } from "@/lib/api/views/app";
import { db, schema } from "@/lib/db";

// The appAccountToken for the apps' in-app purchase (gap G8; the mobile repo's docs/API.md §8): a
// UUID the purchase carries, so our own user id never goes to Apple, and Apple's signed
// transaction comes back naming this person. Made on first use and the same ever after, so a
// resend is safe. A POST, since the first call writes it (no GET changes state, QA's A5). Apps
// only: a web request gets 403 bearer_required.
export async function POST(request: Request) {
  const member = await appOnly(request, { write: false });
  if (!member.ok) return member.response;
  // The "iap" switch turns buying in the app off on the server too.
  if (switchOff("iap")) return switchedOff("iap");
  const d = await db();
  const u = schema.users;
  // Set only where none is set, so two first calls at once agree on one token.
  await d.update(u).set({ storeAccountToken: randomUUID() }).where(and(eq(u.id, member.user.id), isNull(u.storeAccountToken)));
  const [row] = await d.select({ token: u.storeAccountToken }).from(u).where(eq(u.id, member.user.id)).limit(1);
  return privateJson({ appAccountToken: row?.token ?? null });
}
