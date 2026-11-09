import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { MARKERS } from "@/lib/domain/markers";
import { FALLBACK_BETA, MODEL, VOICE, anthropic, assertComplete, languageRule } from "./client";
import { ExtractedSchema, ReadSchema, type Extracted, type Read } from "./schemas";

export type ReportFile = { mime: string; bytes: Buffer };

const EXTRACT_SYSTEM = `You read Indian diagnostic lab reports and copy their results into structured data, exactly as printed.

For every test result on the report:
- printed_name: the test name as printed.
- key: the closest match from this list, or "other" when none fits or you are unsure:
${MARKERS.map((m) => `  ${m.key} = ${m.name}`).join("\n")}
- value: the result as a number. If the result isn't a plain number (e.g. "<0.5", "Positive", "Reactive"), set value to null and put it in value_text.
- unit: as printed. Never convert units.
- ref_low / ref_high: the lab's reference range for this person. "< 200" means ref_high 200 and ref_low null. When a lab prints bands (e.g. vitamin D "Deficient <20, Insufficient 20–30, Sufficient 30–100"), use the healthy band. When ranges are printed by sex or age, use the one for this person.
- ref_text: the range exactly as printed.

Skip calculated ratios you can't place, interpretive comments, and method names. Include each result once; when a test is repeated on the report, keep the first.
Never infer or compute a value that isn't printed. If a value is unreadable, leave it out and say so in reading_notes.
If the document is not a lab report at all, set is_lab_report to false and return no markers.`;

function filesToBlocks(files: ReportFile[]): BetaContentBlockParam[] {
  return files.map((f) =>
    f.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.bytes.toString("base64") } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: f.mime as "image/jpeg" | "image/png" | "image/webp",
            data: f.bytes.toString("base64"),
          },
        },
  );
}

// Streams the extraction so marker names can appear on screen as Claude reads them.
export async function extractReport(files: ReportFile[], onFound: (name: string) => void): Promise<{ data: Extracted; model: string }> {
  const seen = new Set<string>();
  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ExtractedSchema) },
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [...filesToBlocks(files), { type: "text", text: "Extract every result from this lab report." }],
      },
    ],
  });
  stream.on("text", (_delta, snapshot) => {
    for (const m of snapshot.matchAll(/"printed_name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        onFound(m[1]);
      }
    }
  });
  const message = await stream.finalMessage();
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not read the report's structure");
  return { data: message.parsed_output, model: message.model };
}

export type ReadInput = {
  person: {
    firstName: string;
    age: number | null;
    sex: string | null;
    persona: string; // "Regular runner"
    activities: string[];
    level: string;
    sessionsPerWeek: number | null;
    goals: string[];
    diet: string | null;
    conditions: string[];
    medications: string | null;
    currentSupplements: string | null;
    city: string | null;
    language: string;
  };
  target: { kind: "event"; name: string; date: string | null; daysAway: number | null; city: string | null } | { kind: "retest" };
  markers: {
    id: string;
    name: string;
    key: string | null;
    value: string;
    unit: string | null;
    range: string;
    rangeSource: string;
    status: string;
    flag: string | null;
    priority: number | null; // 1 = matters most for this persona
  }[];
  diet: string | null; // a short summary of logged eating, when there is any
  labName: string | null;
  collectedOn: string | null;
};

const READ_SYSTEM = `${VOICE}

You are writing a person's blood report read: the screen they see after uploading. It must feel made for them: their sport, their goal, their event.

How to decide the verdict:
- doctor_first: any marker flagged "doctor" or "urgent". Say kindly that it's worth showing a doctor before pushing hard. For "urgent", say to get medical advice today.
- go: nothing meaningful holds them back.
- go_with_tweaks: one or two fixable things.
- build: several gaps that would hold back their training or health; they should fix these first.
The verdict line names their target. With an event: "Ready for HYROX Mumbai, with one fix." Without one, aim at their goal or the retest: "Ready to build. Fix iron first."

Tilt everything to their activity. A HYROX athlete reads iron through 8 km of running plus sleds; a trekker reads haemoglobin and ferritin through thin air on high passes; a lifter reads creatinine and liver enzymes knowing heavy training moves them. Priority 1 markers matter most for this person; lead with them when they're off, and celebrate them when they're good.

Fields:
- headline: six words or fewer.
- summary: 2–3 sentences.
- focus: 1–4 pointers, most important first, each tied to a marker when there is one (marker_key from the catalogue). "action" is food-first and practical for an Indian kitchen and their diet type. Don't recommend supplements here; D-Human builds the stack separately.
- markers: one entry for EVERY marker id given, with a one-sentence note in context. for_you: good, watch (edge of range or matters for their goal), act (out of range and matters), neutral.
- wins: 1–3 things that are genuinely good.
- doctor_questions: 0–4 short questions to take to a doctor; include at least one for every flagged marker.
- retest: when to retest (weeks) and which marker keys.
- test_tips: 0–3 tips for a cleaner next test, only if relevant (fasting, rest day before, morning sample).`;

export async function interpretReport(input: ReadInput): Promise<{ data: Read; model: string }> {
  const { person, target } = input;
  const targetText =
    target.kind === "event"
      ? `Their target event: ${target.name}${target.date ? `, on ${target.date}` : " (date not announced)"}${
          target.daysAway != null ? `, ${target.daysAway} days away` : ""
        }${target.city ? `, in ${target.city}` : ""}.`
      : "No event chosen. Their target is their goals and the next retest.";

  const markerLines = input.markers
    .map(
      (m) =>
        `${m.id} | ${m.name}${m.key ? ` [${m.key}]` : ""} | ${m.value}${m.unit ? ` ${m.unit}` : ""} | range ${m.range} (${m.rangeSource}) | ${m.status}${
          m.flag ? ` | FLAG: ${m.flag}` : ""
        }${m.priority ? ` | priority ${m.priority}` : ""}`,
    )
    .join("\n");

  const prompt = `The person
- Name: ${person.firstName}; age ${person.age ?? "unknown"}; sex ${person.sex ?? "unknown"}
- Persona: ${person.persona}. Activities: ${person.activities.join(", ") || "none yet"}. Level: ${person.level}${
    person.sessionsPerWeek ? `, about ${person.sessionsPerWeek} sessions a week` : ""
  }.
- Goals: ${person.goals.join(", ") || "not given"}
- Diet: ${person.diet ?? "not given"}. City: ${person.city ?? "not given"}
- Conditions they told us about: ${person.conditions.join(", ") || "none"}
- Medications: ${person.medications || "none given"}. Supplements now: ${person.currentSupplements || "none given"}
- ${targetText}
${input.diet ? `- What they've been eating (from their food log): ${input.diet}` : ""}

The report${input.labName ? ` from ${input.labName}` : ""}${input.collectedOn ? `, collected ${input.collectedOn}` : ""}
id | marker [catalogue key] | value | range (source) | status | flag | priority
${markerLines}

Statuses were computed from the ranges: low/high are outside; edge_low/edge_high are inside but within the outer tenth of the range.

${languageRule(person.language)}`;

  const message = await anthropic()
    .beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(ReadSchema) },
      system: READ_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();
  assertComplete(message);
  if (!message.parsed_output) throw new Error("Could not build the read");
  return { data: message.parsed_output, model: message.model };
}
