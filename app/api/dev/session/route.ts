import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { newId } from "@/lib/auth/crypto";
import { startSession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";

// Local development only: signs in as a demo person without email.
// /api/dev/session?as=ankit (HYROX, 34, Mumbai), ?as=mayank (trekking, 31, Pune), ?as=priya (runner, 40, Indore)
// or ?as=fresh (no profile yet, to walk through onboarding). 404 in production.
const PEOPLE = {
  ankit: {
    name: "Ankit", birthYear: 1992, sex: "male", heightCm: 178, weightKg: 79, city: "Mumbai", activities: ["hyrox", "running", "strength"],
    primaryActivity: "hyrox", level: "competitive", sessionsPerWeek: 6, goals: ["performance", "muscle"], eventInMind: "HYROX Mumbai", diet: "nonveg", language: "en",
  },
  mayank: {
    name: "Mayank", birthYear: 1995, sex: "male", heightCm: 175, weightKg: 70, city: "Pune", activities: ["trekking", "walking"],
    primaryActivity: "trekking", level: "regular", sessionsPerWeek: 3, goals: ["energy", "longevity"], eventInMind: "Hampta Pass trek", diet: "veg", language: "hinglish",
  },
  priya: {
    name: "Priya", birthYear: 1986, sex: "female", heightCm: 162, weightKg: 58, city: "Indore", activities: ["running", "yoga"],
    primaryActivity: "running", level: "regular", sessionsPerWeek: 4, goals: ["energy", "performance"], eventInMind: "Indore Marathon", diet: "veg", language: "en",
  },
  fresh: null,
} as const;

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const params = new URL(request.url).searchParams;
  const who = (params.get("as") ?? "ankit") as keyof typeof PEOPLE;
  const to = params.get("to");
  if (!(who in PEOPLE)) return new Response("Unknown demo person", { status: 400 });
  const email = `${who}@demo.dhuman.local`;
  const d = await db();
  let [user] = await d.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) {
    [user] = await d.insert(schema.users).values({ id: newId(), email }).returning();
    await d.insert(schema.profiles).values({ userId: user.id });
  }
  const person = PEOPLE[who];
  if (person) {
    await d
      .update(schema.profiles)
      .set({ ...person, activities: [...person.activities], goals: [...person.goals], timezone: "Asia/Kolkata", consentAt: new Date(), onboardedAt: new Date() })
      .where(eq(schema.profiles.userId, user.id));
  }
  await startSession(user.id);
  redirect(to?.startsWith("/") && !to.startsWith("//") ? to : person ? "/home" : "/onboarding");
}
