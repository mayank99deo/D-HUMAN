import { setPrefs } from "@/lib/email/prefs";
import { readStopToken } from "@/lib/email/tokens";

// RFC 8058 one-click unsubscribe: the target of every lifecycle email's List-Unsubscribe
// header. Gmail, Apple Mail and others POST here (body "List-Unsubscribe=One-Click", no
// cookies) when someone taps the mail app's own Unsubscribe button. The signed link is the
// only authority: it names one person and one kind of email, and can only turn that off.

const noStore = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const token = readStopToken(new URL(request.url).searchParams.get("t"));
  if (!token) return new Response(null, { status: 400, headers: noStore });
  try {
    // null: the account is gone, so nothing will be sent anyway. Still a success.
    await setPrefs(token.u, { [token.k]: false }, "one_click");
  } catch (error) {
    console.error("[email] one-click unsubscribe failed:", error instanceof Error ? error.message : error);
    // A 5xx lets the mail provider try again.
    return new Response(null, { status: 500, headers: noStore });
  }
  // 200 with an empty body, no redirect and no cookies, as RFC 8058 asks.
  return new Response(null, { status: 200, headers: noStore });
}

// Opening the link (a person, a mail scanner, a prefetcher) never unsubscribes: it goes to
// the stop page, where the person taps to stop it (a POST).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t") ?? "";
  const target = new URL("/email/stop", url.origin);
  if (t) target.searchParams.set("t", t);
  return new Response(null, { status: 303, headers: { location: target.toString(), ...noStore } });
}
