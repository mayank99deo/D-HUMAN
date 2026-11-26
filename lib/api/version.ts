import { privateJson } from "./respond";
import { configJson } from "./views/app";

// Forced updates (the mobile repo's docs/API.md §7): an app below the oldest version still served
// (APP_MIN_VERSION_IOS, which GET /api/app/config reports as minSupported) gets 426
// update_required on every request, and shows its "Time to update" screen. The X-DHuman-Client
// header ("ios/1.0.0 (42)") is used for this only, never for security, limits or words; a missing
// or odd header means no check. GET /api/app/config and sign-out stay open to old versions.

const parse = (v: string) => v.split(".").map((n) => Number(n) || 0);

/** -1, 0 or 1, comparing dotted versions number by number ("1.10.0" is after "1.9.3"). */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The iOS app's version from its X-DHuman-Client header, or null when there's none to go by. */
export function clientVersion(request: Request): string | null {
  const m = /^ios\/(\d+(?:\.\d+){0,3})(?:\s|$)/.exec(request.headers.get("x-dhuman-client")?.trim() ?? "");
  return m ? m[1] : null;
}

/** 426 for an app older than the oldest version still served, else null. */
export function updateRequired(request: Request, env: Record<string, string | undefined> = process.env): Response | null {
  const version = clientVersion(request);
  if (!version) return null;
  const { minSupported, updateUrl } = configJson(env);
  if (compareVersions(version, minSupported) >= 0) return null;
  return privateJson({ error: "update_required", message: "This version has stopped working with our servers. Update to carry on; your meals are safe.", minVersion: minSupported, updateUrl }, 426);
}
