// The safety floor, in code. Whatever the model writes, a marker flagged
// "doctor" or "urgent" (lib/domain/markers.ts) means "Doctor first" on the read
// and no self-treatment in the stack. Never weaken these without Mayank's
// explicit approval. Pure functions, tested in tests/safety.test.ts.

export type Flag = "doctor" | "urgent";
export type Level = "go" | "go_with_tweaks" | "build" | "doctor_first";
export type Verdict = { level: Level; line: string; detail: string };

/** A marker as the floor sees it. `name` is how we say it to the person (the catalogue name). */
export type SafetyMarker = { key: string | null; name: string; status: string; flag: Flag | null };

export const asFlag = (flag: string | null | undefined): Flag | null => (flag === "doctor" || flag === "urgent" ? flag : null);

// ---- Duplicates -------------------------------------------------------------

/** Urgent, then doctor, then out of range, then everything else. */
export function severity(m: { flag?: string | null; status: string }): number {
  if (m.flag === "urgent") return 3;
  if (m.flag === "doctor") return 2;
  if (m.status === "low" || m.status === "high") return 1;
  return 0;
}

/**
 * One row per catalogue marker, keeping its most severe reading, so an earlier
 * healthy-looking value can't hide a worse one printed later. Ties keep the one
 * printed first. Rows without a catalogue key are all kept. Order is preserved.
 */
export function keepMostSevere<T extends { key?: string | null; flag?: string | null; status: string }>(rows: T[]): T[] {
  const best = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.key) return;
    const kept = best.get(r.key);
    if (kept === undefined || severity(r) > severity(rows[kept])) best.set(r.key, i);
  });
  return rows.filter((r, i) => !r.key || best.get(r.key) === i);
}

// ---- Wording ----------------------------------------------------------------

/** "a", "a and b", "a, b and c". Repeats are dropped. */
export function joinNames(names: string[]): string {
  const n = [...new Set(names)];
  if (n.length <= 1) return n[0] ?? "";
  return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

// "Haemoglobin" reads as "haemoglobin" mid-sentence; "HbA1c" and "ALT (SGPT)" keep their capitals.
export const midSentence = (name: string) => (/^[A-Z][a-z]+(?=[\s(,-]|$)/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);

const namesOf = (markers: SafetyMarker[], flag: Flag) => [...new Set(markers.filter((m) => m.flag === flag).map((m) => m.name))];

// ---- The read ---------------------------------------------------------------

/**
 * The verdict the person sees, after the floor:
 * - Any flagged marker: "Doctor first", in fixed words that name the markers.
 * - Otherwise, a marker whose unit we couldn't check against our doctor limits
 *   (`unchecked`) means the verdict can't be "go": it drops to "go with tweaks"
 *   and says to confirm those markers.
 * - Otherwise the model's verdict stands.
 */
export function floorVerdict(verdict: Verdict, o: { markers: SafetyMarker[]; unchecked?: string[]; eventName?: string | null }): Verdict {
  const urgent = namesOf(o.markers, "urgent");
  const doctor = namesOf(o.markers, "doctor");
  if (urgent.length || doctor.length) {
    const event = o.eventName?.trim().replace(/[.!?\s]+$/, "");
    const detail = [
      urgent.length ? `Get medical advice today about ${joinNames(urgent.map(midSentence))}.` : "",
      doctor.length ? `Your ${joinNames(doctor.map(midSentence))} ${doctor.length > 1 ? "are" : "is"} worth a doctor's look before you push hard.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return { level: "doctor_first", line: event ? `See a doctor before ${event}.` : "Show a doctor first.", detail };
  }
  const unchecked = [...new Set(o.unchecked ?? [])];
  if (unchecked.length && verdict.level === "go") {
    const confirm = `Confirm your ${joinNames(unchecked.map(midSentence))} with your lab or a doctor: we couldn't check ${
      unchecked.length > 1 ? "their units" : "its unit"
    }.`;
    return { level: "go_with_tweaks", line: verdict.line, detail: [verdict.detail.trim(), confirm].filter(Boolean).join(" ") };
  }
  return verdict;
}

// ---- The stack --------------------------------------------------------------

type StackItem = { nutrient: string; form: string; markers: string[] };
type StackLike<I extends StackItem> = { items: I[]; skip: { name: string; why: string }[]; see_doctor: string[] };

// Lower-case words with single spaces and a space at each end, so "vitamin_d",
// "Vitamin D" and "VITAMIN-D" all match, and "alt" doesn't match "health".
const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const mentions = (text: string, m: SafetyMarker) => [m.key, m.name].some((t) => !!t && words(t).trim() !== "" && words(text).includes(words(t)));

const IRON_NUTRIENT = /\b(iron|ferrous|ferric)\b/i;
const IRON_FORM = /\b(ferrous|ferric|carbonyl iron|iron bisglycinate|iron polymaltose)\b/i;
export const isIronItem = (item: StackItem) => IRON_NUTRIENT.test(item.nutrient) || IRON_FORM.test(item.form);

export const seeDoctorLine = (m: SafetyMarker) =>
  m.flag === "urgent"
    ? `${m.name}: get medical advice today, before you take anything for it.`
    : `${m.name}: flagged on your report. Show a doctor before you take anything for it.`;

/**
 * The stack after the floor, whatever the model returned:
 * - No item treats a flagged marker; every flagged marker is in see_doctor.
 * - Any urgent flag: no items at all, only food first and the doctor.
 * - Iron only when ferritin was measured and is low.
 */
export function floorStack<I extends StackItem, P extends StackLike<I>>(plan: P, markers: SafetyMarker[]): P {
  const flagged = markers.filter((m) => m.flag);
  const urgent = flagged.some((m) => m.flag === "urgent");
  const ferritin = markers.find((m) => m.key === "ferritin");
  const skip = [...plan.skip];

  const items = plan.items.filter((item) => {
    if (urgent) return false;
    if (flagged.some((m) => item.markers.some((x) => mentions(x, m)))) return false;
    // Iron answers to ferritin, whatever markers the item lists.
    if (isIronItem(item) && ferritin?.flag) return false;
    if (isIronItem(item) && ferritin?.status !== "low") {
      if (!skip.some((s) => IRON_NUTRIENT.test(s.name))) {
        skip.push({
          name: "Iron",
          why: ferritin ? "Your ferritin isn't low, so extra iron isn't needed." : "There's no ferritin on this report. Test it before taking iron.",
        });
      }
      return false;
    }
    return true;
  });

  const seeDoctor = [...plan.see_doctor];
  for (const m of flagged) {
    if (!seeDoctor.some((s) => mentions(s, m))) seeDoctor.push(seeDoctorLine(m));
  }
  return { ...plan, items, skip, see_doctor: seeDoctor };
}
