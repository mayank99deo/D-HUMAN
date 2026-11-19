// Ask's fixed safety words: the notices code writes above any AI text, and the phone
// buttons. The model never writes these. The words are the contract's §7.1
// (docs/team/specs/2026-11-19-ask-build.md), English for now (Mayank, 2026-11-19). A doctor
// and a mental-health professional review them before ASK_OPEN=all (threats M2).
// Marker lines reuse seeDoctorLine from lib/domain/safety.ts, so Ask and the Stack screen
// say the same thing about a flagged marker.

import type { AskCall, AskNotice, AskNoticeLevel, AskNoticeMarker, AskNoticePart, AskRegion } from "../ask/types.ts";
import type { MarkerStatus } from "./markers.ts";
import { seeDoctorLine, type Flag } from "./safety.ts";

/** A flagged marker as a notice names it: the catalogue name, its status and its flag. */
export type NoticeMarker = { key: string | null; name: string; status: MarkerStatus; flag: Flag };

/** The order lines combine in: the contract's §7.1 table. */
const ORDER: AskNoticePart[] = [
  "crisis",
  "symptom",
  "urgent_marker",
  "urgent_hold",
  "doctor_marker",
  "medicine",
  "pregnancy",
  "dose",
  "low_calorie",
  "doctor_general",
];

const LEVEL: Record<AskNoticePart, AskNoticeLevel> = {
  crisis: "crisis",
  symptom: "urgent",
  urgent_marker: "urgent",
  urgent_hold: "urgent",
  doctor_marker: "doctor",
  medicine: "doctor",
  pregnancy: "doctor",
  dose: "doctor",
  low_calorie: "doctor",
  doctor_general: "doctor",
};
const RANK: Record<AskNoticeLevel, number> = { doctor: 1, urgent: 2, crisis: 3 };
const LABEL: Record<AskNoticeLevel, string | null> = { doctor: "Doctor first", urgent: "Get advice today", crisis: null };

export const NOTICE_TEXT = {
  crisisIndia:
    "You don't have to face this alone. Tele-MANAS, the government's toll-free mental health line, answers any time, in many Indian languages: 14416. If you might act on these thoughts now, call 112.",
  crisisElsewhere: "You don't have to face this alone. If you might act on these thoughts now, call your local emergency number.",
  symptomIndia: "That can be serious. See a doctor today. If it's sudden, severe or getting worse, call 112 now.",
  symptomElsewhere: "That can be serious. See a doctor today. If it's sudden, severe or getting worse, call your local emergency number now.",
  holdOne: "Until a doctor has seen it, Ask only answers questions about using the app and logging meals.",
  holdMany: "Until a doctor has seen them, Ask only answers questions about using the app and logging meals.",
  medicine: "Only your doctor should start, stop or change a medicine. Take this question to them.",
  pregnancy: "You're pregnant or breastfeeding, so take nothing new without your doctor.",
  dose: "Your stack has the only doses we suggest. For anything else, ask your doctor.",
  lowCalorie: "Eating that little can harm your body, so Ask won't plan it. Your targets on Fuel are set for your body.",
  lowCalorieIndia: "If food or weight feels hard to control, Tele-MANAS can help: 14416.",
  doctorGeneral: "This is worth taking to a doctor before you act on it.",
} as const;

/** What the brand filter puts in place of an answer that named a brand (contract §6.3). */
export const BRAND_LINE = "Brand picks live in your stack, under our no-partners note.";

/** The markers each marker part names. Urgent hold lists every urgent marker on the newest report. */
export type NoticeMarkers = Partial<Record<"urgent_marker" | "urgent_hold" | "doctor_marker", NoticeMarker[]>>;

const lineFor = (m: NoticeMarker) => seeDoctorLine({ key: m.key, name: m.name, status: m.status, flag: m.flag });

/**
 * The notice for these parts, in the contract's order, or null for none. The label is
 * the highest part's; phone buttons only in India. Repeated lines and markers are dropped,
 * so a marker named twice is said once.
 */
export function askNotice(parts: Iterable<AskNoticePart>, o: { region: AskRegion; markers?: NoticeMarkers }): AskNotice | null {
  const want = new Set(parts);
  const used = ORDER.filter((p) => want.has(p));
  if (!used.length) return null;
  const india = o.region === "in";
  const lines: string[] = [];
  const calls: AskCall[] = [];
  const named: NoticeMarker[] = [];
  const say = (line: string) => {
    if (!lines.includes(line)) lines.push(line);
  };
  const call = (...numbers: AskCall[]) => {
    if (india) for (const n of numbers) if (!calls.includes(n)) calls.push(n);
  };
  const name = (ms: NoticeMarker[]) => {
    for (const m of ms) {
      if (!named.some((x) => x.name === m.name)) named.push(m);
      say(lineFor(m));
    }
  };

  for (const part of used) {
    switch (part) {
      case "crisis":
        say(india ? NOTICE_TEXT.crisisIndia : NOTICE_TEXT.crisisElsewhere);
        call("14416", "112");
        break;
      case "symptom":
        say(india ? NOTICE_TEXT.symptomIndia : NOTICE_TEXT.symptomElsewhere);
        call("112");
        break;
      case "urgent_marker":
      case "doctor_marker":
        name(o.markers?.[part] ?? []);
        break;
      case "urgent_hold": {
        const held = o.markers?.urgent_hold ?? [];
        name(held);
        say(held.length > 1 ? NOTICE_TEXT.holdMany : NOTICE_TEXT.holdOne);
        break;
      }
      case "medicine":
        say(NOTICE_TEXT.medicine);
        break;
      case "pregnancy":
        say(NOTICE_TEXT.pregnancy);
        break;
      case "dose":
        say(NOTICE_TEXT.dose);
        break;
      case "low_calorie":
        say(NOTICE_TEXT.lowCalorie);
        if (india) say(NOTICE_TEXT.lowCalorieIndia);
        call("14416");
        break;
      case "doctor_general":
        say(NOTICE_TEXT.doctorGeneral);
        break;
    }
  }

  const level = used.map((p) => LEVEL[p]).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  const markers: AskNoticeMarker[] = named.map(({ name, status, flag }) => ({ name, status, flag }));
  return { level, label: LABEL[level], parts: used, lines, markers, calls };
}
