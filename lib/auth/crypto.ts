import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// AUTH_SECRET keys the sign-in code hashes. Required in production; local dev
// falls back to a fixed value so the app runs with no setup.
function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
    throw new Error("AUTH_SECRET is not set");
  }
  return "d-human-local-dev-secret";
}

export const newId = () => crypto.randomUUID();

export const newSessionToken = () => randomBytes(32).toString("base64url");

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const hashCode = (email: string, code: string) =>
  createHmac("sha256", authSecret()).update(`${email.toLowerCase()}:${code}`).digest("hex");

export function sameHash(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
