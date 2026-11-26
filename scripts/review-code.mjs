// Makes a new App Review sign-in code and the hash to configure for it (lib/auth/review.ts).
//   AUTH_SECRET=<production's AUTH_SECRET> node scripts/review-code.mjs
// Prints a 20-digit code (give it to App Review in the submission's notes) and REVIEW_CODE_HASH,
// its HMAC-SHA256 under AUTH_SECRET, base64url (set it in Vercel, Production). AUTH_SECRET is
// read from the environment and never printed. A new code for every submission.
import { createHmac, randomInt } from "node:crypto";

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error("Set AUTH_SECRET to production's value first: the hash is keyed with it.");
  process.exit(2);
}
const code = Array.from({ length: 20 }, () => randomInt(0, 10)).join("");
const hash = createHmac("sha256", secret).update(`review-code\u0000${code}`).digest("base64url");
console.log(`code (for App Review):     ${code.replace(/(\d{4})(?=\d)/g, "$1 ")}`);
console.log(`REVIEW_CODE_HASH (Vercel): ${hash}`);
