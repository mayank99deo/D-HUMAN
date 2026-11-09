import "server-only";
import { extractJson, runWithWebSearch } from "./client";
import { EventsSchema } from "./schemas";

export type FoundEvent = {
  name: string;
  kind: string | null;
  starts_on: string | null;
  ends_on: string | null;
  city: string | null;
  country: string | null;
  url: string | null;
  details: string | null;
};

const SYSTEM = `You find real, upcoming amateur sports events for D-Human, an Indian health platform. Use web search. Accuracy beats quantity.
- Only list events you found on a page in your search results, and give that page's URL.
- Only events that haven't happened yet. If the next edition's date isn't announced, set starts_on to null and say "dates to be announced" in details.
- Dates as YYYY-MM-DD. Never guess a date.
- details: one short line a participant would care about (distance or format, registration status if you saw it).
Finish with one JSON object in a \`\`\`json block: {"events":[{"name","kind","starts_on","ends_on","city","country","url","details"}]}`;

export async function searchEvents(opts: {
  what: string;
  city: string | null;
  country: string | null;
  named: string | null;
  today: string;
}): Promise<{ events: FoundEvent[]; model: string }> {
  const where = [opts.city, opts.country || "India"].filter(Boolean).join(", ");
  const prompt = `Today is ${opts.today}. Find upcoming ${opts.what} in the next 9 months, for someone based in ${where}.
${opts.named ? `They told us they have this in mind: "${opts.named}". Find that event first and include it if it's upcoming.\n` : ""}List up to 8: events in or near ${opts.city || "their city"} first, then the biggest ones elsewhere in ${opts.country || "India"}.`;

  const { text, model } = await runWithWebSearch({ system: SYSTEM, prompt, maxUses: 6, effort: "medium" });
  const parsed = EventsSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error("Event search returned an unexpected shape");
  const valid = parsed.data.events.filter(
    (e) => e.name.trim() && (!e.starts_on || /^\d{4}-\d{2}-\d{2}$/.test(e.starts_on)) && (!e.url || /^https?:\/\//.test(e.url)),
  );
  return { events: valid, model };
}
