// Text Postgres can't store, dropped on arrival from the apps (backend test engineer, hunt 1).
//
// U+0000 is legal in JSON ("\u0000") and in multipart fields and file names, but Postgres refuses
// it in text and jsonb ("invalid byte sequence for encoding UTF8: 0x00"), and can't even compare a
// column with it. So an app request carrying one threw on its write and answered 500: for a meal
// or a usual day only after the paid AI call (and, for a usual day, after one of the day's 5 saves
// was claimed), and a 500 tells a phone's offline queue to send the same meal again, forever.
// A NUL never means anything in words, so the apps' paths drop it before anything reads them; an
// id in the path that holds one can't name anything, so it is answered as missing. The web's
// requests never come here (Mayank's rule: the website stays exactly as it is).

const NUL = /\u0000/g;

/** The words without any U+0000. */
export const withoutNul = (s: string) => (s.includes("\u0000") ? s.replace(NUL, "") : s);

/**
 * A parsed JSON body with U+0000 dropped from every string and key. Depth-capped: the routes'
 * fields sit two levels down at most, and a body nested thousands deep must not cost a stack.
 */
export function withoutNulDeep(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return withoutNul(v);
  if (depth > 8 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => withoutNulDeep(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [withoutNul(k), withoutNulDeep(x, depth + 1)]));
}

/** An id from the path that can name nothing we store (and that Postgres can't compare). */
export const impossibleId = (id: string) => id.includes("\u0000");
