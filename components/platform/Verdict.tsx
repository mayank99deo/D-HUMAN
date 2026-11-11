import type { VerdictLevel } from "@/lib/ai/schemas";

const WORDS: Record<VerdictLevel, string> = {
  go: "Green light",
  go_with_tweaks: "Green light, with tweaks",
  build: "Build first",
  doctor_first: "Doctor first",
};

const GLOW: Record<VerdictLevel, string> = {
  go: "rgb(181 210 192 / 0.16)",
  go_with_tweaks: "rgb(226 211 162 / 0.14)",
  build: "rgb(226 211 162 / 0.12)",
  doctor_first: "rgb(227 165 162 / 0.16)",
};

export function VerdictMark({ level }: { level: VerdictLevel }) {
  if (level === "doctor_first") return <span aria-hidden className="grid h-5 w-5 place-items-center bg-paper text-xs font-black text-ink">!</span>;
  if (level === "go") return <span aria-hidden className="h-4 w-4 rounded-full bg-serum" />;
  if (level === "go_with_tweaks") return <span aria-hidden className="glyph glyph-edge h-4 w-4" />;
  return <span aria-hidden className="h-4 w-4 rounded-full border-2 border-straw" />;
}

export function Verdict({ level, line, detail, as: H = "h2", lang }: { level: VerdictLevel; line: string; detail?: string; as?: "h1" | "h2"; lang?: string }) {
  return (
    <section className="relative isolate" aria-label="Verdict" lang={lang}>
      <div aria-hidden className="pointer-events-none absolute -inset-x-16 -inset-y-16 -z-10" style={{ background: `radial-gradient(closest-side at 35% 50%, ${GLOW[level]}, transparent)` }} />
      <p className="flex items-center gap-2 text-sm font-semibold text-graphite">
        <VerdictMark level={level} />
        {WORDS[level]}
      </p>
      <H className="verdict-type mt-3 text-[clamp(2.25rem,6.5vw,3.75rem)]">{line}</H>
      {detail && <p className="mt-4 max-w-prose text-lg text-graphite">{detail}</p>}
    </section>
  );
}
