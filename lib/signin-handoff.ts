// Carries the email typed on the landing page over to the sign-in form, so
// nobody types it twice. Kept in this tab's sessionStorage, never in the URL,
// where it would end up in history and server logs. Browser only.

const KEY = "dhuman.signin-email";

export function handOffEmail(email: string) {
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    // Storage can be blocked (private mode). The sign-in form just starts empty.
  }
}

export function readHandedOffEmail(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearHandedOffEmail() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
